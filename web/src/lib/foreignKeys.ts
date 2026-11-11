// Foreign key helpers for the structure editor. Pure: unit-tested.
import { parseColumnType, type ColumnDef } from './columnTypes';

export const RULES = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION', 'SET DEFAULT'] as const;
export type Rule = (typeof RULES)[number];

/** "fk_<table>_<cols>" without the database prefix (glpi_, wp_), max 64 chars. */
export function fkName(table: string, columns: string[], prefix = ''): string {
  const base = prefix && table.startsWith(prefix) ? table.slice(prefix.length) : table;
  return `fk_${base}_${columns.join('_') || 'col'}`.slice(0, 64);
}

interface TypeLike {
  type: string;
  length: number | null;
  scale: number | null;
  unsigned: boolean;
  collation?: string | null;
}

const INT = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'bigint']);
const STR = new Set(['char', 'varchar', 'binary', 'varbinary', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum', 'set']);

/**
 * Why a local column can't reference a target column, or null when it can.
 * Mirrors TableEditor::fkTypeIssue on the server (same integer type and
 * sign, same DECIMAL precision, same collation for text).
 */
export function typeIssue(local: TypeLike, target: TypeLike): string | null {
  const a = local.type.toLowerCase();
  const b = target.type.toLowerCase();
  if (INT.has(a) || INT.has(b)) {
    if (a !== b || local.unsigned !== target.unsigned) return `${a}${local.unsigned ? ' unsigned' : ''} ≠ ${b}${target.unsigned ? ' unsigned' : ''}`;
    return null;
  }
  if (a === 'decimal' || b === 'decimal') {
    if (a !== b || local.length !== target.length || local.scale !== target.scale || local.unsigned !== target.unsigned) return `${a} ≠ ${b}(${target.length},${target.scale})`;
    return null;
  }
  if (STR.has(a) && STR.has(b)) {
    if (local.collation && target.collation && local.collation.toLowerCase() !== target.collation.toLowerCase()) return `${local.collation} ≠ ${target.collation}`;
    return null;
  }
  return a === b ? null : `${a} ≠ ${b}`;
}

export interface TargetColumn {
  name: string;
  /** COLUMN_TYPE, e.g. "int(10) unsigned". */
  type: string;
  /** PRI / UNI / MUL / '' (from information_schema COLUMN_KEY). */
  key: string;
  collation?: string | null;
}

export interface Candidate extends TargetColumn {
  compatible: boolean;
  reason: string | null;
}

/**
 * Columns of the target table that a FK can point to: only indexed ones
 * (PK, then UNIQUE, then other indexes), each marked compatible or not
 * with the local column. Incompatible ones come last.
 */
export function targetCandidates(local: TypeLike | null, columns: TargetColumn[]): Candidate[] {
  const rank: Record<string, number> = { PRI: 0, UNI: 1, MUL: 2 };
  return columns
    .filter((c) => c.key in rank)
    .map((c) => {
      const t = parseColumnType(c.type);
      const reason = local ? typeIssue(local, { ...t, collation: c.collation ?? null }) : null;
      return { ...c, compatible: !reason, reason };
    })
    .sort((x, y) => Number(!x.compatible) - Number(!y.compatible) || rank[x.key] - rank[y.key] || x.name.localeCompare(y.name));
}

/** Preselect: the target PK if it is compatible, else the first compatible candidate. */
export function preselect(cands: Candidate[]): string | null {
  return cands.find((c) => c.key === 'PRI' && c.compatible)?.name ?? cands.find((c) => c.compatible)?.name ?? null;
}

/** SET NULL needs every local column to accept NULL. Returns the offending column, or null. */
export function setNullBlocker(localDefs: Pick<ColumnDef, 'name' | 'nullable'>[]): string | null {
  return localDefs.find((d) => !d.nullable)?.name ?? null;
}

/**
 * Apps that manage their own schema. The server confirms with data
 * (glpi_configs context 'core', wp_options siteurl); this is the
 * table-name part so the UI can tell without a round trip.
 */
export function detectManagedApp(tables: string[], serverSays?: string | null): 'glpi' | 'wordpress' | null {
  if (serverSays === 'glpi' || serverSays === 'wordpress') return serverSays;
  if (serverSays === null) return null;
  const set = new Set(tables.map((x) => x.toLowerCase()));
  if (set.has('glpi_configs') && [...set].filter((x) => x.startsWith('glpi_')).length >= 10) return 'glpi';
  for (const name of set) {
    const m = /^(.*)options$/.exec(name);
    if (m && set.has(m[1] + 'posts') && set.has(m[1] + 'postmeta')) return 'wordpress';
  }
  return null;
}

/** SELECT that lists the orphan rows, for "View rows" (opens in a SQL tab). */
export function orphanQuery(table: string, cols: string[], refTable: string, refCols: string[]): string {
  const q = (s: string) => '`' + s.replace(/`/g, '``') + '`';
  const on = cols.map((c, i) => `r.${q(refCols[i])} = l.${q(c)}`).join(' AND ');
  const notNull = cols.map((c) => `l.${q(c)} IS NOT NULL`).join(' AND ');
  return `SELECT l.*\nFROM ${q(table)} l\nLEFT JOIN ${q(refTable)} r ON ${on}\nWHERE ${notNull} AND r.${q(refCols[0])} IS NULL\nLIMIT 100`;
}

/**
 * What ddl_checks validated for one FK. A result is only trusted while the FK
 * (and the local column definitions it uses) still match it, so a late or
 * failed request can never leave an old "ok" on a changed FK.
 */
export function fkSignature(
  f: { columns: string[]; refTable: string; refColumns: string[]; onDelete: string; onUpdate: string },
  defs: Record<string, unknown> = {},
): string {
  return JSON.stringify([f.columns, f.refTable, f.refColumns, f.onDelete, f.onUpdate, f.columns.map((c) => defs[c] ?? null)]);
}

/** Id columns of polymorphic pairs (itemtype + items_id): never a FK to one table. */
export function polymorphicIds(list: { table: string; idColumn: string }[], table: string): Set<string> {
  return new Set(list.filter((p) => p.table === table).map((p) => p.idColumn));
}
