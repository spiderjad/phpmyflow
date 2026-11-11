// Index helpers for the Structure tab: column specs ("email(191) DESC"),
// the "Key" badges of a column, which columns fit each index type, names,
// duplicates/redundancy and the InnoDB key size limit. Pure and tested.
import type { IndexModel } from './tableDraft';

export type IdxKind = IndexModel['kind'];

export interface IdxCol {
  name: string;
  len: number | null;
  desc: boolean;
}

export function parseIdxCol(s: string): IdxCol {
  const m = /^`?(.+?)`?(?:\((\d+)\))?(?:\s+(ASC|DESC))?$/i.exec(s.trim());
  if (!m) return { name: s, len: null, desc: false };
  return { name: m[1], len: m[2] ? Number(m[2]) : null, desc: (m[3] ?? '').toUpperCase() === 'DESC' };
}

export function formatIdxCol(c: IdxCol): string {
  return c.name + (c.len ? `(${c.len})` : '') + (c.desc ? ' DESC' : '');
}

/** Column name of an index entry ("email(191) DESC" -> "email"). */
export const idxColName = (s: string) => parseIdxCol(s).name;

export interface KeyBadge {
  kind: 'PRI' | 'UNI' | 'MUL' | 'FT' | 'SP';
  index: IndexModel;
  /** 1-based position of the column in the index, and its size. */
  pos: number;
  of: number;
}

const BADGE: Record<IdxKind, KeyBadge['kind']> = { PRIMARY: 'PRI', UNIQUE: 'UNI', INDEX: 'MUL', FULLTEXT: 'FT', SPATIAL: 'SP' };
const ORDER: KeyBadge['kind'][] = ['PRI', 'UNI', 'MUL', 'FT', 'SP'];

