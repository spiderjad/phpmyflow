// Production connections (Settings › Connections, config.php 'env') ask before
// every request that writes. Hooked into api.ts request(), so no write path
// can skip it. Batch jobs (import chunks, copy batches, test data, maintenance
// per table) ask once: their next requests pass for a short while.
import { isReadOnlySql } from './sqlKind';

export type WriteGuard = (action: string, payload: Record<string, unknown> | undefined) => Promise<boolean>;

let guard: WriteGuard | null = null;
export function setWriteGuard(g: WriteGuard | null) {
  guard = g;
}

/** POST actions that never change data (or only the session / temp files). */
const NEVER = new Set([
  'login', 'login_test', 'logout', 'check', 'ai', 'alter_preview', 'ddl_checks', 'object_preview',
  'search_plan', 'search_table', 'bulk_plan', 'lookup_many', 'import_finish',
  // Export jobs only write a temp file on the server; reading needs no confirmation.
  'export_start', 'export_step', 'export_cancel', 'import_inspect',
]);

/** Does this request write to the database? (pure: tested) */
export function writes(action: string, payload?: Record<string, unknown>): boolean {
  if (NEVER.has(action)) return false;
  if (action === 'query') return !isReadOnlySql(String(payload?.sql ?? ''));
  if (action === 'gen_rows') return payload?.insert === true; // otherwise a preview
  if (action === 'table_create') return !(payload?.spec as { dryRun?: boolean } | undefined)?.dryRun; // dryRun = show the SQL
  return true;
}

/** Follow-up requests of a job that was already confirmed: job → actions that continue it. */
const JOBS: Record<string, string[]> = {
  import_upload: ['import_upload', 'import_run'],
  table_copy: ['table_copy_rows', 'table_copy_fks', 'view_copy', 'table_copy'],
  gen_rows: ['gen_rows'],
  maint_run: ['maint_run'],
  bulk_apply: ['bulk_apply'],
  tables_truncate: ['tables_truncate'],
  tables_drop: ['tables_drop'],
};
const JOB_WINDOW_MS = 2 * 60_000;
let approved: { job: string; until: number } | null = null;

function jobOf(action: string): string | null {
  for (const [job, actions] of Object.entries(JOBS)) if (actions.includes(action)) return job;
  return null;
}

/** Called by request() before a POST; false = the user cancelled. */
export async function allowWrite(action: string, payload?: Record<string, unknown>, now = Date.now()): Promise<boolean> {
  if (!guard || !writes(action, payload)) return true;
  const job = jobOf(action);
  if (job && approved && approved.job === job && approved.until > now) {
    approved.until = now + JOB_WINDOW_MS;
    return true;
  }
  const ok = await guard(action, payload);
  approved = ok && job ? { job, until: now + JOB_WINDOW_MS } : null;
  return ok;
}

export function resetWriteApprovals() {
  approved = null;
}
