// Turn grid data into text for the clipboard or a file: TSV (paste into
// Excel / Google Sheets), JSON, CSV, Markdown, SQL INSERT and an IN (…) list.
// `undefined` = a hole in a Ctrl+click selection (emitted as empty / null).
import type { Cell } from './api';
import { spreadsheetSafe, toCsv } from './grid';

type Value = Cell | undefined;

export interface SerialColumn {
  name: string;
  /** Numeric column: numbers stay numbers (JSON, INSERT) and get the locale decimal separator (TSV). */
  numeric: boolean;
}

/** Decimal separator of a locale: "," for es/it/fr, "." for en. */
export function decimalSeparator(locale: string): string {
  return (1.5).toLocaleString(locale).includes(',') ? ',' : '.';
}

const isBinary = (v: Value): v is { $binary: number } => v !== null && typeof v === 'object';

/** One TSV field. Quoted (Excel style) only when it holds a tab, newline or quote. */
function tsvField(v: Value, numeric: boolean, sep: string): string {
  if (v === null || v === undefined || isBinary(v)) return '';
  let s = String(v);
  if (numeric && sep !== '.' && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) s = s.replace('.', sep);
  else s = spreadsheetSafe(s);
  return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * TSV with a header row, ready to paste into a spreadsheet (formula-like
 * text neutralized, see spreadsheetSafe). A single cell is copied as its
 * bare value (no header, no quoting) like spreadsheets do.
 */
export function toTsv(cols: SerialColumn[], rows: Value[][], locale: string): string {
  const sep = decimalSeparator(locale);
  if (rows.length === 1 && cols.length === 1) {
    const v = rows[0][0];
    if (v === null || v === undefined || isBinary(v)) return '';
    const s = String(v);
    return cols[0].numeric && sep !== '.' && /^-?\d+(\.\d+)?$/.test(s) ? s.replace('.', sep) : s;
  }
  const lines = [cols.map((c) => tsvField(c.name, false, sep)).join('\t')];
  for (const row of rows) lines.push(row.map((v, j) => tsvField(v, cols[j].numeric, sep)).join('\t'));
  return lines.join('\r\n');
}

/** JS number, except integers beyond 2^53 (BIGINT ids) which keep their text. */
function jsonNumber(v: string | number): number | string {
  if (typeof v === 'number') return v;
  const x = Number(v);
  if (!Number.isFinite(x) || v.trim() === '') return v;
  if (/^-?\d+$/.test(v) && !Number.isSafeInteger(x)) return v;
  return x;
}

export function toJson(cols: SerialColumn[], rows: Value[][]): string {
  const out = rows.map((row) => {
    const o: Record<string, unknown> = {};
    cols.forEach((c, j) => {
      const v = row[j];
      if (v === undefined || v === null || isBinary(v)) o[c.name] = null;
      else o[c.name] = c.numeric ? jsonNumber(v) : v;
    });
    return o;
  });
  return JSON.stringify(out, null, 2);
}

export function toCsvText(cols: SerialColumn[], rows: Value[][]): string {
  return toCsv(
    cols,
    rows.map((r) => r.map((v) => (v === undefined ? null : v))),
  );
}

function mdCell(v: Value): string {
  if (v === undefined) return '';
  if (v === null) return 'NULL';
  if (isBinary(v)) return `(binary ${v.$binary} B)`;
  return String(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

export function toMarkdown(cols: SerialColumn[], rows: Value[][]): string {
  const head = `| ${cols.map((c) => mdCell(c.name)).join(' | ')} |`;
  const rule = `| ${cols.map((c) => (c.numeric ? '---:' : '---')).join(' | ')} |`;
  return [head, rule, ...rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`)].join('\n');
}

const ident = (name: string) => '`' + name.replace(/`/g, '``') + '`';

/** SQL string literal safe for MySQL in both NO_BACKSLASH_ESCAPES modes. */
export function sqlLiteral(v: Value, numeric: boolean): string {
  if (v === undefined || v === null || isBinary(v)) return 'NULL';
  const s = String(v);
  if (numeric && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) return s;
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\0/g, '\\0') + "'";
}

/** One multi-row INSERT. `table` may be empty for a query result. */
export function toInsert(table: string, cols: SerialColumn[], rows: Value[][]): string {
  const target = table ? ident(table) : '`table_name`';
  const values = rows.map((r) => `  (${r.map((v, j) => sqlLiteral(v, cols[j].numeric)).join(', ')})`);
  return `INSERT INTO ${target} (${cols.map((c) => ident(c.name)).join(', ')}) VALUES\n${values.join(',\n')};`;
}

/** "(1, 2, 3)" or "('a', 'b')" from one column, without duplicates or holes. */
export function toInList(col: SerialColumn, values: Value[]): string {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const v of values) {
    if (v === undefined || isBinary(v)) continue;
    const lit = sqlLiteral(v, col.numeric);
    if (!seen.has(lit)) {
      seen.add(lit);
      items.push(lit);
    }
  }
  return `(${items.join(', ')})`;
}

export function columnNames(cols: SerialColumn[]): string {
  return cols.map((c) => c.name).join(', ');
}
