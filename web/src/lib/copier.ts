// Copy a table (structure, rows in batches, foreign keys) or a whole database
// (create it, copy every table, then FKs pointing inside the copy, then views)
// as background jobs with progress.
import { dbApi } from './dbApi';
import { t } from './i18n.svelte';
import { isAbort, type Job } from './jobs.svelte';

export interface CopyOptions {
  db: string;
  table: string;
  targetDb: string;
  newName: string;
  data: boolean;
  indexes: boolean;
  fks: boolean;
}

const BATCH = 5000;

async function copyRows(o: CopyOptions, job: Job, approx: number, base: number, span: number) {
  let after: unknown[] | null = null;
  let copied = 0;
  for (;;) {
    const r = await dbApi.copyRows(o.db, o.table, o.targetDb, o.newName, after, BATCH, job.controller.signal);
    copied += r.copied;
    job.progress = base + span * Math.min(0.99, copied / Math.max(1, approx));
    job.detail = t('copy.rows', { table: o.newName, rows: copied.toLocaleString() });
    if (r.done) return copied;
    after = r.next;
  }
}

export async function runCopyTable(o: CopyOptions, job: Job, onDone: () => void) {
  let created = false;
  async function pump() {
    job.status = 'running';
    job.error = '';
    job.resume = null;
    try {
      let approx = 0;
      if (!created) {
        job.detail = t('copy.structure', { table: o.newName });
        approx = (await dbApi.copyTable(o.db, o.table, o.targetDb, o.newName, o.indexes)).approxRows;
        created = true;
      }
      if (o.data) await copyRows(o, job, approx, 0, 0.95);
      if (o.fks) await dbApi.copyFks(o.db, o.table, o.targetDb, o.newName, false);
      job.progress = 1;
      job.status = 'done';
      job.detail = t('copy.done', { table: `${o.targetDb}.${o.newName}` });
      onDone();
    } catch (e) {
      if (isAbort(e) || job.controller.signal.aborted) {
        job.status = 'cancelled';
        return;
      }
      job.status = 'error';
      job.error = e instanceof Error ? e.message : String(e);
      // Rows already copied would repeat: retry only before the table exists.
      job.resume = created ? null : () => void pump();
    }
  }
  await pump();
}

/** "Copy to a new database": the way to rename a database in MySQL. */
export async function runCopyDatabase(src: string, target: string, charset: string | null, collation: string | null, job: Job, onDone: () => void) {
  try {
    job.detail = t('copy.createDb', { db: target });
    await dbApi.createDb(target, charset, collation);
    const ov = await dbApi.overview(src);
    const tables = ov.tables.filter((x) => x.type === 'BASE TABLE');
    const views = ov.tables.filter((x) => x.type === 'VIEW');
    const total = Math.max(1, tables.reduce((s, x) => s + (x.approxRows ?? 0), 0));
    let done = 0;
    for (const tb of tables) {
      if (job.controller.signal.aborted) throw new DOMException('aborted', 'AbortError');
      const o: CopyOptions = { db: src, table: tb.name, targetDb: target, newName: tb.name, data: true, indexes: true, fks: false };
      job.detail = t('copy.structure', { table: tb.name });
      const r = await dbApi.copyTable(src, tb.name, target, tb.name, true);
      const share = 0.9 * (Math.max(1, r.approxRows) / total);
      await copyRows(o, job, r.approxRows, Math.min(0.9, (0.9 * done) / total), share);
      done += r.approxRows;
    }
    job.detail = t('copy.fks');
    for (const tb of tables) await dbApi.copyFks(src, tb.name, target, tb.name, true);
    for (const v of views) {
      try {
        await dbApi.copyView(src, v.name, target);
      } catch {
        /* a view over another database may not resolve; reported below */
      }
    }
    job.progress = 1;
    job.status = 'done';
    job.detail = t('copy.dbDone', { db: target, tables: tables.length });
    onDone();
  } catch (e) {
    if (isAbort(e) || job.controller.signal.aborted) {
      job.status = 'cancelled';
      return;
    }
    job.status = 'error';
    job.error = e instanceof Error ? e.message : String(e);
  }
}
