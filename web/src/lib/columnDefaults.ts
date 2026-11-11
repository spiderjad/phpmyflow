// Smart defaults for a new column from its name, and the quick-line
// parser ("color varchar(20) not null default 'rojo'"). Pure: unit-tested.
import { blankColumn, familyOf, FAMILY, parseEnumValues, type ColumnDef } from './columnTypes';
import { commonPrefix } from './fuzzy';

export interface Suggestion {
  def: ColumnDef;
  /** i18n key explaining why ("types.why.id"…). */
  reason: string;
  /** Suggested extras the user can accept. */
  primary?: boolean;
  index?: boolean;
  /** Table this "xxx_id" probably points to. */
  references?: { table: string; column: string } | null;
}

/** Table that a "users_id" / "user_id" column most likely points to. */
export function guessTarget(column: string, tables: { name: string; pk: string | null }[]): { table: string; column: string } | null {
  // xxx_id / xxx_id_suffix, or the prefix style id_xxx (id_planta).
  const m = /^([a-z][a-z0-9_]*?)_id(?:_[a-z0-9]+)?$/i.exec(column) ?? (column.toLowerCase() !== 'id' ? /^id_?([a-z][a-z0-9_]*)$/i.exec(column) : null);
  if (!m) return null;
  const stem = m[1].toLowerCase();
  const prefix = commonPrefix(tables.map((x) => x.name));
  const cands = [stem, stem + 's'];
  if (/(s|x|z|ch|sh|[lrndj])$/.test(stem)) cands.push(stem + 'es'); // material -> materiales
  if (/[^aeiou]y$/.test(stem)) cands.push(stem.slice(0, -1) + 'ies');
  if (stem.endsWith('ies')) cands.push(stem.slice(0, -3) + 'y');
  if (stem.endsWith('s')) cands.push(stem.slice(0, -1));
  const byName = new Map(tables.map((x) => [x.name.toLowerCase(), x]));
  for (const c of cands) {
    for (const n of [prefix + c, c]) {
      const hit = n && byName.get(n);
      if (hit && hit.pk) return { table: hit.name, column: hit.pk };
    }
  }
  return null;
}

/** Defaults by name; always a suggestion the user can change. */
export function suggestColumn(name: string, tables: { name: string; pk: string | null }[] = []): Suggestion {
  const n = name.trim();
  const low = n.toLowerCase();
  const d = blankColumn(n);
  const set = (patch: Partial<ColumnDef>, reason: string, extra: Partial<Suggestion> = {}): Suggestion => ({ def: { ...d, ...patch }, reason, ...extra });

  if (low === 'id') return set({ type: 'int', length: null, unsigned: true, nullable: false, autoIncrement: true }, 'types.why.id', { primary: true });
  if (/_id$/.test(low) || /_id_[a-z0-9]+$/.test(low))
    return set({ type: 'int', length: null, unsigned: true, nullable: true }, 'types.why.fk', { index: true, references: guessTarget(n, tables) });
  if (low === 'created_at') return set({ type: 'timestamp', length: null, nullable: false, default: { kind: 'now' } }, 'types.why.created');
  if (low === 'updated_at') return set({ type: 'timestamp', length: null, nullable: false, default: { kind: 'now' }, onUpdateNow: true }, 'types.why.updated');
  if (/^(is|has)_/.test(low)) return set({ type: 'tinyint', length: 1, nullable: false, default: { kind: 'value', value: '0' } }, 'types.why.bool');
  if (low === 'email' || /_email$/.test(low)) return set({ type: 'varchar', length: 190 }, 'types.why.email');
  if (['price', 'amount', 'total'].includes(low) || /_(price|amount|total)$/.test(low)) return set({ type: 'decimal', length: 10, scale: 2 }, 'types.why.money');
  if (/_date$/.test(low) || low === 'date') return set({ type: 'date', length: null }, 'types.why.date');
  if (/_at$/.test(low)) return set({ type: 'datetime', length: null }, 'types.why.at');
  if (['description', 'notes', 'note', 'body', 'content'].includes(low)) return set({ type: 'text', length: null }, 'types.why.text');
  return set({ type: 'varchar', length: 255, nullable: true }, 'types.why.default');
}

