// Database-level actions (phase A): overview, databases, table operations,
// export in parts and chunked import. All DDL is built by the server
// (server/src/Ddl.php) from these structured requests.
import { ApiError, csrfToken, request } from './api';
import { allowWrite } from './writeGuard';
import type { ColumnDef } from './columnTypes';

export interface DbCaps {
  readOnly: boolean;
  db: string | null;
  system: boolean;
  managedBy: 'glpi' | 'wordpress' | null;
  /** true / false, or null when roles might grant it (unknown). */
  privileges: Record<string, boolean | null>;
  grants: Record<string, string>;
  createDb: boolean;
  createDbGrant: string;
}

export interface OverviewTable {
  name: string;
  type: 'BASE TABLE' | 'VIEW' | string;
  engine: string | null;
  approxRows: number | null;
  dataBytes: number | null;
  indexBytes: number | null;
  freeBytes: number | null;
  collation: string | null;
  created: string | null;
  updated: string | null;
  comment: string;
}

export interface Overview {
  db: string;
  charset: string | null;
  collation: string | null;
  tables: OverviewTable[];
  counts: { tables: number; views: number; procedures: number; functions: number; triggers: number; events: number };
  bytes: number;
}

export interface Charsets {
  charsets: { name: string; description: string; default: string; collations: string[] }[];
  serverCharset: string;
  serverCollation: string;
}

export interface TableImpact {
  table: string;
  type: string;
  rows: number;
  exact: boolean;
  bytes: number;
  referencedBy: { db: string; table: string; fk: string }[];
}

export interface DbImpact {
  tables: number;
  views: number;
  rows: number;
  bytes: number;
  routines: number;
  referencedFrom: { db: string; table: string; ref: string }[];
}

/** State of an export job (server/src/ExportJob.php status()). */
export interface ExportStatus {
  id: string;
  kind: 'export';
  status: 'running' | 'done' | 'error' | 'cancelled';
  phase: string;
  table: string | null;
  tableRows: number;
  tableApprox: number;
  tablesDone: number;
  tablesTotal: number;
  rows: number;
  rowsTotal: number;
  bytes: number;
  progress: number;
  workMs: number;
  startedAt: number;
  steps: number;
  error: { code: string; message: string; mysqlCode?: number; table?: string | null } | null;
  fileName: string;
  log: { type: string; table: string | null; rows?: number; bytes?: number; count?: number; message?: string; at: number }[];
  memoryPeak: number;
  resumeFrom: string | null;
}

export interface TableSpec {
  name: string;
  columns: (ColumnDef & { autoIncrement?: boolean })[];
  primary: string[];
  indexes: { kind: 'INDEX' | 'UNIQUE' | 'FULLTEXT'; name: string; columns: string[] }[];
  foreignKeys: { name: string; columns: string[]; refTable: string; refColumns: string[]; onDelete: string; onUpdate: string }[];
  engine: string;
  collation?: string | null;
  comment?: string;
  dryRun?: boolean;
}

export interface ImportProgress {
  offset: number;
  size: number;
  line: number;
  executed: number;
  errorsTotal: number;
  errors: { line: number; statement: string; code: number; message: string }[];
  stopped: boolean;
  done: boolean;
  db: string;
  seconds: number;
  /** Table of the last statement run (CREATE / INSERT / ALTER). */
  table: string | null;
  /** Tables created so far. */
  tables: number;
  workMs: number;
  log: { type: string; table?: string; line?: number; message?: string; executed?: number; errors?: number; at: number }[];
}

type Key = unknown[] | null;

