// Database tools (phase C): maintenance, server-wide search, bulk editor,
// test data. One table per request so every job shows progress and stops
// between tables when cancelled.
import { request } from './api';

export type MaintOp = 'OPTIMIZE' | 'ANALYZE' | 'CHECK' | 'REPAIR' | 'CHECKSUM';
export type SearchMode = 'contains' | 'exact' | 'starts' | 'regex';

export interface BulkChanges {
  engine?: string | null;
  collation?: string | null;
  convert?: boolean;
  comment?: string | null;
  moveTo?: string | null;
}

export interface GenColumn {
  name: string;
  dataType: string;
  columnType: string;
  nullable: boolean;
  unique: boolean;
  length: number | null;
  values: string[];
  fk: { table: string; column: string; kind: 'declared' | 'inferred' } | null;
  strategy: string;
  options: { min?: number; max?: number; from?: string; to?: string; nullPct?: number };
  skip?: boolean;
}

export const toolsApi = {
  maintenance: (db: string, table: string, op: MaintOp, option: string | null, signal?: AbortSignal) =>
    request<{ status: 'ok' | 'warning' | 'error'; messages: string[]; ms: number; engine: string }>('maint_run', 'POST', { db, table, op, option }, signal),
  searchPlan: (dbs: string[] | null, tables: string[] | null) =>
    request<{ tables: { db: string; table: string; approxRows: number; textCols: number }[] }>('search_plan', 'POST', { dbs, tables }),
  searchTable: (p: { db: string; table: string; q: string; mode: SearchMode; caseSensitive: boolean; allColumns: boolean; timeoutMs: number }, signal?: AbortSignal) =>
    request<{ matches: { column: string; count: number }[]; timedOut: boolean; ms: number; skipped?: boolean }>('search_table', 'POST', p, signal),
  bulkPlan: (db: string, tables: string[], changes: BulkChanges) =>
    request<{ tables: { table: string; engine: string; collation: string; bytes: number; statements: string[]; seconds: number }[]; rebuild: boolean }>('bulk_plan', 'POST', { db, tables, changes }),
  bulkApply: (db: string, table: string, changes: BulkChanges, signal?: AbortSignal) =>
    request<{ ok: true; sql: string[]; ms: number }>('bulk_apply', 'POST', { db, table, changes }, signal),
  genPlan: (db: string, table: string) => request<{ columns: GenColumn[]; managedBy: 'glpi' | 'wordpress' | null; approxRows: number }>('gen_plan', 'GET', { db, table }),
  genPreview: (db: string, table: string, columns: GenColumn[], seed: number, token: string) =>
    request<{ columns: string[]; rows: unknown[][] }>('gen_rows', 'POST', { db, table, columns, count: 10, start: 0, seed, token }),
  genInsert: (db: string, table: string, columns: GenColumn[], count: number, start: number, seed: number, token: string, signal?: AbortSignal) =>
    request<{ inserted: number }>('gen_rows', 'POST', { db, table, columns, count, start, seed, token, insert: true }, signal),
};

/** Strategies offered per type family (the server re-validates). */
export function strategiesFor(c: GenColumn): string[] {
  const t = c.dataType;
  if (c.fk) return ['fk', 'int', 'null'];
  if (t === 'enum') return ['enum', 'null'];
  if (t === 'set') return ['set', 'null'];
  if (['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint'].includes(t)) return ['int', 'bool', 'null'];
  if (['decimal', 'numeric', 'float', 'double', 'real'].includes(t)) return ['amount', 'int', 'null'];
  if (t === 'date') return ['date', 'null'];
  if (['datetime', 'timestamp'].includes(t)) return ['datetime', 'date', 'null'];
  if (t === 'time') return ['time', 'null'];
  if (t === 'year') return ['year', 'null'];
  if (t === 'json') return ['json', 'null'];
  if (['bit', 'bool', 'boolean'].includes(t)) return ['bool', 'null'];
  return ['name', 'first_name', 'last_name', 'email', 'phone', 'url', 'city', 'country', 'address', 'company', 'code', 'title', 'sentence', 'word', 'uuid', 'null'];
}
