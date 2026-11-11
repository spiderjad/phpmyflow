// What kind of statement a piece of SQL is, for confirmations (production
// connections, "confirm UPDATE with WHERE"). Leading comments are skipped;
// strings are not parsed: this only looks at the first keyword.

const LEADING = /^(?:\s+|--[^\n]*(?:\n|$)|#[^\n]*(?:\n|$)|\/\*(?!!)[\s\S]*?\*\/)*/;

/** First keyword, upper case ("" when there is none). */
export function firstKeyword(sql: string): string {
  const rest = sql.replace(LEADING, '');
  const m = /^\(*\s*([A-Za-z]+)/.exec(rest);
  return m ? m[1].toUpperCase() : '';
}

const READ = new Set(['SELECT', 'SHOW', 'EXPLAIN', 'DESCRIBE', 'DESC', 'HELP', 'USE', 'VALUES', 'TABLE']);

/** Statements that never write (WITH … SELECT included; WITH … UPDATE/DELETE is a write). */
export function isReadOnlySql(sql: string): boolean {
  const k = firstKeyword(sql);
  if (k === 'WITH') return !/\b(update|delete|insert|replace)\b/i.test(sql.replace(LEADING, ''));
  return READ.has(k);
}

/** "UPDATE" / "DELETE" when the statement is one of those and has a WHERE, else null. */
export function writesWithWhere(sql: string): 'UPDATE' | 'DELETE' | null {
  const k = firstKeyword(sql);
  if ((k === 'UPDATE' || k === 'DELETE') && /\bwhere\b/i.test(sql)) return k;
  return null;
}
