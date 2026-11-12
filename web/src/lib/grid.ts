// Pure helpers for DataGrid: column kinds, auto widths, date formatting, CSV.
// No Svelte or DOM here so they can be unit-tested.
import type { Cell } from './api';

export type ColumnKind = 'number' | 'date' | 'datetime' | 'time' | 'text' | 'binary';

export interface GridColumn {
  name: string;
  /** Base data type: int, varchar, datetime... (or a PDO native type for query results). */
  type: string;
  /** Full type for the header tooltip, e.g. "int(10) unsigned". */
  fullType?: string;
  pk?: boolean;
  nullable?: boolean;
  comment?: string;
}

const NUMERIC = /^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|bit|year|long|longlong|newdecimal|short|tiny|int24)$/i;
const DATETIME = /^(datetime|timestamp)$/i;
const BINARY = /^(blob|tinyblob|mediumblob|longblob|binary|varbinary|geometry|point|linestring|polygon)$/i;

export function columnKind(type: string): ColumnKind {
  const base = type.split('(')[0].trim().toLowerCase();
  if (NUMERIC.test(base)) return 'number';
  if (base === 'date' || base === 'newdate') return 'date';
  if (DATETIME.test(base)) return 'datetime';
  if (base === 'time') return 'time';
  if (BINARY.test(base)) return 'binary';
  return 'text';
}

/** Ids and numbers and dates use the monospace font; prose uses the UI font. */
export function isMonoColumn(col: GridColumn): boolean {
  const kind = columnKind(col.type);
  if (kind !== 'text') return kind !== 'binary';
  return !!col.pk || /(^id$|_id$|^uuid$|_uuid$)/i.test(col.name);
}

/** TINYINT(1) (MySQL's BOOLEAN): shown as ✓ / —. Needs the full type (table data). */
export function isBoolColumn(col: GridColumn): boolean {
  return /^tinyint\(1\)/i.test(col.fullType ?? '');
}

/**
 * Looks like a hash, token or UUID (monospace, like ids): hex of 16+ chars,
 * a UUID, bcrypt / argon / SHA-crypt, or long base64-ish tokens without spaces.
 */
export function isHashLike(s: string): boolean {
  if (s.length < 16 || s.length > 200 || /\s/.test(s)) return false;
  return (
    /^[0-9a-f]{16,}$/i.test(s) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ||
    /^\$(2[aby]|argon2(id|i|d)|[156])\$/.test(s) ||
    (/^[A-Za-z0-9+/_=.-]{24,}$/.test(s) && /\d/.test(s) && /[A-Za-z]/.test(s) && !/^[a-z_.-]+$/i.test(s))
  );
}

/** A text column whose values are hashes / tokens (sampled): shown in monospace. */
export function isHashColumn(rows: Cell[][], j: number, sample = 20): boolean {
  let seen = 0;
  for (let i = 0; i < rows.length && seen < sample; i++) {
    const v = rows[i][j];
    if (v === null || typeof v === 'object' || v === '') continue;
    seen++;
    if (!isHashLike(String(v))) return false;
  }
  return seen > 0;
}

export interface JsonSummary {
  kind: 'object' | 'array';
  /** Keys of an object / items of an array. */
  size: number;
  /** Indented preview (cut). */
  preview: string;
}

const jsonCache = new Map<string, JsonSummary | null>();

/** "{…} 3 keys" for JSON objects and arrays (cached: grid cells render often). */
export function jsonSummary(s: string): JsonSummary | null {
  const c = s.charCodeAt(0);
  if (c !== 123 && c !== 91) return null; // { [
  const hit = jsonCache.get(s);
  if (hit !== undefined) return hit;
  let out: JsonSummary | null = null;
  try {
    const v = JSON.parse(s);
    if (v && typeof v === 'object') {
      const arr = Array.isArray(v);
      out = { kind: arr ? 'array' : 'object', size: arr ? v.length : Object.keys(v).length, preview: JSON.stringify(v, null, 2).slice(0, 1500) };
    }
  } catch {
    out = null;
  }
  if (jsonCache.size > 3000) jsonCache.clear();
  jsonCache.set(s, out);
  return out;
}

