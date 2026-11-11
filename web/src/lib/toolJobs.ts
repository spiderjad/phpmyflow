// Jobs for the phase C tools: one request per table (maintenance, bulk
// editor) or per batch (test data), with progress, cancel and a result table.
import { formatBytes } from './bytes';
import { i18n, t } from './i18n.svelte';
import { isAbort, type Job } from './jobs.svelte';
import { toolsApi, type BulkChanges, type GenColumn, type MaintOp } from './toolsApi';

type Row = NonNullable<NonNullable<Job['summary']>['table']>['rows'][number];

function table(job: Job, columns: string[]) {
  job.summary = { lines: [], errors: [], table: { columns, rows: [] } };
  return (r: Row) => job.summary!.table!.rows.push(r);
}

export async function runMaintenance(db: string, tables: string[], op: MaintOp, option: string | null, job: Job) {
  const add = table(job, [t('maint.col.table'), t('maint.col.result'), t('maint.col.time')]);
  const signal = job.controller.signal;
  for (const [i, tb] of tables.entries()) {
    if (signal.aborted) break;
    job.detail = t('maint.running', { op, table: tb, n: i + 1, of: tables.length });
    job.progress = i / tables.length;
    try {
      const r = await toolsApi.maintenance(db, tb, op, option, signal);
      add({ cells: [tb, r.messages.join(' · ') || 'OK', `${r.ms} ms`], status: r.status });
    } catch (e) {
      if (isAbort(e) || signal.aborted) break;
      const msg = e instanceof Error ? e.message : String(e);
      add({ cells: [tb, msg, '—'], status: (e as { code?: string }).code === 'repair_engine' ? 'skipped' : 'error' });
    }
  }
  const rows = job.summary!.table!.rows;
  job.progress = 1;
  job.status = signal.aborted ? 'cancelled' : 'done';
  job.detail = t('maint.done', { ok: rows.filter((r) => r.status === 'ok').length, warn: rows.filter((r) => r.status === 'warning' || r.status === 'skipped').length, err: rows.filter((r) => r.status === 'error').length });
}

export async function runBulk(db: string, tables: string[], changes: BulkChanges, job: Job, onDone: () => void) {
  const add = table(job, [t('maint.col.table'), t('maint.col.result'), t('maint.col.time')]);
  const signal = job.controller.signal;
  for (const [i, tb] of tables.entries()) {
    if (signal.aborted) break;
    job.detail = t('bulk.running', { table: tb, n: i + 1, of: tables.length });
    job.progress = i / tables.length;
    try {
      const r = await toolsApi.bulkApply(db, tb, changes, signal);
      add({ cells: [tb, r.sql.length ? t('bulk.applied', { count: r.sql.length }) : t('bulk.nothing'), `${r.ms} ms`], status: 'ok' });
    } catch (e) {
      if (isAbort(e) || signal.aborted) break;
      add({ cells: [tb, e instanceof Error ? e.message : String(e), '—'], status: 'error' });
    }
  }
  job.progress = 1;
  job.status = signal.aborted ? 'cancelled' : job.summary!.table!.rows.some((r) => r.status === 'error') ? 'error' : 'done';
  job.detail = t('bulk.done', { count: job.summary!.table!.rows.filter((r) => r.status === 'ok').length });
  onDone();
}

export async function runGenerate(db: string, tbl: string, columns: GenColumn[], total: number, seed: number, token: string, job: Job, onDone: () => void) {
  const signal = job.controller.signal;
  const batch = 500;
  let done = 0;
  async function pump() {
    job.status = 'running';
    job.error = '';
    job.resume = null;
    try {
      while (done < total) {
        const n = Math.min(batch, total - done);
        const r = await toolsApi.genInsert(db, tbl, columns, n, done, seed, token, signal);
        done += r.inserted;
        job.progress = done / total;
        job.detail = t('gen.progress', { done: done.toLocaleString(i18n.locale), total: total.toLocaleString(i18n.locale) });
      }
      job.status = 'done';
      job.detail = t('gen.done', { count: done.toLocaleString(i18n.locale), table: tbl });
      onDone();
    } catch (e) {
      if (isAbort(e) || signal.aborted) {
        job.status = 'cancelled';
        job.detail = t('gen.partial', { count: done.toLocaleString(i18n.locale) });
        onDone();
        return;
      }
      job.status = 'error';
      job.error = e instanceof Error ? e.message : String(e);
      job.detail = t('gen.partial', { count: done.toLocaleString(i18n.locale) });
      job.resume = () => void pump(); // the next batch continues the sequence
    }
  }
  await pump();
}

export const bigTable = (bytes: number) => bytes > 1024 ** 3;
export const sizeText = (b: number) => formatBytes(b, i18n.locale);
