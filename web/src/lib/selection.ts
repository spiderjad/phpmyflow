// Spreadsheet-style selection over a grid of rows × columns.
// A selection is a list of rectangular ranges (Ctrl+click adds one).
// Pure functions: DataGrid keeps the state, these do the math.
import type { Cell } from './api';

export interface Pos {
  r: number;
  c: number;
}

/** Inclusive rectangle; r1/c1 may be greater than r2/c2 until normalized. */
export interface Range {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export const norm = (g: Range): Range => ({
  r1: Math.min(g.r1, g.r2),
  c1: Math.min(g.c1, g.c2),
  r2: Math.max(g.r1, g.r2),
  c2: Math.max(g.c1, g.c2),
});

export const cellRange = (p: Pos): Range => ({ r1: p.r, c1: p.c, r2: p.r, c2: p.c });
export const spanRange = (a: Pos, b: Pos): Range => norm({ r1: a.r, c1: a.c, r2: b.r, c2: b.c });
export const rowRange = (r: number, cols: number): Range => ({ r1: r, c1: 0, r2: r, c2: cols - 1 });
export const colRange = (c: number, rows: number): Range => ({ r1: 0, c1: c, r2: rows - 1, c2: c });
export const allRange = (rows: number, cols: number): Range => ({ r1: 0, c1: 0, r2: rows - 1, c2: cols - 1 });

export function contains(g: Range, r: number, c: number): boolean {
  const n = norm(g);
  return r >= n.r1 && r <= n.r2 && c >= n.c1 && c <= n.c2;
}

export function isSelected(ranges: Range[], r: number, c: number): boolean {
  for (const g of ranges) if (contains(g, r, c)) return true;
  return false;
}

/** Rows and columns touched by the selection, sorted. */
export function bounds(ranges: Range[]): { rows: number[]; cols: number[] } {
  const rows = new Set<number>();
  const cols = new Set<number>();
  for (const raw of ranges) {
    const g = norm(raw);
    for (let r = g.r1; r <= g.r2; r++) rows.add(r);
    for (let c = g.c1; c <= g.c2; c++) cols.add(c);
  }
  return { rows: [...rows].sort((a, b) => a - b), cols: [...cols].sort((a, b) => a - b) };
}

/** Number of distinct selected cells (overlaps counted once). */
export function cellCount(ranges: Range[]): number {
  if (ranges.length === 1) {
    const g = norm(ranges[0]);
    return (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1);
  }
  const { rows, cols } = bounds(ranges);
  let n = 0;
  for (const r of rows) for (const c of cols) if (isSelected(ranges, r, c)) n++;
  return n;
}

/** Rows where some range covers every column (for "delete rows"). */
export function fullRows(ranges: Range[], cols: number): number[] {
  const out = new Set<number>();
  for (const raw of ranges) {
    const g = norm(raw);
    if (g.c1 === 0 && g.c2 === cols - 1) for (let r = g.r1; r <= g.r2; r++) out.add(r);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * The selection as a dense block: touched rows × touched columns, with
 * `undefined` where a cell in the block is not selected (Ctrl+click holes).
 */
export function selectionMatrix(ranges: Range[], rows: Cell[][]): { cols: number[]; rowIdx: number[]; values: (Cell | undefined)[][] } {
  const b = bounds(ranges);
  const values = b.rows.map((r) => b.cols.map((c) => (isSelected(ranges, r, c) ? rows[r]?.[c] : undefined)));
  return { cols: b.cols, rowIdx: b.rows, values };
}

export interface Stats {
  count: number;
  numeric: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
}

/** Sum / avg / min / max over selected cells of numeric columns. */
export function stats(ranges: Range[], rows: Cell[][], numericCols: boolean[]): Stats {
  const count = cellCount(ranges);
  let numeric = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  const visit = (r: number, c: number) => {
    if (!numericCols[c]) return;
    const v = rows[r]?.[c];
    if (v === null || v === undefined || typeof v === 'object') return;
    const x = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(x)) return;
    numeric++;
    sum += x;
    if (x < min) min = x;
    if (x > max) max = x;
  };
  if (ranges.length === 1) {
    const g = norm(ranges[0]);
    for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) visit(r, c);
  } else {
    const { rows: rs, cols } = bounds(ranges);
    for (const r of rs) for (const c of cols) if (isSelected(ranges, r, c)) visit(r, c);
  }
  return { count, numeric, sum, min, max, avg: numeric ? sum / numeric : 0 };
}

/** Edge flags for drawing range borders on a cell. */
export function edges(ranges: Range[], r: number, c: number): { t: boolean; b: boolean; l: boolean; r: boolean } {
  const e = { t: false, b: false, l: false, r: false };
  for (const raw of ranges) {
    const g = norm(raw);
    if (r < g.r1 || r > g.r2 || c < g.c1 || c > g.c2) continue;
    if (r === g.r1) e.t = true;
    if (r === g.r2) e.b = true;
    if (c === g.c1) e.l = true;
    if (c === g.c2) e.r = true;
  }
  return e;
}
