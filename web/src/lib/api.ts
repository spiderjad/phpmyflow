// Thin client for server/api.php. Every write sends the CSRF token.
import { allowWrite } from './writeGuard';
import { markActivity } from './idle.svelte';

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;
  constructor(body: ApiErrorBody, status: number) {
    super(body.message);
    this.code = body.code;
    this.status = status;
    this.details = (body.details && !Array.isArray(body.details) ? body.details : {}) as Record<string, unknown>;
  }
}

let csrf = '';
let onUnauthenticated: (() => void) | null = null;

export function setCsrf(token: string) {
  csrf = token;
}

/** For raw requests (chunk uploads) that can't go through request(). */
export function csrfToken(): string {
  return csrf;
}

export function onSessionLost(fn: () => void) {
  onUnauthenticated = fn;
}

export async function request<T>(action: string, method: 'GET' | 'POST', payload?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let url = `api.php?a=${encodeURIComponent(action)}`;
  const init: RequestInit = { method, credentials: 'same-origin', headers: {}, signal };
  if (method === 'GET' && payload) {
    for (const [k, v] of Object.entries(payload)) {
      if (v === undefined || v === null) continue;
      url += `&${encodeURIComponent(k)}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : String(v))}`;
    }
  }
  if (method === 'POST') {
    // Production connection: confirm before anything that writes (lib/writeGuard.ts).
    if (!(await allowWrite(action, payload))) throw new ApiError({ code: 'cancelled', message: 'Cancelled: nothing was written' }, 0);
    init.headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf };
    init.body = JSON.stringify(payload ?? {});
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError({ code: 'network', message: 'Network error' }, 0);
  }
  let data: any;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    // Not JSON (a proxy page, a PHP message printed by an old server...):
    // keep what came back for "Show technical details".
    throw new ApiError({ code: 'unexpected_response', message: `Unexpected response (${res.status})`, details: { status: res.status, body: text.slice(0, 500) } }, res.status);
  }
  // Error envelopes come with a 4xx/5xx status. A 200 body may still carry
  // an `error` field as data (e.g. `check` returns { ok: false, error }),
  // which is a result for the caller, not a failed request.
  if (!res.ok || (data?.error && data.ok === undefined)) {
    const err = new ApiError(data?.error ?? { code: 'unexpected_response', message: `Unexpected response (${res.status})`, details: { status: res.status, body: text.slice(0, 500) } }, res.status);
    if (err.code === 'not_authenticated' && action !== 'session') onUnauthenticated?.();
    throw err;
  }
  // Any request with a session renews it on the server (not the public ones).
  if (action !== 'session' && action !== 'login' && action !== 'login_test') markActivity();
  return data as T;
}

// --- types shared with the UI ---

export interface Session {
  version: string;
  /** AGPL-3.0: where to get the source code of this copy (config 'source_url'). */
  sourceUrl?: string;
  csrf: string;
  auth: { user: string; host: string; port: number; ssl?: boolean } | null;
  /** ssl: the server uses SSL; sslChoice: users may change SSL on the login screen. */
  servers: {
    label: string;
    host: string;
    port: number;
    ssl?: boolean;
    sslChoice?: boolean;
    /** config.php 'color' (one of the 8 system colors) and 'env'. */
    color?: import('./theme').ColorId | null;
    env?: import('./connections').Env | null;
  }[];
  allowCustomHost: boolean;
  /** Labels of the CA files in config.php ('ssl_ca_files'); '' = system store. */
  sslCaFiles?: string[];
  readOnly: boolean;
  ai: boolean;
  /** The server can gzip exports (zlib). */
  gzip?: boolean;
  /** Seconds of inactivity before the server ends the session. */
  idleSeconds?: number;
  /** Appearance defaults from config.php ('ui'); uiLocked = users can't change them. */
  ui?: Partial<import('./theme').Appearance>;
  uiLocked?: boolean;
}

/** SSL choices sent from the login form (ignored for listed servers without 'ssl_choice'). */
export interface LoginSsl {
  enabled: boolean;
  verify: boolean;
  /** '' = system trust store, otherwise a label from Session.sslCaFiles. */
  ca: string;
}

