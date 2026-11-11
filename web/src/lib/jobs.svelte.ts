// Long operations (export, import, copy) run as background jobs: the UI stays
// usable, each job shows its progress in the jobs panel (aria-live) and can be
// cancelled; a job that failed half way can resume from where it stopped.

export type JobStatus = 'running' | 'done' | 'error' | 'cancelled';

export interface Job {
  id: number;
  kind: 'export' | 'import' | 'copy' | 'maintenance' | 'bulk' | 'generate' | 'search';
  title: string;
  status: JobStatus;
  /** 0..1, or null when unknown. */
  progress: number | null;
  detail: string;
  error: string;
  /** Continue after an error, from the step that failed. */
  resume: (() => void) | null;
  /** Extra result shown when done (import summary). */
  summary: {
    lines: string[];
    errors: { line: number; statement: string; message: string }[];
    /** Per-table results (maintenance, bulk editor). */
    table?: { columns: string[]; rows: { cells: string[]; status: 'ok' | 'warning' | 'error' | 'skipped' }[] };
  } | null;
  controller: AbortController;
  startedAt: number;
  /** Export / import: detailed progress for the panel (null for the other jobs). */
  stats: JobStats | null;
  /** What was done, newest last (export: tables; import: tables created, errors). */
  log: { text: string; kind: 'info' | 'ok' | 'warn' | 'error' }[];
  /** Last time the counters moved (stall detection). */
  lastAdvance: number;
  /** No progress for STALL_MS while running. */
  stalled: boolean;
  /** Abort the request in flight and send the same step again. */
  retryStep: (() => void) | null;
  /** Where a resume continues (a table name), shown with "Resume from …". */
  resumeFrom: string | null;
  /** Finished export: download the file (once). */
  download: (() => void) | null;
  /** Shown as a thin bar at the bottom. */
  minimized: boolean;
  /** Extra buttons when done (import into WordPress: "See those rows"). */
  actions: { label: string; run: () => void | Promise<void> }[];
}

export interface JobStats {
  phase: string;
  table: string | null;
  tablesDone: number;
  tablesTotal: number;
  rows: number;
  rowsTotal: number;
  /** Export: file size so far. Import: bytes processed. */
  bytes: number;
  /** Import: file size. */
  bytesTotal: number;
  /** Bytes per second over the last ~10 s. */
  speed: number;
  /** Seconds since the job started (wall clock). */
  elapsed: number;
}

/** No progress for this long while running: "Looks stopped". */
export const STALL_MS = 20_000;

export const jobs = $state<Job[]>([]);
let nextId = 1;

export function startJob(kind: Job['kind'], title: string): Job {
  jobs.unshift({
    id: nextId++,
    kind,
    title,
    status: 'running',
    progress: null,
    detail: '',
    error: '',
    resume: null,
    summary: null,
    controller: new AbortController(),
    startedAt: Date.now(),
    stats: null,
    log: [],
    lastAdvance: Date.now(),
    stalled: false,
    retryStep: null,
    resumeFrom: null,
    download: null,
    minimized: false,
    actions: [],
  });
  ensureWatchdog();
  return jobs[0];
}

// --- step loop helpers (export / import) ---

/** Speed from the last samples (bytes per second). */
const samples = new Map<number, { t: number; b: number }[]>();

/** Record progress: updates stats, speed and the stall clock when something moved. */
export function advance(job: Job, next: Partial<JobStats>) {
  const prev = job.stats;
  const s: JobStats = { phase: '', table: null, tablesDone: 0, tablesTotal: 0, rows: 0, rowsTotal: 0, bytes: 0, bytesTotal: 0, speed: 0, elapsed: 0, ...(prev ?? {}), ...next };
  const now = Date.now();
  const moved = !prev || s.bytes !== prev.bytes || s.rows !== prev.rows || s.tablesDone !== prev.tablesDone || s.phase !== prev.phase || s.table !== prev.table;
  const list = samples.get(job.id) ?? [];
  list.push({ t: now, b: s.bytes });
  while (list.length > 2 && now - list[0].t > 10_000) list.shift();
  samples.set(job.id, list);
  const first = list[0];
  s.speed = now > first.t ? ((s.bytes - first.b) * 1000) / (now - first.t) : 0;
  s.elapsed = (now - job.startedAt) / 1000;
  job.stats = s;
  if (moved) {
    job.lastAdvance = now;
    job.stalled = false;
  }
}

/**
 * One request of a job, retryable on its own: "Retry this step" aborts it and
 * sends it again (the server keeps the job's position, so a step can always
 * be repeated). Cancelling the job aborts it for good.
 */
export async function step<T>(job: Job, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  for (;;) {
    const c = new AbortController();
    const stop = () => c.abort();
    job.controller.signal.addEventListener('abort', stop);
    let retried = false;
    job.retryStep = () => {
      retried = true;
      job.stalled = false;
      job.lastAdvance = Date.now();
      c.abort();
    };
    try {
      return await fn(c.signal);
    } catch (e) {
      if (retried && !job.controller.signal.aborted) continue;
      throw e;
    } finally {
      job.controller.signal.removeEventListener('abort', stop);
      job.retryStep = null;
    }
  }
}

let watchdog: ReturnType<typeof setInterval> | null = null;
function ensureWatchdog() {
  if (watchdog) return;
  watchdog = setInterval(() => {
    const now = Date.now();
    let any = false;
    for (const j of jobs) {
      if (j.status !== 'running' || !j.stats) continue;
      any = true;
      if (!j.stalled && now - j.lastAdvance > STALL_MS) j.stalled = true;
      j.stats.elapsed = (now - j.startedAt) / 1000;
    }
    if (!any && watchdog) {
      clearInterval(watchdog);
      watchdog = null;
    }
  }, 1000);
}

/** Restart the watchdog after a resume. */
export function watch() {
  ensureWatchdog();
}

export function cancelJob(job: Job) {
  job.controller.abort();
  job.status = 'cancelled';
  job.resume = null;
}

export function dismissJob(job: Job) {
  const i = jobs.indexOf(job);
  if (i >= 0) jobs.splice(i, 1);
}

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** "2 min left" style estimate from progress so far. */
export function eta(job: Job, now = Date.now()): number | null {
  if (!job.progress || job.progress <= 0.01 || job.progress >= 1) return null;
  const elapsed = (now - job.startedAt) / 1000;
  return Math.round((elapsed / job.progress) * (1 - job.progress));
}
