// Tables opened lately, per connection and database: Ctrl+P lists them first.
// Stored in this browser (localStorage) under one key per user@host:port, so
// "Forget this connection" on sign-out removes them with the SQL history.

export interface Recent {
  name: string;
  at: number;
}
type Store = Record<string, Recent[]>;

export const RECENT_MAX = 8;

export function recentKey(a: { user: string; host: string; port?: number | string | null }): string {
  return `pmf_recent_tables:${a.user}@${a.host}:${a.port ?? ''}`;
}

/** The list with `name` on top (once), newest first, at most `max`. */
export function pushRecent(list: Recent[], name: string, now: number, max = RECENT_MAX): Recent[] {
  return [{ name, at: now }, ...list.filter((r) => r.name !== name)].slice(0, max);
}

function read(key: string): Store {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Store) : {};
  } catch {
    return {};
  }
}

export function recentTables(key: string, db: string): Recent[] {
  const list = read(key)[db];
  return Array.isArray(list) ? list.filter((r) => r && typeof r.name === 'string' && typeof r.at === 'number') : [];
}

export function rememberTable(key: string, db: string, name: string, now = Date.now()): void {
  if (!db || !name) return;
  const store = read(key);
  store[db] = pushRecent(recentTables(key, db), name, now);
  try {
    localStorage.setItem(key, JSON.stringify(store));
  } catch {
    /* blocked storage: no recents */
  }
}
