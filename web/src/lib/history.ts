// SQL history: every run with its date, kept per user@host in localStorage
// and grouped by day. Stores only what the user typed plus metadata (never
// results); passwords in account statements are stored as '***'.
import { splitStatements } from './sqlText';

const LITERAL = String.raw`'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"`;
/** Statements that can carry a password: accounts, replication, FEDERATED servers. */
const CREDENTIAL_STATEMENT = /^\s*(CREATE|ALTER|GRANT|SET|CHANGE)\b[\s\S]*\b(IDENTIFIED|PASSWORD|MASTER_PASSWORD|SOURCE_PASSWORD)\b/i;
/** The literal right after BY / AS / USING / PASSWORD / …_PASSWORD / REPLACE (optionally "= ", "PASSWORD(" or "("). */
const AFTER_KEYWORD = new RegExp(
  String.raw`(\b(?:BY|AS|USING|PASSWORD|MASTER_PASSWORD|SOURCE_PASSWORD|REPLACE)\b\s*(?:=\s*)?(?:PASSWORD\s*)?(?:\(\s*)?)(?:${LITERAL})`,
  'gi',
);

/**
 * The statement with every password replaced by '***' (like MySQL's own logs):
 * CREATE / ALTER USER … IDENTIFIED BY / WITH … BY / AS / VIA … USING PASSWORD(),
 * REPLACE 'current', SET PASSWORD, GRANT … IDENTIFIED BY, CHANGE MASTER /
 * REPLICATION SOURCE … _PASSWORD, CREATE / ALTER SERVER … PASSWORD. Anything
 * else is returned unchanged.
 */
export function redactSecrets(sql: string): string {
  if (!CREDENTIAL_STATEMENT.test(sql)) return sql;
  let out = sql.replace(AFTER_KEYWORD, "$1'***'");
  if (/^\s*SET\s+PASSWORD\b/i.test(out)) {
    const eq = out.indexOf('=');
    if (eq >= 0) out = out.slice(0, eq) + out.slice(eq).replace(new RegExp(LITERAL, 'g'), "'***'");
  }
  return out;
}

/** redactSecrets for every statement of an editor text (offsets kept for the rest). */
export function redactScript(sql: string): string {
  let out = sql;
  for (const st of splitStatements(sql).reverse()) {
    const clean = redactSecrets(st.text);
    if (clean !== st.text) out = out.slice(0, st.from) + clean + out.slice(st.to);
  }
  return out;
}

export interface HistoryEntry {
  id: string;
  sql: string;
  db: string;
  /** Epoch ms of the last run. 0 = migrated from the old undated history. */
  at: number;
  ok: boolean;
  /** Error code when it failed (e.g. "mysql.1064"), never the row data. */
  error?: string;
  ms?: number;
  rows?: number;
  /** Times the same statement ran back to back. */
  count: number;
}

export const MAX_ENTRIES = 1000;
export const MAX_AGE_DAYS = 90;
const DAY = 86_400_000;

export function historyKey(auth: { user: string; host: string; port: number } | null | undefined): string {
  return auth ? `pmf_history:${auth.user}@${auth.host}:${auth.port}` : '';
}

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/**
 * Add a run on top. If the newest entry is the same statement on the same
 * database, update it instead of adding a duplicate row.
 */
export function addRun(list: HistoryEntry[], run: Omit<HistoryEntry, 'id' | 'count'>): HistoryEntry[] {
  const sql = redactSecrets(run.sql.trim());
  if (!sql) return list;
  const top = list[0];
  if (top && top.sql === sql && top.db === run.db) {
    return [{ ...top, ...run, sql, count: top.count + 1 }, ...list.slice(1)];
  }
  return prune([{ ...run, sql, id: newId(), count: 1 }, ...list], run.at);
}

/** Drop entries older than MAX_AGE_DAYS (undated ones stay) and cap the size. */
export function prune(list: HistoryEntry[], now: number): HistoryEntry[] {
  const cutoff = now - MAX_AGE_DAYS * DAY;
  return list.filter((e) => e.at === 0 || e.at >= cutoff).slice(0, MAX_ENTRIES);
}

/** Case-insensitive search over the SQL text and the database name. */
export function searchHistory(list: HistoryEntry[], query: string): HistoryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((e) => e.sql.toLowerCase().includes(q) || e.db.toLowerCase().includes(q));
}

export interface DayGroup {
  /** 'YYYY-MM-DD' local date, or 'older' for undated entries. */
  key: string;
  kind: 'today' | 'yesterday' | 'date' | 'older';
  entries: HistoryEntry[];
}

const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Group entries (newest first) by local calendar day. */
export function groupByDay(list: HistoryEntry[], now: number): DayGroup[] {
  const today = localDay(now);
  const yesterday = localDay(new Date(now).setDate(new Date(now).getDate() - 1));
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  const sorted = [...list].sort((a, b) => (b.at || -1) - (a.at || -1));
  for (const e of sorted) {
    const key = e.at === 0 ? 'older' : localDay(e.at);
    let g = byKey.get(key);
    if (!g) {
      g = { key, kind: key === 'older' ? 'older' : key === today ? 'today' : key === yesterday ? 'yesterday' : 'date', entries: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.entries.push(e);
  }
  return groups;
}

function isEntry(x: unknown): x is HistoryEntry {
  const e = x as HistoryEntry;
  return !!e && typeof e.sql === 'string' && typeof e.db === 'string' && typeof e.at === 'number';
}

export function loadHistory(storage: Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>, key: string): HistoryEntry[] {
  if (!key) return [];
  try {
    const raw = storage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isEntry).map((e) => ({ ...e, id: e.id || newId(), count: e.count || 1 })) : [];
    }
    // One-time migration of the old undated list (string[] under pmf_history).
    const old = storage.getItem('pmf_history');
    if (old) {
      const list = JSON.parse(old);
      storage.removeItem('pmf_history');
      if (Array.isArray(list)) {
        const migrated = list
          .filter((s): s is string => typeof s === 'string' && !!s.trim())
          .map((sql) => ({ id: newId(), sql: sql.trim(), db: '', at: 0, ok: true, count: 1 }));
        saveHistory(storage, key, migrated);
        return migrated;
      }
    }
  } catch {
    /* corrupt or blocked storage */
  }
  return [];
}

export function saveHistory(storage: Pick<Storage, 'setItem'>, key: string, list: HistoryEntry[]) {
  if (!key) return;
  try {
    storage.setItem(key, JSON.stringify(list));
  } catch {
    /* quota or blocked: keep it in memory only */
  }
}
