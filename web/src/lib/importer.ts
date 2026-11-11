// Import job: upload the file in 2 MB chunks (a .sql.gz is decompressed in
// the browser first), then let the server run statements a few seconds at a
// time until the end (server/src/Import.php). One request at a time; the
// server keeps the position, so a cut step is sent again and a stopped import
// continues after the statement that failed.
import { dbApi, importUpload, type ImportProgress } from './dbApi';
import { stepError, mb, duration } from './exporter';
import { n, t } from './i18n.svelte';
import { advance, isAbort, step, watch, type Job } from './jobs.svelte';

export const CHUNK = 2 * 1024 * 1024;

export interface ImportOptions {
  db: string;
  noFkChecks: boolean;
  continueOnError: boolean;
  /** Import everything into `db`: skip USE / CREATE DATABASE, drop these database qualifiers. */
  retarget: string[] | null;
}

export const canGunzip = () => typeof (window as any).DecompressionStream === 'function';
export const isGzip = (f: File) => /\.gz$/i.test(f.name);

/** The file's bytes as a stream, decompressed when it is .gz. */
export function source(file: File): ReadableStream<Uint8Array> {
  const s = file.stream() as ReadableStream<Uint8Array>;
  return isGzip(file) ? s.pipeThrough(new (window as any).DecompressionStream('gzip')) : s;
}

export async function runImport(file: File, o: ImportOptions, job: Job, onDone: (r: ImportProgress) => void) {
  let id: string | null = null;
  let uploaded = 0;
  const errors: { line: number; statement: string; message: string }[] = [];
  let seenLog = 0;
  let last: ImportProgress | null = null;

  async function upload() {
    const reader = source(file).getReader();
    let buf = new Uint8Array(CHUNK);
    let fill = 0;
    let read = 0;
    const send = async (bytes: Uint8Array) => {
      const r = await step(job, (signal) => importUpload(id, uploaded, bytes, signal));
      id = r.id;
      uploaded = r.size;
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      read += value.length;
      let off = 0;
      while (off < value.length) {
        const k = Math.min(CHUNK - fill, value.length - off);
        buf.set(value.subarray(off, off + k), fill);
        fill += k;
        off += k;
        if (fill === CHUNK) {
          await send(buf);
          buf = new Uint8Array(CHUNK);
          fill = 0;
        }
      }
      // Upload is the first 15 %; compressed files report what was read from disk.
      job.progress = Math.min(0.15, (isGzip(file) ? Math.min(1, read / Math.max(1, file.size * 4)) : read / Math.max(1, file.size)) * 0.15);
      advance(job, { phase: 'upload', bytes: uploaded, bytesTotal: isGzip(file) ? 0 : file.size });
      job.detail = t('import.uploading', { size: mb(uploaded) });
    }
    if (fill > 0 || !id) await send(buf.subarray(0, fill));
    job.log.push({ kind: 'ok', text: t('import.log.uploaded', { mb: mb(uploaded) }) });
  }

  function apply(r: ImportProgress) {
    last = r;
    errors.push(...r.errors.slice(0, Math.max(0, 200 - errors.length)));
    job.progress = 0.15 + 0.85 * (r.size ? r.offset / r.size : 1);
    advance(job, { phase: 'run', table: r.table, bytes: r.offset, bytesTotal: r.size, rows: r.executed, tablesDone: r.tables });
    job.detail = r.table ? t('import.runningTable', { table: r.table, mb: mb(r.offset), total: mb(r.size) }) : t('import.running', { executed: n(r.executed), errors: n(r.errorsTotal), mb: mb(r.offset), total: mb(r.size) });
    for (const e of r.log.slice(seenLog)) {
      if (e.type === 'table') job.log.push({ kind: 'ok', text: t('import.log.table', { table: e.table ?? '' }) });
      else if (e.type === 'error') job.log.push({ kind: 'error', text: t('import.log.error', { line: n(Number(e.line ?? 0)), message: e.message ?? '' }) });
    }
    seenLog = r.log.length;
  }

  let phase: 'upload' | 'run' = 'upload';
  async function pump() {
    job.status = 'running';
    job.error = '';
    job.resume = null;
    job.resumeFrom = null;
    job.stalled = false;
    job.lastAdvance = Date.now();
    watch();
    try {
      if (phase === 'upload') {
        uploaded = 0;
        id = null;
        await upload();
        phase = 'run';
      } else if (id) {
        // After a cut: where the server is (the next step continues from there).
        apply(await step(job, () => dbApi.importStatus(id!)));
      }
      for (;;) {
        const r = await step(job, (signal) => dbApi.importRun(id!, o.db, o.noFkChecks, o.continueOnError, o.retarget, signal));
        apply(r);
        if (r.stopped) {
          const e = r.errors[r.errors.length - 1];
          job.status = 'error';
          job.error = e ? t('import.stoppedAt', { line: e.line, message: e.message }) : t('import.stopped');
          job.resumeFrom = r.table;
          job.summary = { lines: [t('import.sumExecuted', { count: n(r.executed) })], errors };
          job.resume = () => void pump(); // continue after the failed statement
          return;
        }
        if (r.done) {
          job.progress = 1;
          job.status = 'done';
          job.detail = t('import.done', { executed: n(r.executed), errors: n(r.errorsTotal), seconds: r.seconds });
          job.summary = {
            lines: [
              t('import.sumTables', { count: n(r.tables) }),
              t('import.sumExecuted', { count: n(r.executed) }),
              t('import.sumErrors', { count: n(r.errorsTotal) }),
              t('export.sum.size', { mb: mb(r.size) }),
              t('export.sum.time', { time: duration((Date.now() - job.startedAt) / 1000) }),
            ],
            errors,
          };
          await dbApi.importFinish(id!).catch(() => {});
          onDone(r);
          return;
        }
      }
    } catch (e) {
      if (job.controller.signal.aborted || isAbort(e)) {
        job.status = 'cancelled';
        if (id) await dbApi.importFinish(id).catch(() => {});
        return;
      }
      job.status = 'error';
      job.error = stepError(e);
      job.resumeFrom = last?.table ?? null;
      if (last) job.summary = { lines: [t('import.partial', { mb: mb(last.offset), total: mb(last.size) })], errors };
      job.resume = () => void pump();
    }
  }
  await pump();
}
