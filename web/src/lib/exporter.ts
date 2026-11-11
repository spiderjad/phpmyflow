// Export job, driven by the browser in short steps (server/src/ExportJob.php):
// export_start → export_step… (each ~3 s of work on the server, written to a
// private temp file) → export_download. One request at a time, so it works
// on `php -S` and on hosts with a short time limit; the server keeps the
// position, so a cut step is simply sent again ("Retry this step") and a
// failed export resumes from the table where it stopped.
import { ApiError } from './api';
import { dbApi, type ExportStatus } from './dbApi';
import { friendlyError } from './errors';
import { n, t } from './i18n.svelte';
import { advance, isAbort, step, watch, type Job } from './jobs.svelte';

export type ExportFormat = 'sql' | 'csv' | 'json' | 'xlsx';

export interface ExportOptions {
  db: string;
  /** Empty: whole database. */
  tables: string[];
  format: ExportFormat;
  structure: boolean;
  data: boolean;
  dropTable: boolean;
  /** CREATE DATABASE + USE: restore into the same database only (off = portable). */
  createDb: boolean;
  noFkChecks: boolean;
  /** Procedures and functions, triggers, events (SQL, whole database or with tables). */
  routines: boolean;
  triggers: boolean;
  events: boolean;
  /** Rows per INSERT statement. */
  insertRows: number;
  gzip: boolean;
}

export const defaultExport = (db: string, tables: string[] = []): ExportOptions => ({
  db,
  tables,
  format: 'sql',
  structure: true,
  data: true,
  dropTable: true,
  createDb: false,
  noFkChecks: true,
  routines: tables.length === 0,
  triggers: true,
  events: tables.length === 0,
  insertRows: 500,
  gzip: false,
});

/** Megabytes for progress text: one decimal, two under 1 MB (a small file never reads "0 MB"). */
export const mb = (bytes: number) => {
  const v = bytes / 1048576;
  if (bytes > 0 && v < 1) return n(Math.max(0.01, Math.round(v * 100) / 100));
  return n(Math.round(v * 10) / 10);
};

/** Why a step failed, in the user's language. */
export function stepError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'network') return t('jobs.err.network');
    return friendlyError({ code: e.code, message: e.message, details: e.details }).title;
  }
  return e instanceof Error ? e.message : String(e);
}

function apply(job: Job, r: ExportStatus, seen: { log: number }) {
  advance(job, {
    phase: r.phase,
    table: r.table,
    tablesDone: r.tablesDone,
    tablesTotal: r.tablesTotal,
    rows: r.rows,
    rowsTotal: r.rowsTotal,
    bytes: r.bytes,
  });
  job.progress = r.progress;
  job.detail = r.table && r.status === 'running' ? t('export.step.data', { table: r.table, rows: n(r.tableRows) }) : '';
  for (const e of r.log.slice(seen.log)) {
    if (e.type === 'table') job.log.push({ kind: 'ok', text: t('export.log.table', { table: e.table ?? '', rows: n(Number(e.rows ?? 0)), mb: mb(Number(e.bytes ?? 0)) }) });
    else if (e.type === 'views') job.log.push({ kind: 'ok', text: t('export.log.views', { count: Number(e.count ?? 0) }) });
    else if (e.type === 'warning') job.log.push({ kind: 'warn', text: t('export.log.xlsxLimit', { table: e.table ?? '' }) });
    else if (e.type === 'error') job.log.push({ kind: 'error', text: t('export.log.error', { table: e.table ?? '', message: String(e.message ?? '') }) });
  }
  seen.log = r.log.length;
}

/** Run an export as a job (the dialog has already closed). */
export async function runExport(o: ExportOptions, job: Job) {
  let id: string | null = null;
  const seen = { log: 0 };
  let last: ExportStatus | null = null;

  async function pump() {
    job.status = 'running';
    job.error = '';
    job.resume = null;
    job.resumeFrom = null;
    job.stalled = false;
    job.lastAdvance = Date.now();
    watch();
    try {
      if (!id) {
        const r = await step(job, (signal) =>
          dbApi.exportStart({ db: o.db, tables: o.tables, format: o.format, options: { structure: o.structure, data: o.data, dropTable: o.dropTable, createDb: o.createDb, noFkChecks: o.noFkChecks, routines: o.routines, triggers: o.triggers, events: o.events, insertRows: o.insertRows, gzip: o.gzip } }, signal),
        );
        id = r.id;
        last = r;
        apply(job, r, seen);
      }
      for (;;) {
        const r = await step(job, (signal) => dbApi.exportStep(id!, signal));
        last = r;
        apply(job, r, seen);
        if (r.status === 'done') {
          job.progress = 1;
          job.status = 'done';
          job.detail = '';
          job.summary = {
            lines: [
              t('export.sum.tables', { count: n(r.tablesTotal) }),
              t('export.sum.rows', { count: n(r.rows) }),
              t('export.sum.size', { mb: mb(r.bytes) }),
              t('export.sum.time', { time: duration((Date.now() - job.startedAt) / 1000) }),
            ],
            errors: [],
          };
          const file = id!;
          job.download = () => {
            const a = document.createElement('a');
            a.href = `api.php?a=export_download&id=${file}`;
            a.download = r.fileName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            job.download = null; // served once, then deleted on the server
          };
          return;
        }
        if (r.status === 'error') {
          fail(r.error ? (r.error.code === 'mysql' ? t('jobs.err.mysql', { message: r.error.message }) : stepError(new ApiError({ code: r.error.code, message: r.error.message }, 0))) : t('jobs.err.unknown'), r);
          return;
        }
      }
    } catch (e) {
      if (job.controller.signal.aborted || isAbort(e)) {
        job.status = 'cancelled';
        if (id) void dbApi.exportCancel(id).catch(() => {});
        return;
      }
      fail(stepError(e), last);
    }
  }

  function fail(reason: string, r: ExportStatus | null) {
    job.status = 'error';
    job.error = reason;
    job.resumeFrom = r?.table ?? null;
    if (r) job.summary = { lines: [t('export.partial', { done: n(r.tablesDone), total: n(r.tablesTotal) })], errors: [] };
    job.resume = () => void pump();
  }

  await pump();
}

export function duration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return t('jobs.sec', { sec: s });
  const m = Math.floor(s / 60);
  return m < 60 ? t('jobs.minSec', { min: m, sec: s % 60 }) : t('jobs.hourMin', { hour: Math.floor(m / 60), min: m % 60 });
}