export interface DatabaseInfo {
  name: string;
  system: boolean;
  /** Data + indexes, from table statistics. */
  bytes: number;
  tables: number;
}

export interface TableInfo {
  name: string;
  type: string;
  approxRows: number | null;
  bytes: number | null;
  dataBytes: number | null;
  indexBytes: number | null;
  freeBytes: number | null;
  engine: string | null;
  comment: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  dataType: string;
  nullable: boolean;
  key: string;
  default: string | null;
  extra: string;
  comment: string;
}

export type SchemaMap = Record<
  string,
  {
    type: string;
    comment: string;
    columns: { name: string; type: string; key: string; nullable: boolean; comment: string }[];
    foreignKeys: { column: string; references: string }[];
    /** Relations by naming convention (no FOREIGN KEY), see Schema::inferRelations. */
    inferredKeys?: { column: string; references: string }[];
  }
>;

export interface Relation {
  from: string;
  column: string;
  to: string;
  toColumn: string;
  kind: 'declared' | 'inferred';
}

/** Polymorphic pair: the type column says which table the id points to. */
export interface Polymorphic {
  table: string;
  typeColumn: string;
  idColumn: string;
}

export interface RefCount {
  table: string;
  column: string;
  kind: Relation['kind'];
  count: number;
  more: boolean;
}

export type Cell = string | number | null | { $binary: number };

export interface RowsResult {
  columns: ColumnInfo[];
  primaryKey: string[];
  rows: Record<string, Cell>[];
  /** Exact total when this page already proves it; otherwise null (ask `count`). */
  total: number | null;
  /** information_schema estimate, shown as "~N" while counting. */
  estimate: number;
  filtered: boolean;
  page: number;
  perPage: number;
  timeMs: number;
}

export type QueryResult =
  | { type: 'resultset'; columns: { name: string; type: string }[]; rows: Cell[][]; truncated: boolean; maxRows: number; timeMs: number }
  | { type: 'affected'; verb: string; affected: number; timeMs: number }
  | { needsConfirm: true; reason: string; verb: string };

export interface CheckResult {
  ok: boolean;
  skipped?: boolean;
  error?: ApiErrorBody;
}

export type AiMode = 'generate' | 'explain' | 'fix' | 'optimize' | 'optimize_digest' | 'peak' | 'columns';
export interface AiResult {
  sql: string;
  explanation: string;
  warnings: string[];
}

// --- monitor ---

export interface MissingPrivilege {
  code: 'missing_privilege';
  privilege: string;
  grant: string;
}

export interface MonitorCaps {
  flavor: 'mysql' | 'mariadb';
  version: string;
  performanceSchema: boolean;
  performanceSchemaReadable: boolean;
  privileges: string[];
  hasProcess: boolean;
  grantee: string;
  grants: { process: string; replication: string; performanceSchema: string };
  connectionId: number;
  collector: CollectorStatus;
  thresholds: Record<string, { warn: number; crit: number }>;
  readOnly: boolean;
}

export interface CollectorStatus {
  monitorUser: boolean;
  monitorServer: string | null;
  pseudoCron: boolean;
  sqlite: boolean;
  cron: string;
  lastRun: number | null;
  server: string | null;
  storage?: 'sqlite' | 'jsonl';
}

export interface LiveSample {
  status: Record<string, number | string>;
  variables: Record<string, string>;
  ms: number;
  cached?: boolean;
  system: { sameHost: boolean; load?: number[]; memTotal?: number; memAvailable?: number; diskFree?: number; diskTotal?: number };
}

export interface ProcessRow {
  id: number;
  user: string;
  host: string;
  db: string | null;
  command: string;
  time: number;
  state: string | null;
  info: string | null;
  self: boolean;
}

export interface DigestRow {
  digest: string;
  db: string | null;
  text: string;
  count: number;
  total: number;
  avg: number;
  max: number;
  p95: number | null;
  examined: number;
  sent: number;
  noIndex: number;
  noGoodIndex: number;
  tmpDisk: number;
  lastSeen: string;
  hasSample: boolean;
}

