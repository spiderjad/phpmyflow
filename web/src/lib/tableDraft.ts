// Structure editor model: the table as loaded (original) and the draft the
// user edits. Pending changes are the diff between both, so undo/redo is
// just snapshots of the draft. Pure: unit-tested.
import { blankColumn, parseColumnType, realType, type ColumnDef, type DefaultValue } from './columnTypes';

export interface ColModel extends ColumnDef {
  /** Stable key for the UI. */
  id: string;
  /** Name in the database; null for a new column. */
  orig: string | null;
}

export interface IndexModel {
  id: string;
  orig: string | null;
  name: string;
  kind: 'PRIMARY' | 'UNIQUE' | 'INDEX' | 'FULLTEXT' | 'SPATIAL';
  /** "email", "bio(100)", "created_at DESC" */
  columns: string[];
  /** MySQL INVISIBLE / MariaDB IGNORED: kept up to date but not used by the optimizer. */
  invisible?: boolean;
}

export interface FkModel {
  id: string;
  orig: string | null;
  name: string;
  /** Name still follows the columns ("fk_<table>_<cols>"). */
  autoName?: boolean;
  /** What to do with orphan rows when creating it: set them to NULL, or create without checking. */
  fix?: 'nullify' | 'nocheck' | null;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete: string;
  onUpdate: string;
}

export interface CheckModel {
  id: string;
  orig: string | null;
  name: string;
  expr: string;
}

export interface TableModel {
  name: string;
  comment: string;
  engine: string;
  collation: string;
  autoIncrement: number | null;
  columns: ColModel[];
  indexes: IndexModel[];
  fks: FkModel[];
  checks: CheckModel[];
}

/** Shape returned by the `table_info` action. */
export interface TableInfo {
  table: { name: string; type: string; engine: string; collation: string; autoIncrement: number | null; approxRows: number; bytes: number; comment: string };
  columns: {
    name: string;
    columnType: string;
    dataType: string;
    nullable: boolean;
    default: string | null;
    extra: string;
    key: string;
    collation: string | null;
    comment: string;
    generation: string | null;
  }[];
  indexes: { name: string; kind: IndexModel['kind']; columns: string[]; invisible?: boolean }[];
  /** desc: ASC/DESC per column; invisible: 'invisible' (MySQL 8) / 'ignored' (MariaDB 10.6) / null. */
  indexSupport?: { desc: boolean; invisible: 'invisible' | 'ignored' | null; fulltext: boolean; spatial: boolean };
  foreignKeys: { name: string; columns: string[]; refTable: string; refColumns: string[]; onUpdate: string; onDelete: string }[];
  create: string;
  canAlter: boolean;
  reason: 'view' | 'read_only' | 'no_alter' | null;
  managedBy: 'glpi' | 'wordpress' | null;
  checkSupport: { supported: boolean; flavor: 'mysql' | 'mariadb'; version: string; min: string };
  checks: { name: string; expr: string }[];
  constraintNames: string[];
  engines: string[];
  collations: string[];
}

let seq = 0;
export const uid = (p = 'x') => `${p}${++seq}`;

/** information_schema COLUMN_DEFAULT (MySQL and MariaDB spellings) -> DefaultValue. */
export function parseDefault(raw: string | null, nullable: boolean): DefaultValue {
  if (raw === null) return nullable ? { kind: 'null' } : { kind: 'none' };
  if (raw === 'NULL') return { kind: 'null' };
  if (/^(current_timestamp|now)(\(\d?\))?$/i.test(raw) || /^curdate\(\)$|^current_date(\(\))?$/i.test(raw)) return { kind: 'now' };
  // MariaDB quotes literals: 'abc'
  if (/^'.*'$/s.test(raw)) return { kind: 'value', value: raw.slice(1, -1).replace(/''/g, "'") };
  return { kind: 'value', value: raw };
}

