// Views, procedures, functions, triggers and events: API client and the
// editor models. The server builds the DDL (server/src/Objects.php); bodies
// are sent as the user wrote them.
import { request } from './api';
import { blankColumn, parseColumnType, type ColumnDef } from './columnTypes';

export type ObjKind = 'VIEW' | 'PROCEDURE' | 'FUNCTION' | 'TRIGGER' | 'EVENT';

export interface DbObjects {
  procedures: { name: string; comment: string }[];
  functions: { name: string; comment: string; returns: string }[];
  triggers: { name: string; table: string; timing: string; event: string }[];
  events: { name: string; status: string; type: string }[];
  scheduler: string;
  supportsOrder: boolean;
  mariadb: boolean;
}

export interface ViewSpec {
  name: string;
  algorithm: 'UNDEFINED' | 'MERGE' | 'TEMPTABLE';
  security: 'DEFINER' | 'INVOKER';
  checkOption: 'NONE' | 'CASCADED' | 'LOCAL';
  body: string;
}
export interface RoutineParam {
  id: string;
  mode: 'IN' | 'OUT' | 'INOUT';
  name: string;
  type: ColumnDef;
}
export interface RoutineSpec {
  name: string;
  params: RoutineParam[];
  returns: ColumnDef | null;
  deterministic: boolean;
  dataAccess: 'CONTAINS SQL' | 'NO SQL' | 'READS SQL DATA' | 'MODIFIES SQL DATA';
  security: 'DEFINER' | 'INVOKER';
  comment: string;
  definer: string;
  body: string;
}
export interface TriggerSpec {
  name: string;
  table: string;
  timing: 'BEFORE' | 'AFTER';
  event: 'INSERT' | 'UPDATE' | 'DELETE';
  order: { kind: 'FOLLOWS' | 'PRECEDES'; other: string } | null;
  body: string;
}
export interface EventSpec {
  name: string;
  schedule: { type: 'once'; at: string } | { type: 'every'; value: number; unit: string; starts: string; ends: string };
  preserve: boolean;
  enabled: boolean;
  comment: string;
  body: string;
}
export type AnySpec = ViewSpec | RoutineSpec | TriggerSpec | EventSpec;

export interface ExecResult {
  resultSets: { columns: string[]; rows: unknown[][]; truncated: boolean }[];
  out: Record<string, unknown>;
  affected: number;
  timeMs: number;
}

export const objApi = {
  list: (db: string) => request<DbObjects>('db_objects', 'GET', { db }),
  info: (db: string, kind: ObjKind, name: string) => request<Record<string, any>>('object_info', 'GET', { db, kind, name }),
  code: (db: string, kind: ObjKind, name: string) => request<{ sql: string }>('object_code', 'GET', { db, kind, name }),
  impact: (db: string, kind: ObjKind, name: string) => request<{ usedBy: { kind: string; name: string }[] }>('object_impact', 'GET', { db, kind, name }),
  preview: (db: string, kind: ObjKind, spec: unknown, original: string | null) => request<{ sql: string; steps: number }>('object_preview', 'POST', { db, kind, spec, original }),
  save: (db: string, kind: ObjKind, spec: unknown, original: string | null) => request<{ ok: true; sql: string }>('object_save', 'POST', { db, kind, spec, original }),
  drop: (db: string, kind: ObjKind, name: string, confirm: string) => request<{ ok: true }>('object_drop', 'POST', { db, kind, name, confirm }),
  execute: (db: string, kind: 'PROCEDURE' | 'FUNCTION', name: string, args: { value: string | null }[]) =>
    request<ExecResult>('routine_execute', 'POST', { db, kind, name, args }),
  lookup: (db: string, table: string, q: string, column?: string, label?: string) =>
    request<{ key: string; label: string; extra: string | null; rows: { id: unknown; label: unknown; extra?: unknown }[]; more: boolean; timedOut: boolean }>('lookup', 'GET', { db, table, q, column, label }),
};

let seq = 0;
const pid = () => `p${++seq}`;

/** A DTD like "int(10) unsigned" or "varchar(50)" as an editable type. */
export function dtdToDef(dtd: string | null | undefined): ColumnDef {
  const d = blankColumn('');
  if (!dtd) return d;
  const clean = dtd.replace(/\s+CHARSET\s+\w+(\s+COLLATE\s+\w+)?/i, '');
  return { ...d, ...parseColumnType(clean), nullable: true };
}

/** The server spec of a routine (types as ColumnDef, no UI ids). */
export function routinePayload(s: RoutineSpec): Record<string, unknown> {
  return { ...s, params: s.params.map(({ mode, name, type }) => ({ mode, name, type })), definer: s.definer.trim() || undefined };
}