export interface SlowLog {
  enabled: boolean;
  longQueryTime: number;
  file: string;
  output: string;
}

export interface TopQueries {
  available: boolean;
  reason?: 'performance_schema_off' | 'missing_privilege';
  missing?: MissingPrivilege;
  rows?: DigestRow[];
  canReset?: boolean;
  slowLog: SlowLog;
}

export interface StorageInfo {
  databases: { db: string; data: number; idx: number; free: number; tables: number }[];
  tables: { db: string; name: string; engine: string; approxRows: number; data: number; idx: number; free: number }[];
  fragmented: StorageInfo['tables'];
}

export interface AdvisorItem {
  id: string;
  level: 'ok' | 'info' | 'warn' | 'crit';
  params: Record<string, unknown>;
  ref: string;
}

export interface Deadlock {
  time: string | null;
  rolledBack: number | null;
  transactions: {
    n: number;
    id: string | null;
    thread: number | null;
    user: string | null;
    host: string | null;
    state: string | null;
    query: string;
    holds: { type: string; index: string | null; table: string; mode: string }[];
    waits: { type: string; index: string | null; table: string; mode: string }[];
  }[];
}

export interface HistorySeries {
  resolution: 'minute' | 'hour';
  ts: number[];
  series: Record<string, (number | null)[]>;
  max?: Record<string, (number | null)[]>;
}

export interface PeakSummary {
  id: string;
  ts: number;
  peaks: { metric: string; value: number; threshold: number }[];
}

export interface MonitorHistory extends HistorySeries {
  peaks: PeakSummary[];
  sizes: { ts: number; db: string; bytes: number }[];
  collector: CollectorStatus;
  compare?: HistorySeries;
}

export interface PeakDetail extends PeakSummary {
  snapshot: {
    rates: Record<string, number | null>;
    processes: ProcessRow[];
    digests: Pick<DigestRow, 'digest' | 'db' | 'text' | 'count' | 'total' | 'avg' | 'examined'>[];
  };
}

export const monitorApi = {
  caps: () => request<MonitorCaps>('monitor_caps', 'GET'),
  live: () => request<LiveSample>('monitor_live', 'GET'),
  processlist: (hideLiterals: boolean) =>
    request<{ rows: ProcessRow[]; selfId: number; limited: MissingPrivilege | null }>('processlist', 'GET', { hideLiterals: hideLiterals ? 1 : 0 }),
  explain: (id: number) => request<{ columns: { name: string; type: string }[]; rows: Cell[][] }>('monitor_explain', 'GET', { id }),
  kill: (id: number, queryOnly: boolean, selfId: number) => request<{ ok: true }>('monitor_kill', 'POST', { id, queryOnly, selfId }),
  topQueries: (sort: string) => request<TopQueries>('top_queries', 'GET', { sort }),
  digest: (digest: string) =>
    request<{ text: string; db: string | null; explain: { columns: { name: string; type: string }[]; rows: Cell[][] } | null }>('digest_detail', 'GET', { digest }),
  resetDigests: () => request<{ ok: true }>('monitor_reset_digests', 'POST'),
  storage: () => request<StorageInfo>('monitor_storage', 'GET'),
  optimize: (db: string, table: string) => request<{ ok: true; timeMs: number }>('monitor_optimize', 'POST', { db, table }),
  advisor: () => request<{ items: AdvisorItem[] }>('monitor_advisor', 'GET'),
  deadlock: (hideLiterals: boolean) =>
    request<{ available: boolean; missing?: MissingPrivilege; deadlock?: Deadlock | null }>('monitor_deadlock', 'GET', { hideLiterals: hideLiterals ? 1 : 0 }),
  history: (from: number, to: number, compare: boolean) => request<MonitorHistory>('monitor_history', 'GET', { from, to, compare: compare ? 1 : 0 }),
  peak: (id: string) => request<PeakDetail>('monitor_peak', 'GET', { id }),
};

export interface FkIssue {
  level: 'error' | 'warn' | 'info';
  code: string;
  params?: Record<string, unknown>;
  fix?: { column: string; columnType: string; collation: string | null };
}