export function fromInfo(info: TableInfo): TableModel {
  const columns: ColModel[] = info.columns.map((c) => {
    const t = parseColumnType(c.columnType);
    const extra = c.extra.toLowerCase();
    const generated = c.generation && /\b(virtual|stored|persistent) generated\b/.test(extra) ? { expr: c.generation, stored: /stored/.test(extra) } : null;
    return {
      ...blankColumn(c.name),
      ...t,
      id: uid('c'),
      orig: c.name,
      nullable: c.nullable,
      default: generated ? { kind: 'none' } : parseDefault(c.default, c.nullable),
      autoIncrement: extra.includes('auto_increment'),
      onUpdateNow: /on update current_timestamp/.test(extra),
      collation: c.collation,
      comment: c.comment,
      generated,
    };
  });
  return {
    name: info.table.name,
    comment: info.table.comment,
    engine: info.table.engine,
    collation: info.table.collation,
    autoIncrement: info.table.autoIncrement,
    columns,
    indexes: info.indexes.map((i) => ({ id: uid('i'), orig: i.name, name: i.name, kind: i.kind, columns: [...i.columns], invisible: !!i.invisible })),
    checks: (info.checks ?? []).map((c) => ({ id: uid('k'), orig: c.name, name: c.name, expr: c.expr })),
    fks: info.foreignKeys.map((f) => ({ id: uid('f'), orig: f.name, name: f.name, fix: null, columns: [...f.columns], refTable: f.refTable, refColumns: [...f.refColumns], onDelete: f.onDelete, onUpdate: f.onUpdate })),
  };
}

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/** Column definition without UI fields, normalized so equivalent forms compare equal. */
function defOf(c: ColModel): ColumnDef {
  const { id: _i, orig: _o, ...d } = c;
  const def: ColumnDef = { ...d, values: [...d.values] };
  if (def.nullable && def.default.kind === 'none') def.default = { kind: 'null' };
  // NOT NULL DEFAULT NULL is invalid: it means "no default".
  if (!def.nullable && def.default.kind === 'null') def.default = { kind: 'none' };
  if (def.default.kind !== 'value') def.default = { kind: def.default.kind };
  return def;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export type ColumnChange =
  | { op: 'add'; def: ColumnDef; after?: string | null; id: string }
  | { op: 'modify'; name: string; def: ColumnDef; after?: string | null; id: string; aspects: string[] }
  | { op: 'drop'; name: string; id: string };
export type IndexChange =
  | { op: 'add'; name: string; kind: IndexModel['kind']; columns: string[]; invisible?: boolean; id: string }
  | { op: 'drop'; name: string; id: string }
  | { op: 'visibility'; name: string; invisible: boolean; id: string };
export type FkChange =
  | { op: 'add'; name: string; columns: string[]; origColumns: (string | null)[]; refTable: string; refColumns: string[]; onDelete: string; onUpdate: string; fix?: 'nullify' | 'nocheck' | null; id: string }
  | { op: 'drop'; name: string; id: string };

export type CheckChange = { op: 'add'; name: string; expr: string; id: string } | { op: 'drop'; name: string; id: string };

export interface Changes {
  table: { rename?: string; comment?: string; engine?: string; collation?: string; autoIncrement?: number | null };
  columns: ColumnChange[];
  indexes: IndexChange[];
  foreignKeys: FkChange[];
  checks: CheckChange[];
}

/** Which aspects of a column changed (for marks and descriptions). */
export function aspects(a: ColumnDef, b: ColumnDef): string[] {
  const out: string[] = [];
  if (a.name !== b.name) out.push('name');
  if (realType(a) !== realType(b) || !same(a.values, b.values) || a.length !== b.length || a.scale !== b.scale || a.zerofill !== b.zerofill) out.push('type');
  if (a.nullable !== b.nullable) out.push('nullable');
  if (!same(a.default, b.default)) out.push('default');
  if (a.autoIncrement !== b.autoIncrement) out.push('autoIncrement');
  if (a.onUpdateNow !== b.onUpdateNow) out.push('onUpdate');
  if ((a.collation ?? null) !== (b.collation ?? null)) out.push('collation');
  if (a.comment !== b.comment) out.push('comment');
  if (!same(a.generated, b.generated)) out.push('generated');
  return out;
}

export function diff(original: TableModel, draft: TableModel): Changes {
  const changes: Changes = { table: {}, columns: [], indexes: [], foreignKeys: [], checks: [] };
  const origCols = new Map(original.columns.map((c) => [c.orig!, c]));
  const kept = new Set<string>();

  // Original order of the columns that remain, to detect moves.
  const origOrder = original.columns.map((c) => c.orig!);
  draft.columns.forEach((c, i) => {
    const prev = i === 0 ? null : draft.columns[i - 1];
    const afterName = prev ? prev.name : null; // name in the new table
    if (!c.orig || !origCols.has(c.orig)) {
      // Appended at the end: no position clause; otherwise AFTER the previous column (FIRST when on top).
      const appended = draft.columns.slice(i + 1).every((x) => !x.orig);
      changes.columns.push({ op: 'add', def: defOf(c), after: appended ? undefined : afterName, id: c.id });
      return;
    }
    kept.add(c.orig);
    const o = origCols.get(c.orig)!;
    const asp = aspects(defOf(o), defOf(c));
    // Moved: predecessor among original columns differs.
    const prevOrig = draft.columns.slice(0, i).reverse().find((x) => x.orig && origCols.has(x.orig))?.orig ?? null;
    const origIdx = origOrder.indexOf(c.orig);
    const expectedPrev = origOrder.slice(0, origIdx).reverse().find((n) => draft.columns.some((x) => x.orig === n)) ?? null;
    const moved = prevOrig !== expectedPrev;
    if (moved) asp.push('position');
    if (asp.length) changes.columns.push({ op: 'modify', name: c.orig, def: defOf(c), after: moved ? afterName : undefined, id: c.id, aspects: asp });
  });
  for (const o of original.columns) if (!kept.has(o.orig!)) changes.columns.unshift({ op: 'drop', name: o.orig!, id: o.id });

  // Index columns are compared by original column names (a rename keeps the index).
  const renamed = new Map(draft.columns.filter((c) => c.orig).map((c) => [c.name, c.orig!]));
  const toOrig = (cols: string[]) => cols.map((s) => {
    const m = /^(.+?)(\(\d+\))?(\s+(?:ASC|DESC))?$/i.exec(s)!;
    return (renamed.get(m[1]) ?? m[1]) + (m[2] ?? '') + (m[3] ?? '');
  });
  const origIdx = new Map(original.indexes.map((i) => [i.orig!, i]));
  const keptIdx = new Set<string>();
  for (const i of draft.indexes) {
    const o = i.orig ? origIdx.get(i.orig) : undefined;
    if (o && o.kind === i.kind && o.name === i.name && same(o.columns, toOrig(i.columns))) {
      keptIdx.add(o.orig!);
      // Only the visibility changed: ALTER INDEX, no rebuild.
      if (!!o.invisible !== !!i.invisible) changes.indexes.push({ op: 'visibility', name: o.orig!, invisible: !!i.invisible, id: i.id + ':vis' });
      continue;
    }
    if (o) {
      keptIdx.add(o.orig!);
      changes.indexes.push({ op: 'drop', name: o.orig!, id: i.id + ':drop' });
    }
    changes.indexes.push({ op: 'add', name: i.name, kind: i.kind, columns: [...i.columns], ...(i.invisible ? { invisible: true } : {}), id: i.id });
  }
  for (const o of original.indexes) if (!keptIdx.has(o.orig!)) changes.indexes.push({ op: 'drop', name: o.orig!, id: o.id });

  const origFk = new Map(original.fks.map((f) => [f.orig!, f]));
  const keptFk = new Set<string>();
  for (const f of draft.fks) {
    const o = f.orig ? origFk.get(f.orig) : undefined;
    const sameFk = o && same([o.name, toOrig(f.columns), o.refTable, o.refColumns, o.onDelete, o.onUpdate], [f.name, o.columns, f.refTable, f.refColumns, f.onDelete, f.onUpdate]);
    if (o && sameFk) {
      keptFk.add(o.orig!);
      continue;
    }
    if (o) {
      keptFk.add(o.orig!);
      changes.foreignKeys.push({ op: 'drop', name: o.orig!, id: f.id + ':drop' });
    }
    const origNames = new Map(draft.columns.map((c) => [c.name, c.orig]));
    changes.foreignKeys.push({
      op: 'add',
      name: f.name,
      columns: [...f.columns],
      origColumns: f.columns.map((c) => origNames.get(c) ?? null),
      refTable: f.refTable,
      refColumns: [...f.refColumns],
      onDelete: f.onDelete,
      onUpdate: f.onUpdate,
      fix: f.fix ?? null,
      id: f.id,
    });
  }
  for (const o of original.fks) if (!keptFk.has(o.orig!)) changes.foreignKeys.push({ op: 'drop', name: o.orig!, id: o.id });

  // CHECK constraints: changed ones are dropped and re-added.
  const origChk = new Map((original.checks ?? []).map((c) => [c.orig!, c]));
  const keptChk = new Set<string>();
  for (const c of draft.checks ?? []) {
    const o = c.orig ? origChk.get(c.orig) : undefined;
    if (o && o.name === c.name && o.expr === c.expr) {
      keptChk.add(o.orig!);
      continue;
    }
    if (o) {
      keptChk.add(o.orig!);
      changes.checks.push({ op: 'drop', name: o.orig!, id: c.id + ':drop' });
    }
    if (c.expr.trim()) changes.checks.push({ op: 'add', name: c.name, expr: c.expr.trim(), id: c.id });
  }
  for (const o of original.checks ?? []) if (!keptChk.has(o.orig!)) changes.checks.push({ op: 'drop', name: o.orig!, id: o.id });

  if (draft.name !== original.name) changes.table.rename = draft.name;
  if (draft.comment !== original.comment) changes.table.comment = draft.comment;
  if (draft.engine !== original.engine) changes.table.engine = draft.engine;
  if (draft.collation !== original.collation) changes.table.collation = draft.collation;
  if (draft.autoIncrement !== original.autoIncrement) changes.table.autoIncrement = draft.autoIncrement;
  return changes;
}

export function changeCount(c: Changes): number {
  return Object.keys(c.table).length + c.columns.length + c.indexes.length + c.foreignKeys.length + c.checks.length;
}

/** Payload for alter_preview / alter_apply (UI ids stripped). */
export function payload(c: Changes): Record<string, unknown> {
  const strip = <T extends { id: string }>(x: T) => {
    const { id: _id, ...rest } = x as T & { aspects?: string[] };
    delete (rest as { aspects?: string[] }).aspects;
    return rest;
  };
  return { table: c.table, columns: c.columns.map(strip), indexes: c.indexes.map(strip), foreignKeys: c.foreignKeys.map(strip), checks: c.checks.map(strip) };
}

/** Row marks: new / modified / dropped, keyed by column id. */
export function columnMarks(c: Changes): Map<string, 'new' | 'modified' | 'dropped'> {
  const m = new Map<string, 'new' | 'modified' | 'dropped'>();
  for (const x of c.columns) m.set(x.id, x.op === 'add' ? 'new' : x.op === 'drop' ? 'dropped' : 'modified');
  return m;
}

// ---------------------------------------------------------------------------
// Human descriptions (i18n keys + params; bold parts are marked with ** **)
// ---------------------------------------------------------------------------

/** Data warning from alter_preview (rows that would be truncated, NULLs…). */
export interface ServerWarning {
  code: 'truncate' | 'nulls' | 'convert' | 'drop_data' | 'duplicates' | 'check_violations' | 'fk_orphans' | 'fk_issue';
  /** Column, index, check or FK name the warning belongs to. */
  column?: string;
  count: number;
  more: boolean;
  params?: Record<string, unknown>;
  /** fk_issue: the ddl_checks issue code (type_type, ref_index...). */
  issue?: string;
  /** Apply stays disabled until it is resolved (FK errors, orphans without a decision). */
  blocking?: boolean;
  fix?: 'nullify' | 'nocheck' | null;
}

/** A change the server singled out as the cause of a failed ALTER. */
export interface FailedChange {
  kind: 'fk' | 'index' | 'check' | 'column';
  name: string;
}

/**
 * Take one change out of the draft, leaving the others pending: a new item is
 * removed, a modified one goes back to its original. Returns false when the
 * draft has nothing by that name.
 */
export function revertChange(draft: TableModel, original: TableModel, change: FailedChange): boolean {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const revert = <T extends { id: string; orig: string | null; name: string }>(list: T[], origList: T[]): T[] | null => {
    const i = list.findIndex((x) => same(x.name, change.name));
    if (i < 0) return null;
    const item = list[i];
    const o = item.orig ? origList.find((x) => x.orig === item.orig) : undefined;
    return o ? list.map((x, j) => (j === i ? { ...clone(o), id: item.id } : x)) : list.filter((_, j) => j !== i);
  };
  if (change.kind === 'fk') {
    const next = revert(draft.fks, original.fks);
    if (next) draft.fks = next;
    return !!next;
  }
  if (change.kind === 'index') {
    const next = revert(draft.indexes, original.indexes);
    if (next) draft.indexes = next;
    return !!next;
  }
  if (change.kind === 'check') {
    const next = revert(draft.checks, original.checks);
    if (next) draft.checks = next;
    return !!next;
  }
  const i = draft.columns.findIndex((c) => same(c.name, change.name) || (c.orig !== null && same(c.orig, change.name)));
  if (i < 0) return false;
  const c = draft.columns[i];
  const o = c.orig ? original.columns.find((x) => x.orig === c.orig) : undefined;
  draft.columns = o ? draft.columns.map((x, j) => (j === i ? clone(o) : x)) : draft.columns.filter((_, j) => j !== i);
  return true;
}

export interface Description {
  key: string;
  params: Record<string, string>;
  /** Server warning code that applies (truncate, nulls, convert, drop_data, duplicates). */
  column?: string;
}

const defText = (d: DefaultValue): string => (d.kind === 'value' ? `'${d.value ?? ''}'` : d.kind === 'now' ? 'CURRENT_TIMESTAMP' : d.kind === 'null' ? 'NULL' : '—');

export function describe(c: Changes, original: TableModel): Description[] {
  const out: Description[] = [];
  const t = c.table;
  if (t.rename) out.push({ key: 'editor.desc.rename', params: { from: original.name, to: t.rename } });
  if (t.comment !== undefined) out.push({ key: 'editor.desc.tableComment', params: { comment: t.comment } });
  if (t.engine) out.push({ key: 'editor.desc.engine', params: { from: original.engine, to: t.engine } });
  if (t.collation) out.push({ key: 'editor.desc.collation', params: { from: original.collation, to: t.collation } });
  if (t.autoIncrement !== undefined) out.push({ key: 'editor.desc.autoIncrement', params: { value: String(t.autoIncrement ?? '') } });
  const orig = new Map(original.columns.map((x) => [x.orig!, x]));
  for (const x of c.columns) {
    if (x.op === 'drop') out.push({ key: 'editor.desc.dropColumn', params: { name: x.name }, column: x.name });
    else if (x.op === 'add') {
      const extras: string[] = [];
      if (!x.def.nullable) extras.push('NOT NULL');
      if (x.def.default.kind !== 'none' && !(x.def.default.kind === 'null' && x.def.nullable)) extras.push(`DEFAULT ${defText(x.def.default)}`);
      if (x.def.autoIncrement) extras.push('AUTO_INCREMENT');
      out.push({ key: 'editor.desc.addColumn', params: { name: x.def.name, type: realType(x.def), extras: extras.length ? ', ' + extras.join(', ') : '' } });
    } else {
      const o = orig.get(x.name)!;
      for (const a of x.aspects) {
        if (a === 'name') out.push({ key: 'editor.desc.renameColumn', params: { from: x.name, to: x.def.name }, column: x.name });
        else if (a === 'type') {
          const shrink = o.type === x.def.type && o.length !== null && x.def.length !== null && x.def.length < o.length;
          out.push({
            key: shrink ? 'editor.desc.shrink' : 'editor.desc.type',
            params: { name: x.def.name, from: realType(o), to: realType(x.def), fromLen: String(o.length ?? ''), toLen: String(x.def.length ?? '') },
            column: x.name,
          });
        } else if (a === 'nullable') out.push({ key: x.def.nullable ? 'editor.desc.allowNull' : 'editor.desc.notNull', params: { name: x.def.name }, column: x.name });
        else if (a === 'default') out.push({ key: 'editor.desc.default', params: { name: x.def.name, from: defText(o.default), to: defText(x.def.default) } });
        else if (a === 'position') out.push({ key: x.after === null ? 'editor.desc.moveFirst' : 'editor.desc.move', params: { name: x.def.name, after: x.after ?? '' } });
        else out.push({ key: a === 'autoIncrement' || a === 'collation' ? `editor.desc.${a}.col` : `editor.desc.${a}`, params: { name: x.def.name } });
      }
    }
  }
  for (const x of c.indexes) {
    if (x.op === 'drop') out.push({ key: x.name === 'PRIMARY' ? 'editor.desc.dropPrimary' : 'editor.desc.dropIndex', params: { name: x.name } });
    else if (x.op === 'visibility') out.push({ key: x.invisible ? 'editor.desc.hideIndex' : 'editor.desc.showIndex', params: { name: x.name } });
    else out.push({ key: x.kind === 'PRIMARY' ? 'editor.desc.addPrimary' : `editor.desc.addIndex`, params: { name: x.name, kind: x.kind, columns: x.columns.join(', ') } });
  }
  for (const x of c.foreignKeys) {
    if (x.op === 'drop') out.push({ key: 'editor.desc.dropFk', params: { name: x.name } });
    else {
      out.push({
        key: 'editor.desc.addFk',
        params: { from: `${original.name}.${x.columns.join(', ')}`, target: `${x.refTable}.${x.refColumns.join(', ')}`, onDelete: x.onDelete, onUpdate: x.onUpdate },
        column: x.name,
      });
      if (x.fix === 'nullify') out.push({ key: 'editor.desc.fkNullify', params: { columns: x.columns.join(', ') } });
      if (x.fix === 'nocheck') out.push({ key: 'editor.desc.fkNoCheck', params: { name: x.name } });
    }
  }
  for (const x of c.checks) {
    if (x.op === 'drop') out.push({ key: 'editor.desc.dropCheck', params: { name: x.name } });
    else out.push({ key: 'editor.desc.addCheck', params: { name: x.name, expr: x.expr }, column: x.name });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Undo / redo over draft snapshots
// ---------------------------------------------------------------------------

export class DraftHistory {
  private past: string[] = [];
  private future: string[] = [];
  constructor(private limit = 100) {}

  /** Call before a change, with the draft as it is now. */
  record(draft: TableModel) {
    this.past.push(JSON.stringify(draft));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: TableModel): TableModel | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(JSON.stringify(current));
    return JSON.parse(prev);
  }

  redo(current: TableModel): TableModel | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(JSON.stringify(current));
    return JSON.parse(next);
  }

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  clear() {
    this.past = [];
    this.future = [];
  }
}