export function blankSpec(kind: ObjKind, table = ''): AnySpec {
  switch (kind) {
    case 'VIEW':
      return { name: '', algorithm: 'UNDEFINED', security: 'DEFINER', checkOption: 'NONE', body: 'SELECT\n  \nFROM ' };
    case 'PROCEDURE':
      return { name: '', params: [], returns: null, deterministic: false, dataAccess: 'CONTAINS SQL', security: 'DEFINER', comment: '', definer: '', body: 'BEGIN\n  \nEND' };
    case 'FUNCTION':
      return { name: '', params: [], returns: { ...blankColumn(''), type: 'int', length: null }, deterministic: true, dataAccess: 'NO SQL', security: 'DEFINER', comment: '', definer: '', body: 'BEGIN\n  RETURN 0;\nEND' };
    case 'TRIGGER':
      return { name: table ? `trg_${table}_` : '', table, timing: 'BEFORE', event: 'UPDATE', order: null, body: 'BEGIN\n  \nEND' };
    case 'EVENT':
      return { name: '', schedule: { type: 'every', value: 1, unit: 'DAY', starts: '', ends: '' }, preserve: true, enabled: true, comment: '', body: '' };
  }
}

/** Editor model from object_info. */
export function specFromInfo(kind: ObjKind, i: Record<string, any>): AnySpec {
  const d = (v: unknown) => (typeof v === 'string' ? v.replace('T', ' ').slice(0, 16) : '');
  switch (kind) {
    case 'VIEW':
      return { name: i.name, algorithm: i.algorithm ?? 'UNDEFINED', security: i.security ?? 'DEFINER', checkOption: i.checkOption ?? 'NONE', body: i.body ?? '' };
    case 'PROCEDURE':
    case 'FUNCTION':
      return {
        name: i.name,
        params: (i.params ?? []).map((p: any) => ({ id: pid(), mode: (p.mode ?? 'IN') as RoutineParam['mode'], name: p.name, type: dtdToDef(p.type) })),
        returns: kind === 'FUNCTION' ? dtdToDef(i.returns) : null,
        deterministic: !!i.deterministic,
        dataAccess: i.dataAccess ?? 'CONTAINS SQL',
        security: i.security ?? 'DEFINER',
        comment: i.comment ?? '',
        definer: '',
        body: i.body ?? '',
      };
    case 'TRIGGER':
      return { name: i.name, table: i.table, timing: i.timing, event: i.event, order: null, body: i.body ?? '' };
    case 'EVENT':
      return {
        name: i.name,
        schedule: i.schedule?.type === 'once' ? { type: 'once', at: d(i.schedule.at) } : { type: 'every', value: Number(i.schedule?.value ?? 1), unit: i.schedule?.unit ?? 'DAY', starts: d(i.schedule?.starts), ends: d(i.schedule?.ends) },
        preserve: !!i.preserve,
        enabled: !!i.enabled,
        comment: i.comment ?? '',
        body: i.body ?? '',
      };
  }
}

export function newParam(): RoutineParam {
  return { id: pid(), mode: 'IN', name: '', type: { ...blankColumn(''), type: 'int', length: null, nullable: true } };
}

/** Server spec for any kind (the routine one drops UI ids). */
export function payloadOf(kind: ObjKind, s: AnySpec): Record<string, unknown> {
  if (kind === 'PROCEDURE' || kind === 'FUNCTION') return routinePayload(s as RoutineSpec);
  if (kind === 'EVENT') {
    const e = s as EventSpec;
    const sch = e.schedule.type === 'once' ? { type: 'once', at: e.schedule.at.replace('T', ' ') } : { ...e.schedule, starts: e.schedule.starts.replace('T', ' ') || undefined, ends: e.schedule.ends.replace('T', ' ') || undefined };
    return { ...e, schedule: sch };
  }
  return { ...s };
}

/** Parameter name to a table, for the RecordPicker: p_customer_id / customer_id / customers_id. */
export function paramTable(param: string, tables: { name: string; pk: string | null }[]): string | null {
  const m = /^(?:p_|in_|_)?([a-z][a-z0-9_]*?)_id$/i.exec(param) ?? /^(?:p_|in_)?id_([a-z][a-z0-9_]*)$/i.exec(param);
  if (!m) return null;
  const stem = m[1].toLowerCase();
  const cands = [stem, `${stem}s`, `${stem}es`, stem.replace(/y$/, 'ies')];
  const hit = tables.find((x) => x.pk && cands.includes(x.name.toLowerCase()));
  return hit?.name ?? null;
}