/** "Stay signed in": renews the session on the server. */
export const keepalive = () => request<{ ok: true; idleSeconds: number }>('keepalive', 'GET');

export const editorApi = {
  info: (db: string, table: string) => request<import('./tableDraft').TableInfo>('table_info', 'GET', { db, table }),
  preview: (db: string, table: string, changes: Record<string, unknown>) =>
    request<{ sql: string; warnings: import('./tableDraft').ServerWarning[] }>('alter_preview', 'POST', { db, table, changes }),
  apply: (db: string, table: string, changes: Record<string, unknown>) => request<{ ok: true; sql: string; timeMs: number }>('alter_apply', 'POST', { db, table, changes }),
  fkChecks: (db: string, table: string, foreignKeys: unknown[], columns: Record<string, unknown>, checks: { id: string; expr: string }[] = [], uniques: { id: string; columns: string[] }[] = []) =>
    request<{
      results: Record<string, FkIssue[]>;
      checks: Record<string, { ok: boolean; count?: number; more?: boolean; error?: string; message?: string }>;
      uniques: Record<string, { groups?: number; rows?: number; more?: boolean; error?: string }>;
    }>('ddl_checks', 'POST', { db, table, foreignKeys, columns, checks, uniques }),
  incoming: (db: string, table: string) =>
    request<{ incoming: (Relation & { count: number; more: boolean })[] }>('fk_incoming', 'GET', { db, table }),
};

export const api = {
  session: () => request<Session>('session', 'GET'),
  login: (host: string, port: number, user: string, password: string, ssl?: LoginSsl) =>
    request<{ ok: true; auth: Session['auth']; csrf: string }>('login', 'POST', { host, port, user, password, ssl }),
  /** Connects and disconnects: no session. Wrong passwords still count for the rate limit. */
  loginTest: (host: string, port: number, user: string, password: string, ssl?: LoginSsl) =>
    request<{ ok: true; version: string; sslCipher: string | null }>('login_test', 'POST', { host, port, user, password, ssl }),
  logout: () => request<{ ok: true }>('logout', 'POST'),
  databases: () => request<{ databases: DatabaseInfo[]; serverVersion: string; timeZone?: string }>('databases', 'GET'),
  tables: (db: string) => request<{ tables: TableInfo[] }>('tables', 'GET', { db }),
  schema: (db: string) => request<{ tables: SchemaMap; relations: Relation[]; polymorphic?: Polymorphic[] }>('schema', 'GET', { db }),
  /** Distinct type values of a polymorphic pair (bounded sample, read-only). */
  polyTypes: (db: string, table: string, column: string) => request<{ types: string[]; more: boolean }>('poly_types', 'GET', { db, table, column }),
  refCounts: (p: { db: string; table: string; value: string | number }) => request<{ counts: RefCount[] }>('ref_counts', 'GET', p),
  rows: (p: { db: string; table: string; page: number; perPage: number; sort?: string; dir?: 'ASC' | 'DESC'; filters?: Record<string, string> }) =>
    request<RowsResult>('rows', 'GET', p),
  count: (p: { db: string; table: string; filters?: Record<string, string>; exact?: '1' }) =>
    request<{ total: number; approx: boolean; timeMs: number }>('count', 'GET', p),
  updateCell: (p: { db: string; table: string; column: string; key: Record<string, Cell>; value: string | null }) =>
    request<{ ok: true; affected: number }>('update_cell', 'POST', p),
  insertRow: (p: { db: string; table: string; values: Record<string, string | number | null> }) =>
    request<{ ok: true; insertId: string | null; affected: number }>('insert_row', 'POST', p),
  deleteRows: (p: { db: string; table: string; keys: Record<string, Cell>[] }) =>
    request<{ ok: true; affected: number }>('delete_rows', 'POST', p),
  query: (p: { db: string; sql: string; confirm?: boolean }) => request<QueryResult>('query', 'POST', p),
  check: (p: { db: string; sql: string }) => request<CheckResult>('check', 'POST', p),
  ai: (p: { db: string; mode: AiMode; lang: string; prompt?: string; sql?: string; error?: string }) =>
    request<AiResult>('ai', 'POST', p),
};
