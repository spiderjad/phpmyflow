// Column types for the structure editor: catalog, parsing of
// information_schema COLUMN_TYPE, SQL formatting and readable labels.
// Pure (labels are i18n keys): unit-tested.

export type TypeFamily = 'int' | 'decimal' | 'float' | 'bit' | 'char' | 'text' | 'blob' | 'date' | 'time' | 'enum' | 'json' | 'plain';

export const FAMILY: Record<string, TypeFamily> = {
  tinyint: 'int', smallint: 'int', mediumint: 'int', int: 'int', bigint: 'int',
  decimal: 'decimal', float: 'float', double: 'float', bit: 'bit',
  char: 'char', varchar: 'char', binary: 'char', varbinary: 'char',
  tinytext: 'text', text: 'text', mediumtext: 'text', longtext: 'text',
  tinyblob: 'blob', blob: 'blob', mediumblob: 'blob', longblob: 'blob',
  date: 'date', year: 'date', datetime: 'time', timestamp: 'time', time: 'time',
  enum: 'enum', set: 'enum', json: 'json', uuid: 'plain', inet4: 'plain', inet6: 'plain', geometry: 'plain', point: 'plain',
};

/** The 8 most used, shown first in the type popover. `bool` = TINYINT(1) "Yes/No". */
export const COMMON = ['int', 'bigint', 'varchar', 'text', 'decimal', 'datetime', 'timestamp', 'bool'] as const;

/** Everything else, grouped. */
export const GROUPS: { key: string; types: string[] }[] = [
  { key: 'numbers', types: ['tinyint', 'smallint', 'mediumint', 'int', 'bigint', 'decimal', 'float', 'double', 'bit'] },
  { key: 'text', types: ['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum', 'set', 'json'] },
  { key: 'dates', types: ['date', 'datetime', 'timestamp', 'time', 'year'] },
  { key: 'binary', types: ['binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob', 'uuid'] },
];

export type DefaultValue = { kind: 'none' | 'null' | 'now' | 'value'; value?: string };

export interface ColumnDef {
  name: string;
  type: string;
  length: number | null;
  scale: number | null;
  unsigned: boolean;
  zerofill: boolean;
  values: string[];
  nullable: boolean;
  default: DefaultValue;
  autoIncrement: boolean;
  onUpdateNow: boolean;
  collation: string | null;
  comment: string;
  generated: { expr: string; stored: boolean } | null;
}

export const familyOf = (type: string): TypeFamily => FAMILY[type.toLowerCase()] ?? 'plain';
export const isBool = (d: Pick<ColumnDef, 'type' | 'length'>) => d.type === 'tinyint' && d.length === 1;

export function blankColumn(name = ''): ColumnDef {
  return {
    name,
    type: 'varchar',
    length: 255,
    scale: null,
    unsigned: false,
    zerofill: false,
    values: [],
    nullable: true,
    default: { kind: 'none' },
    autoIncrement: false,
    onUpdateNow: false,
    collation: null,
    comment: '',
    generated: null,
  };
}

/** Split an ENUM/SET value list: 'a','b''c' -> ['a', "b'c"]. */
export function parseEnumValues(inner: string): string[] {
  const out: string[] = [];
  const re = /'((?:[^'\\]|\\.|'')*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner))) out.push(m[1].replace(/''/g, "'").replace(/\\(.)/g, '$1'));
  return out;
}

/**
 * Parse COLUMN_TYPE ("int(10) unsigned", "varchar(50)", "decimal(10,2)",
 * "enum('a','b')") into the type fields of a ColumnDef.
 */
export function parseColumnType(columnType: string): Pick<ColumnDef, 'type' | 'length' | 'scale' | 'unsigned' | 'zerofill' | 'values'> {
  const lower = columnType.trim().toLowerCase();
  const m = /^([a-z0-9]+)\s*(?:\((.*)\))?\s*(.*)$/s.exec(lower);
  const type = m?.[1] ?? lower;
  const args = m?.[2] ?? '';
  const rest = m?.[3] ?? '';
  let length: number | null = null;
  let scale: number | null = null;
  let values: string[] = [];
  if (familyOf(type) === 'enum') values = parseEnumValues(columnType.slice(columnType.indexOf('(') + 1, columnType.lastIndexOf(')')));
  else if (args) {
    const [a, b] = args.split(',').map((x) => Number(x.trim()));
    length = Number.isFinite(a) ? a : null;
    scale = b !== undefined && Number.isFinite(b) ? b : null;
  }
  return { type, length, scale, unsigned: /\bunsigned\b/.test(rest), zerofill: /\bzerofill\b/.test(rest), values };
}

