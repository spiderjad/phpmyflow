// Text helpers that keep character offsets intact, so positions found in
// the masked text map 1:1 to the editor document.

/** Replace the content of strings and comments with spaces (same length). */
export function mask(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '\\') j += 2;
        else if (sql[j] === ch && sql[j + 1] === ch) j += 2;
        else if (sql[j] === ch) break;
        else j++;
      }
      out += ch + ' '.repeat(Math.max(0, Math.min(j, sql.length) - i - 1)) + (j < sql.length ? ch : '');
      i = j + 1;
    } else if ((ch === '-' && next === '-') || ch === '#') {
      const j = sql.indexOf('\n', i);
      const end = j === -1 ? sql.length : j;
      out += ' '.repeat(end - i);
      i = end;
    } else if (ch === '/' && next === '*') {
      const j = sql.indexOf('*/', i + 2);
      const end = j === -1 ? sql.length : j + 2;
      out += sql.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

export interface Statement {
  text: string;
  from: number;
  to: number;
}

/** Split on semicolons outside strings/comments. Empty statements are dropped. */
export function splitStatements(sql: string): Statement[] {
  const masked = mask(sql);
  const result: Statement[] = [];
  let start = 0;
  const push = (end: number) => {
    const raw = sql.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text) result.push({ text, from: start + lead, to: start + lead + text.length });
  };
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === ';') {
      push(i);
      start = i + 1;
    }
  }
  push(sql.length);
  return result;
}

/** Statement under the cursor (or the closest one before it). */
export function statementAt(sql: string, pos: number): Statement | null {
  const list = splitStatements(sql);
  if (!list.length) return null;
  return list.find((s) => pos >= s.from && pos <= s.to + 1) ?? [...list].reverse().find((s) => s.to < pos) ?? list[0];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Offsets of an identifier as a whole word (optionally backticked), outside strings. */
export function findIdentifier(masked: string, name: string, from = 0): { from: number; to: number } | null {
  const re = new RegExp('(?<![\\w$])`?' + escapeRe(name) + '`?(?![\\w$])', 'gi');
  re.lastIndex = from;
  const m = re.exec(masked);
  return m ? { from: m.index, to: m.index + m[0].length } : null;
}

/** Word that starts at (or contains) an offset. */
export function wordAt(text: string, offset: number): { from: number; to: number } {
  let from = offset;
  let to = offset;
  while (from > 0 && /[\w$`.]/.test(text[from - 1])) from--;
  while (to < text.length && /[\w$`.]/.test(text[to])) to++;
  if (to === from) to = Math.min(text.length, from + 1);
  return { from, to };
}
