// Names for foreign key cells: collect the distinct ids of every related
// column on a page, resolve them with ONE lookup_many call, and show
// "Planta Norte · 1". Copying still copies the id (the cell value).
import { request, type Cell } from './api';

export interface Link {
  to: string;
  toColumn: string;
  kind: 'declared' | 'inferred';
}

export interface LabelRef {
  table: string;
  column: string;
  ids: string[];
}

/** Resolved labels of one grid column: id -> label (null label = row exists, label empty). */
export interface ColumnLabels {
  done: boolean;
  map: Record<string, string | null>;
}

const MAX_IDS = 500;
const MAX_REFS = 15;

/**
 * Distinct ids per related column on this page, grouped by target
 * (two columns pointing to the same table.column share one ref).
 */
export function collectRefs(rows: Cell[][], links: (Link | undefined)[]): LabelRef[] {
  const byTarget = new Map<string, Set<string>>();
  links.forEach((l, c) => {
    if (!l) return;
    const key = `${l.to}.${l.toColumn}`;
    const set = byTarget.get(key) ?? new Set<string>();
    for (const r of rows) {
      const v = r[c];
      if (v === null || v === undefined || typeof v === 'object' || v === '') continue;
      if (set.size < MAX_IDS) set.add(String(v));
    }
    byTarget.set(key, set);
  });
  const refs: LabelRef[] = [];
  for (const [key, set] of byTarget) {
    if (!set.size) continue;
    const dot = key.indexOf('.');
    refs.push({ table: key.slice(0, dot), column: key.slice(dot + 1), ids: [...set] });
  }
  return refs.slice(0, MAX_REFS);
}

/** Per grid column, the labels from a lookup_many answer. */
export function applyLabels(links: (Link | undefined)[], answer: Record<string, Record<string, { label: string | null }>>): (ColumnLabels | undefined)[] {
  return links.map((l) => {
    if (!l) return undefined;
    const got = answer[`${l.to}.${l.toColumn}`];
    if (!got) return undefined;
    return { done: true, map: Object.fromEntries(Object.entries(got).map(([id, x]) => [id, x.label])) };
  });
}

export type CellLabel = { kind: 'raw' } | { kind: 'label'; label: string; id: string } | { kind: 'broken'; id: string };

/** What a cell shows: the label with the id, a broken reference, or the raw value. */
export function cellLabel(v: Cell, col: ColumnLabels | undefined): CellLabel {
  if (!col || v === null || v === undefined || typeof v === 'object') return { kind: 'raw' };
  const id = String(v);
  if (!(id in col.map)) return col.done ? { kind: 'broken', id } : { kind: 'raw' };
  const label = col.map[id];
  return label === null || label === '' ? { kind: 'raw' } : { kind: 'label', label, id };
}

export function lookupMany(db: string, refs: LabelRef[]) {
  return request<{ labels: Record<string, Record<string, { label: string | null }>> }>('lookup_many', 'POST', { db, refs });
}