/** SQL type text: "VARCHAR(255)", "INT UNSIGNED", "ENUM('a','b')", "DECIMAL(10,2)". */
export function typeSql(d: Pick<ColumnDef, 'type' | 'length' | 'scale' | 'unsigned' | 'zerofill' | 'values'>): string {
  const fam = familyOf(d.type);
  let s = d.type.toUpperCase();
  if (fam === 'enum') s += `(${d.values.map((v) => `'${v.replace(/'/g, "''")}'`).join(',')})`;
  else if (fam === 'decimal') s += `(${d.length ?? 10},${d.scale ?? 0})`;
  else if (fam === 'char') s += `(${d.length ?? 255})`;
  else if ((fam === 'int' || fam === 'bit') && d.length) s += `(${d.length})`;
  else if (fam === 'time' && d.length) s += `(${d.length})`;
  else if (fam === 'float' && d.length && d.scale !== null) s += `(${d.length},${d.scale})`;
  if ((fam === 'int' || fam === 'decimal' || fam === 'float') && d.unsigned) s += ' UNSIGNED';
  if ((fam === 'int' || fam === 'decimal' || fam === 'float') && d.zerofill) s += ' ZEROFILL';
  return s;
}

/** Short real type for the grid: "varchar(255)", "int unsigned", "tinyint(1)". */
export function realType(d: Pick<ColumnDef, 'type' | 'length' | 'scale' | 'unsigned' | 'zerofill' | 'values'>): string {
  const fam = familyOf(d.type);
  if (fam === 'enum') return `${d.type}(${d.values.length})`;
  // Integer display widths are noise except tinyint(1) (boolean).
  if (fam === 'int') return (d.type === 'tinyint' && d.length === 1 ? 'tinyint(1)' : d.type) + (d.unsigned ? ' unsigned' : '');
  return typeSql(d).toLowerCase();
}

/** i18n key of the readable label: "types.text" -> "Text", "types.bool" -> "Yes/No". */
export function typeLabelKey(d: Pick<ColumnDef, 'type' | 'length'>): string {
  if (isBool(d)) return 'types.bool';
  const map: Record<string, string> = {
    tinyint: 'types.int', smallint: 'types.int', mediumint: 'types.int', int: 'types.int', bigint: 'types.bigint',
    decimal: 'types.decimal', float: 'types.float', double: 'types.float', bit: 'types.bit',
    char: 'types.text', varchar: 'types.text', tinytext: 'types.longText', text: 'types.longText', mediumtext: 'types.longText', longtext: 'types.longText',
    binary: 'types.binary', varbinary: 'types.binary', tinyblob: 'types.binary', blob: 'types.binary', mediumblob: 'types.binary', longblob: 'types.binary',
    date: 'types.date', datetime: 'types.datetime', timestamp: 'types.datetime', time: 'types.time', year: 'types.year',
    enum: 'types.enum', set: 'types.set', json: 'types.json', uuid: 'types.uuid',
  };
  return map[d.type] ?? 'types.other';
}

/** Apply a type choice from the popover, keeping compatible settings. */
export function withType(d: ColumnDef, choice: string): ColumnDef {
  if (choice === 'bool') return { ...d, type: 'tinyint', length: 1, unsigned: false, values: [], autoIncrement: false, default: d.default.kind === 'value' ? d.default : { kind: 'value', value: '0' }, nullable: false };
  const fam = familyOf(choice);
  const next: ColumnDef = { ...d, type: choice, values: fam === 'enum' ? (d.values.length ? d.values : ['a', 'b']) : [] };
  next.length = fam === 'char' ? (familyOf(d.type) === 'char' ? d.length : 255) : fam === 'decimal' ? 10 : null;
  next.scale = fam === 'decimal' ? 2 : null;
  if (fam !== 'int' && fam !== 'decimal' && fam !== 'float') {
    next.unsigned = false;
    next.zerofill = false;
  }
  if (fam !== 'int') next.autoIncrement = false;
  if (choice !== 'timestamp' && choice !== 'datetime') next.onUpdateNow = false;
  if (d.default.kind === 'now' && fam !== 'time' && choice !== 'date') next.default = { kind: 'none' };
  return next;
}