/** What a cell shows: NULL and '' are different things. */
export type SpecialCell = 'null' | 'empty' | 'binary' | null;
export function specialCell(v: Cell): SpecialCell {
  if (v === null) return 'null';
  if (typeof v === 'object') return 'binary';
  if (v === '') return 'empty';
  return null;
}

/** Placeholder hint for the filter input, by column kind. */
export function filterKind(type: string): 'number' | 'date' | 'text' {
  const kind = columnKind(type);
  if (kind === 'number') return 'number';
  if (kind === 'date' || kind === 'datetime') return 'date';
  return 'text';
}

const MONO_CHAR = 7.4; // px per char at 12.5px ui-monospace
const PROP_CHAR = 6.9; // average px per char at 13px Inter
const MIN_WIDTH = 56;
const MAX_WIDTH = 420;
const PADDING = 22;

/**
 * Initial column widths from the header and the first `sample` rows.
 * Uses character counts (cheap, deterministic) rather than DOM measuring.
 */
export function autoWidths(columns: GridColumn[], rows: Cell[][], format: (v: Cell, c: GridColumn) => string, sample = 50): number[] {
  return columns.map((col, j) => {
    const mono = isMonoColumn(col);
    const perChar = mono ? MONO_CHAR : PROP_CHAR;
    // Header: name (semibold) + type label.
    let width = col.name.length * 7.4 + (col.type ? col.type.length * 6 + 6 : 0) + (col.pk ? 16 : 0);
    const limit = Math.min(rows.length, sample);
    for (let i = 0; i < limit; i++) {
      const text = format(rows[i][j], col);
      const firstLine = text.length > 80 ? 80 : text.indexOf('\n') === -1 ? text.length : text.indexOf('\n');
      width = Math.max(width, firstLine * perChar);
    }
    return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width + PADDING)));
  });
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;

function parseDate(raw: string): { date: Date; seconds: boolean } | null {
  const m = DATE_RE.exec(raw);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  if (y === '0000' || mo === '00' || d === '00') return null;
  const date = new Date(+y, +mo - 1, +d, +h, +mi, +s);
  return Number.isNaN(date.getTime()) ? null : { date, seconds: s !== '0' && s !== '00' };
}

/**
 * Compact, locale-friendly date: "24 may 2025 22:43" / "May 24, 2025 22:43"
 * (24 h, no seconds). Parsed as wall time (no timezone shift); returned
 * unchanged when it isn't a real date (0000-00-00, garbage).
 */
export function formatDate(raw: string, kind: ColumnKind, locale: string): string {
  const p = parseDate(raw);
  if (!p) return raw;
  try {
    const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(p.date).replace(/\.(?=\s|$)/g, '').replace(/\s+de\s+/g, ' ');
    if (kind === 'date') return day;
    const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(p.date);
    return `${day} ${time}`;
  } catch {
    return raw;
  }
}

/** Tooltip: the full date with seconds and the server time zone, then the raw value. */
export function formatDateFull(raw: string, kind: ColumnKind, locale: string, timeZone = ''): string {
  const p = parseDate(raw);
  if (!p) return raw;
  try {
    const full = new Intl.DateTimeFormat(locale, kind === 'date' ? { dateStyle: 'full' } : { dateStyle: 'full', timeStyle: 'medium', hourCycle: 'h23' }).format(p.date);
    return `${full}${kind !== 'date' && timeZone ? ` (${timeZone})` : ''}\n${raw}`;
  } catch {
    return raw;
  }
}

/**
 * Text a spreadsheet would run as a formula (starting with = + - @, tab or CR)
 * gets a leading "'", so database content never becomes a live formula.
 * Numbers ("-5", "+3.5", "1e3") are left alone.
 */
export function spreadsheetSafe(s: string): string {
  return /^[=+\-@\t\r]/.test(s) && !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s) ? `'${s}` : s;
}

/** RFC 4180 CSV (comma, CRLF-safe quoting) for spreadsheets. Binary cells are left empty. */
export function toCsv(columns: { name: string }[], rows: Cell[][]): string {
  const esc = (v: Cell) => {
    const s = spreadsheetSafe(v === null || typeof v === 'object' ? '' : String(v));
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => esc(c.name)).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
}

/** Visible slice for a virtualized list of fixed-height rows. */
export function visibleRange(scrollTop: number, viewport: number, rowHeight: number, count: number, overscan = 8) {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  return { start, end };
}