/** Tokens of a quick line, keeping quoted strings and parenthesised args together. */
function tokens(line: string): string[] {
  const out: string[] = [];
  const re = /\s*('(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.)*"|`[^`]*`|[^\s(]+(?:\([^)]*\))?|\([^)]*\))/gy;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) && m[1]) out.push(m[1]);
  return out;
}

const unquote = (s: string) =>
  /^'.*'$/s.test(s) ? s.slice(1, -1).replace(/''/g, "'").replace(/\\(.)/g, '$1') : /^".*"$/s.test(s) ? s.slice(1, -1) : s;

export interface QuickLine {
  def: ColumnDef;
  primary: boolean;
  unique: boolean;
}

/**
 * "color varchar(20) not null default 'rojo'" -> ColumnDef. Returns null
 * when the second word is not a known type (then the text is just a name).
 */
export function parseQuickLine(line: string): QuickLine | null {
  const tk = tokens(line.trim());
  if (tk.length < 2) return null;
  const name = tk[0].replace(/^`|`$/g, '');
  if (!/^[\w$\u0080-￿]+$/.test(name)) return null;
  const tm = /^([a-z0-9]+)(?:\((.*)\))?$/is.exec(tk[1]);
  if (!tm) return null;
  let type = tm[1].toLowerCase();
  const args = tm[2] ?? '';
  const bool = type === 'bool' || type === 'boolean';
  if (bool) type = 'tinyint';
  if (type === 'integer') type = 'int';
  if (!(type in FAMILY)) return null;
  const d = blankColumn(name);
  d.type = type;
  d.length = null;
  const fam = familyOf(type);
  if (bool) d.length = 1;
  else if (fam === 'enum') d.values = parseEnumValues(args);
  else if (args) {
    const [a, b] = args.split(',').map((x) => Number(x.trim()));
    d.length = Number.isFinite(a) ? a : null;
    d.scale = b !== undefined && Number.isFinite(b) ? b : null;
  } else if (fam === 'char') d.length = 255;
  else if (fam === 'decimal') {
    d.length = 10;
    d.scale = 2;
  }
  let primary = false;
  let unique = false;
  for (let i = 2; i < tk.length; i++) {
    const w = tk[i].toLowerCase();
    const next = tk[i + 1]?.toLowerCase();
    if (w === 'unsigned') d.unsigned = true;
    else if (w === 'zerofill') d.zerofill = true;
    else if (w === 'not' && next === 'null') {
      d.nullable = false;
      i++;
    } else if (w === 'null') d.nullable = true;
    else if (w === 'auto_increment' || w === 'autoincrement') {
      d.autoIncrement = true;
      d.nullable = false;
    } else if (w === 'primary' && next === 'key') {
      primary = true;
      d.nullable = false;
      i++;
    } else if (w === 'unique') {
      unique = true;
      if (next === 'key') i++;
    } else if (w === 'default' && tk[i + 1] !== undefined) {
      const raw = tk[++i];
      const v = raw.toLowerCase();
      if (v === 'null') d.default = { kind: 'null' };
      else if (/^(current_timestamp(\(\d?\))?|now\(\))$/.test(v)) d.default = { kind: 'now' };
      else d.default = { kind: 'value', value: unquote(raw) };
    } else if (w === 'on' && next === 'update' && /^(current_timestamp(\(\d?\))?|now\(\))$/i.test(tk[i + 2] ?? '')) {
      d.onUpdateNow = true;
      i += 2;
    } else if (w === 'comment' && tk[i + 1] !== undefined) d.comment = unquote(tk[++i]);
    else if (w === 'collate' && tk[i + 1]) d.collation = tk[++i];
    else return null; // anything unknown: don't guess
  }
  return { def: d, primary, unique };
}
