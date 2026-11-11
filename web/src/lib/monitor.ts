// Monitor math in the browser: per-second rates between two SHOW GLOBAL
// STATUS snapshots (mirror of server/src/Metrics.php::rates), a 15-minute
// ring buffer, threshold levels and unit formatting. Pure: unit-tested.

export type Raw = Record<string, number | string>;

export const SERIES = [
  'qps', 'select', 'insert', 'update', 'delete', 'other', 'threads_running', 'threads_connected', 'bytes_in', 'bytes_out',
  'tmp_disk', 'tmp', 'sorts', 'sort_merge', 'row_lock_waits', 'row_lock_ms', 'slow_per_min', 'bp_hit', 'aborted_connects',
  'max_used', 'max_connections',
] as const;
export type Metric = (typeof SERIES)[number];
export type Rates = Record<Metric, number | null>;

const num = (r: Raw, k: string) => Number(r[k] ?? 0) || 0;

const COUNTERS = [
  'Questions', 'Com_select', 'Com_insert', 'Com_update', 'Com_delete', 'Com_replace', 'Bytes_received', 'Bytes_sent',
  'Created_tmp_disk_tables', 'Created_tmp_tables', 'Sort_scan', 'Sort_range', 'Sort_merge_passes', 'Slow_queries',
  'Innodb_row_lock_waits', 'Innodb_row_lock_time', 'Innodb_buffer_pool_read_requests', 'Innodb_buffer_pool_reads',
  'Aborted_connects', 'Aborted_clients', 'Connections',
];

/**
 * Rates between two snapshots ('_t' = unix seconds). Null when the server
 * restarted or counters were flushed in between (no meaningful delta).
 */
export function rates(prev: Raw, cur: Raw): Rates | null {
  const dt = num(cur, '_t') - num(prev, '_t');
  if (dt <= 0) return null;
  if ('Uptime' in prev && 'Uptime' in cur && num(cur, 'Uptime') < num(prev, 'Uptime')) return null;
  const d: Record<string, number> = {};
  for (const k of COUNTERS) {
    const delta = num(cur, k) - num(prev, k);
    if (delta < 0) return null;
    d[k] = delta;
  }
  const per = (v: number) => v / dt;
  const select = per(d.Com_select);
  const insert = per(d.Com_insert + d.Com_replace);
  const update = per(d.Com_update);
  const del = per(d.Com_delete);
  const qps = per(d.Questions);
  const requests = d.Innodb_buffer_pool_read_requests;
  const maxConn = num(cur, 'max_connections');
  return {
    qps,
    select,
    insert,
    update,
    delete: del,
    other: Math.max(0, qps - select - insert - update - del),
    threads_running: num(cur, 'Threads_running'),
    threads_connected: num(cur, 'Threads_connected'),
    bytes_in: per(d.Bytes_received),
    bytes_out: per(d.Bytes_sent),
    tmp_disk: per(d.Created_tmp_disk_tables),
    tmp: per(d.Created_tmp_tables),
    sorts: per(d.Sort_scan + d.Sort_range),
    sort_merge: per(d.Sort_merge_passes),
    row_lock_waits: per(d.Innodb_row_lock_waits),
    row_lock_ms: per(d.Innodb_row_lock_time),
    slow_per_min: per(d.Slow_queries) * 60,
    bp_hit: requests > 0 ? 1 - d.Innodb_buffer_pool_reads / requests : null,
    aborted_connects: per(d.Aborted_connects),
    max_used: num(cur, 'Max_used_connections'),
    max_connections: maxConn || null,
  };
}

/** Fixed-window buffer of timestamped samples (default 15 minutes). */
export class RingBuffer {
  ts: number[] = [];
  rows: Rates[] = [];
  constructor(public windowSeconds = 900) {}
  push(t: number, r: Rates) {
    this.ts.push(t);
    this.rows.push(r);
    const cutoff = t - this.windowSeconds;
    let drop = 0;
    while (drop < this.ts.length && this.ts[drop] < cutoff) drop++;
    if (drop) {
      this.ts.splice(0, drop);
      this.rows.splice(0, drop);
    }
  }
  series(m: Metric): (number | null)[] {
    return this.rows.map((r) => r[m]);
  }
  get length() {
    return this.ts.length;
  }
  clear() {
    this.ts = [];
    this.rows = [];
  }
}

export type Level = 'ok' | 'warn' | 'crit';
export type Thresholds = Record<string, { warn: number; crit: number }>;

/** Level of a value against warn/crit. `lowerIsWorse` for ratios like the buffer pool hit rate. */
export function level(value: number | null | undefined, t: { warn: number; crit: number } | undefined, lowerIsWorse = false): Level {
  if (value === null || value === undefined || !t || Number.isNaN(value)) return 'ok';
  if (lowerIsWorse) return value < t.crit ? 'crit' : value < t.warn ? 'warn' : 'ok';
  return value > t.crit ? 'crit' : value > t.warn ? 'warn' : 'ok';
}

/** Levels for the live cards / alert badge. */
export function levels(r: Rates, t: Thresholds): Record<string, Level> {
  const connPct = r.max_connections ? r.threads_connected! / r.max_connections : null;
  return {
    connections_pct: level(connPct, t.connections_pct),
    threads_running: level(r.threads_running, t.threads_running),
    slow_per_min: level(r.slow_per_min, t.slow_per_min),
    bp_hit: level(r.bp_hit, t.bp_hit, true),
    tmp_disk: level(r.tmp_disk, t.tmp_disk),
    row_lock_waits: level(r.row_lock_waits, t.row_lock_waits),
  };
}

// --- formatting ---

export function fmtNumber(x: number | null | undefined, locale: string, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  const abs = Math.abs(x);
  const d = abs >= 100 ? 0 : abs >= 10 ? Math.min(digits, 1) : digits;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: d }).format(x);
}

/** 1.2k, 3.4M with the locale decimal separator. */
export function fmtCompact(x: number | null | undefined, locale: string): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(x);
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
export function fmtBytesRate(x: number | null | undefined, locale: string): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  let v = x;
  let i = 0;
  while (v >= 1024 && i < BYTE_UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: v >= 100 || i === 0 ? 0 : 1 }).format(v)} ${BYTE_UNITS[i]}/s`;
}

export function fmtPct(x: number | null | undefined, locale: string, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: digits }).format(x);
}

/** Milliseconds as "850 ms", "12,3 s", "4 min". */
export function fmtMs(ms: number | null | undefined, locale: string): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  const f = (v: number, d = 1) => new Intl.NumberFormat(locale, { maximumFractionDigits: d }).format(v);
  if (ms < 1) return `${f(ms, 2)} ms`;
  if (ms < 1000) return `${f(ms, ms < 10 ? 1 : 0)} ms`;
  if (ms < 60_000) return `${f(ms / 1000)} s`;
  if (ms < 3_600_000) return `${f(ms / 60_000)} min`;
  return `${f(ms / 3_600_000)} h`;
}

/** Uptime seconds as "3 d 4 h", "5 h 12 min", "42 min". */
export function fmtUptime(seconds: number, labels: { d: string; h: string; min: string }): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} ${labels.d} ${h} ${labels.h}`;
  if (h) return `${h} ${labels.h} ${m} ${labels.min}`;
  return `${m} ${labels.min}`;
}

/** Smallest allowed polling interval after a slow monitoring query (> 500 ms). */
export function adaptInterval(current: number, queryMs: number, options = [1, 2, 5, 10]): number {
  if (queryMs <= 500) return current;
  const next = options.find((o) => o > current);
  return next ?? current;
}