export const dbApi = {
  caps: (db?: string) => request<DbCaps>('db_caps', 'GET', { db }),
  overview: (db: string) => request<Overview>('db_overview', 'GET', { db }),
  charsets: () => request<Charsets>('charsets', 'GET'),
  dbImpact: (db: string) => request<DbImpact>('db_impact', 'GET', { db }),
  tablesImpact: (db: string, tables: string[]) => request<{ tables: TableImpact[] }>('tables_impact', 'GET', { db, tables }),
  createCode: (db: string, table: string) => request<{ sql: string }>('table_create_code', 'GET', { db, table }),

  createDb: (name: string, charset: string | null, collation: string | null) => request<{ ok: true; sql: string }>('db_create', 'POST', { name, charset, collation }),
  alterDb: (db: string, charset: string | null, collation: string | null) => request<{ ok: true; sql: string }>('db_alter', 'POST', { db, charset, collation }),
  dropDb: (db: string, confirm: string) => request<{ ok: true }>('db_drop', 'POST', { db, confirm }),

  createTable: (db: string, spec: TableSpec) => request<{ ok?: true; sql: string }>('table_create', 'POST', { db, spec }),
  renameTable: (db: string, from: string, to: string) => request<{ ok: true }>('table_rename', 'POST', { db, from, to }),
  copyTable: (db: string, table: string, targetDb: string, newName: string, indexes: boolean) =>
    request<{ ok: true; pk: string[]; approxRows: number }>('table_copy', 'POST', { db, table, targetDb, newName, indexes }),
  copyRows: (db: string, table: string, targetDb: string, newName: string, after: Key, batch: number, signal?: AbortSignal) =>
    request<{ copied: number; next: Key; done: boolean }>('table_copy_rows', 'POST', { db, table, targetDb, newName, after, batch }, signal),
  copyFks: (db: string, table: string, targetDb: string, newName: string, remap: boolean) =>
    request<{ ok: true; sql: string }>('table_copy_fks', 'POST', { db, table, targetDb, newName, remap }),
  copyView: (db: string, view: string, targetDb: string) => request<{ ok: true }>('view_copy', 'POST', { db, view, targetDb }),
  truncate: (db: string, tables: string[], confirm: string, ignoreFks: boolean) => request<{ ok: true; done: string[] }>('tables_truncate', 'POST', { db, tables, confirm, ignoreFks }),
  drop: (db: string, tables: string[], confirm: string, ignoreFks: boolean) => request<{ ok: true; done: string[] }>('tables_drop', 'POST', { db, tables, confirm, ignoreFks }),

  exportStart: (req: { db: string; tables: string[]; format: string; options: Record<string, unknown> }, signal?: AbortSignal) => request<ExportStatus>('export_start', 'POST', req, signal),
  exportStep: (id: string, signal?: AbortSignal) => request<ExportStatus>('export_step', 'POST', { id }, signal),
  exportStatus: (id: string) => request<ExportStatus>('export_status', 'GET', { id }),
  exportCancel: (id: string) => request<{ ok: true }>('export_cancel', 'POST', { id }),
  importStatus: (id: string) => request<ImportProgress>('import_status', 'GET', { id }),

  importRun: (id: string, db: string, noFkChecks: boolean, continueOnError: boolean, retarget: string[] | null, signal?: AbortSignal) =>
    request<ImportProgress>('import_run', 'POST', { id, db, noFkChecks, continueOnError, retarget }, signal),
  importFinish: (id: string) => request<{ ok: true }>('import_finish', 'POST', { id }),
};



/** What the start of a dump says about its source (server/src/SqlRetarget.php inspect()). */
export interface DumpInfo {
  database: string | null;
  uses: string[];
  createDbs: string[];
  qualified: string[];
  /** Every source database name found (dropped as qualifiers when importing elsewhere). */
  sources: string[];
  wordpress: { prefix: string } | null;
  statements: number;
}

/** Send the first 256 KB of a dump (raw) and get what it says about its source. */
export async function importInspect(head: Uint8Array): Promise<DumpInfo> {
  const res = await fetch('api.php?a=import_inspect', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': csrfToken() },
    body: head as BodyInit,
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError({ code: 'unexpected_response', message: `Unexpected response (${res.status})`, details: { status: res.status, body: text.slice(0, 500) } }, res.status);
  }
  if (!res.ok || data?.error) throw new ApiError(data?.error ?? { code: 'unexpected_response', message: `HTTP ${res.status}` }, res.status);
  return data as DumpInfo;
}

/** Upload one import chunk (raw body). */
export async function importUpload(id: string | null, offset: number, chunk: Uint8Array, signal?: AbortSignal): Promise<{ id: string; size: number }> {
  const url = `api.php?a=import_upload&offset=${offset}${id ? `&id=${id}` : ''}`;
  // Production: confirm once for the whole import (lib/writeGuard.ts).
  if (!(await allowWrite('import_upload'))) throw new ApiError({ code: 'cancelled', message: 'Cancelled: nothing was written' }, 0);
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': csrfToken() },
    body: chunk as BodyInit,
    signal,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error ?? { code: 'bad_response', message: `HTTP ${res.status}` }, res.status);
  return data;
}