/** Every index a column belongs to, PRI, UNI, INDEX, FULLTEXT, SPATIAL order. */
export function keyBadges(column: string, indexes: IndexModel[]): KeyBadge[] {
  const out: KeyBadge[] = [];
  for (const i of indexes) {
    const cols = i.columns.map(idxColName);
    const at = cols.indexOf(column);
    if (at < 0) continue;
    out.push({ kind: BADGE[i.kind] ?? 'MUL', index: i, pos: at + 1, of: cols.length });
  }
  return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

const TEXTUAL = ['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext'];
const LOBS = ['tinytext', 'text', 'mediumtext', 'longtext', 'tinyblob', 'blob', 'mediumblob', 'longblob'];
export const GEO = ['geometry', 'point', 'linestring', 'polygon', 'multipoint', 'multilinestring', 'multipolygon', 'geometrycollection'];

export interface ColLike {
  type: string;
  length: number | null;
  nullable: boolean;
}

/**
 * Why a column can't go in an index of this type (an i18n key), or null.
 * TEXT/BLOB in INDEX/UNIQUE/PRIMARY are fine once they have a prefix.
 */
export function columnIssue(kind: IdxKind, c: ColLike, prefix: number | null = null): string | null {
  const t = c.type.toLowerCase();
  if (kind === 'FULLTEXT') return TEXTUAL.includes(t) ? null : 'idx.why.ftText';
  if (kind === 'SPATIAL') {
    if (!GEO.includes(t)) return 'idx.why.spGeo';
    return c.nullable ? 'idx.why.spNotNull' : null;
  }
  if (GEO.includes(t)) return 'idx.why.geoKey';
  if (t === 'json') return 'idx.why.json';
  if (LOBS.includes(t) && !prefix) return 'idx.why.needsPrefix';
  return null;
}

/** Index types that make sense for these columns at all (segmented options). */
export function kindAvailable(kind: IdxKind, cols: ColLike[]): boolean {
  if (kind === 'FULLTEXT') return cols.some((c) => TEXTUAL.includes(c.type.toLowerCase()));
  if (kind === 'SPATIAL') return cols.some((c) => GEO.includes(c.type.toLowerCase()));
  return true;
}

export function autoIndexName(kind: IdxKind, cols: string[]): string {
  const prefix = kind === 'UNIQUE' ? 'uq_' : kind === 'FULLTEXT' ? 'ft_' : kind === 'SPATIAL' ? 'sp_' : 'idx_';
  return (prefix + cols.join('_')).slice(0, 64);
}

/** An existing index with these columns, in order ("same"), or one this would be a leading part of ("prefix"). */
export function duplicateOf(cols: string[], kind: IdxKind, indexes: IndexModel[], except?: string): { index: IndexModel; how: 'same' | 'prefix' } | null {
  if (!cols.length || kind === 'FULLTEXT' || kind === 'SPATIAL') return null;
  let prefix: IndexModel | null = null;
  for (const i of indexes) {
    if (i.id === except || i.kind === 'FULLTEXT' || i.kind === 'SPATIAL') continue;
    const other = i.columns.map(idxColName);
    if (other.length === cols.length && other.every((c, k) => c === cols[k])) return { index: i, how: 'same' };
    if (!prefix && kind === 'INDEX' && other.length > cols.length && cols.every((c, k) => other[k] === c)) prefix = i;
  }
  return prefix ? { index: prefix, how: 'prefix' } : null;
}

/** Plain indexes that are the leading part of another index (dropping them is safe). */
export function redundantIndexes(indexes: IndexModel[]): { index: IndexModel; coveredBy: IndexModel }[] {
  const out: { index: IndexModel; coveredBy: IndexModel }[] = [];
  for (const i of indexes) {
    if (i.kind !== 'INDEX' || !i.orig) continue;
    const cols = i.columns.map(idxColName);
    const hasPrefixLen = i.columns.some((x) => parseIdxCol(x).len);
    const by = indexes.find(
      (o) => o !== i && o.kind !== 'FULLTEXT' && o.kind !== 'SPATIAL' && o.columns.length > cols.length && cols.every((c, k) => idxColName(o.columns[k]) === c) && (!hasPrefixLen || o.columns.slice(0, cols.length).join() === i.columns.join()),
    );
    if (by) out.push({ index: i, coveredBy: by });
  }
  return out;
}

const FIXED: Record<string, number> = { tinyint: 1, smallint: 2, mediumint: 3, int: 4, integer: 4, bigint: 8, float: 4, double: 8, date: 3, time: 3, datetime: 5, timestamp: 4, year: 1, decimal: 8 };

/** Bytes an index key takes (InnoDB limit 3072); `charBytes` = 4 for utf8mb4. */
export function keyBytes(cols: string[], defs: Record<string, ColLike>, charBytes: number, prefixes: Record<string, number | null> = {}): number {
  let sum = 0;
  for (const name of cols) {
    const d = defs[name];
    if (!d) continue;
    const t = d.type.toLowerCase();
    const len = prefixes[name] ?? (TEXTUAL.includes(t) || t === 'varbinary' || t === 'binary' ? (d.length ?? 255) : null);
    sum += len !== null && len !== undefined ? len * (t.includes('binary') || t.includes('blob') ? 1 : charBytes) : (FIXED[t] ?? 8);
  }
  return sum;
}

/** Over 3072 bytes: the widest text column gets a 191-char prefix (191 * 4 < 767 bytes). */
export function suggestPrefix(cols: string[], defs: Record<string, ColLike>, charBytes: number, prefixes: Record<string, number | null> = {}): { column: string; len: number } | null {
  if (keyBytes(cols, defs, charBytes, prefixes) <= 3072) return null;
  const textual = cols.filter((c) => defs[c] && TEXTUAL.includes(defs[c].type.toLowerCase()) && !prefixes[c]);
  if (!textual.length) return null;
  const widest = textual.reduce((a, b) => ((defs[b].length ?? 255) > (defs[a].length ?? 255) ? b : a));
  return { column: widest, len: 191 };
}
