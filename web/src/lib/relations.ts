// Queries over the relation list returned by `schema` (declared + inferred).
import type { Relation } from './api';

/** Relations where `table` holds the column (this table points to...). */
export const outgoing = (rels: Relation[], table: string) => rels.filter((r) => r.from === table);

/** Relations pointing at `table` (referenced by...). */
export const incoming = (rels: Relation[], table: string) => rels.filter((r) => r.to === table);

/** Column -> relation for one table, for grid icons and "follow". */
export function linksOf(rels: Relation[], table: string): Map<string, Relation> {
  const map = new Map<string, Relation>();
  for (const r of rels) if (r.from === table && !map.has(r.column)) map.set(r.column, r);
  return map;
}

/** Tables directly related to `table`, either direction. */
export function neighbours(rels: Relation[], table: string): string[] {
  const set = new Set<string>();
  for (const r of rels) {
    if (r.from === table && r.to !== table) set.add(r.to);
    if (r.to === table && r.from !== table) set.add(r.from);
  }
  return [...set];
}

/**
 * JOIN conditions between a newly joined table (alias `alias`) and the
 * tables already in the query: "u.id = t.users_id".
 */
export function joinConditions(rels: Relation[], joined: { table: string; alias: string }, others: { table: string; alias: string }[]): { text: string; kind: Relation['kind'] }[] {
  const out: { text: string; kind: Relation['kind'] }[] = [];
  const lower = (s: string) => s.toLowerCase();
  for (const o of others) {
    for (const r of rels) {
      if (lower(r.from) === lower(o.table) && lower(r.to) === lower(joined.table)) out.push({ text: `${joined.alias}.${r.toColumn} = ${o.alias}.${r.column}`, kind: r.kind });
      else if (lower(r.from) === lower(joined.table) && lower(r.to) === lower(o.table)) out.push({ text: `${joined.alias}.${r.column} = ${o.alias}.${r.toColumn}`, kind: r.kind });
    }
  }
  // Declared first, then inferred; no duplicates.
  const seen = new Set<string>();
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'declared' ? -1 : 1)).filter((c) => !seen.has(c.text) && seen.add(c.text));
}
