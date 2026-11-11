// Key icons for a column (grid header and Structure): primary key, unique,
// index, fulltext, spatial, declared foreign key, inferred relation. Shape +
// letter + color + tooltip, never color alone. Pure: tested in keyIcons.test.ts.
import { t } from './i18n.svelte';
import { idxColName } from './indexes';

export type KeyKind = 'pk' | 'uni' | 'idx' | 'ft' | 'sp' | 'fk' | 'inferred';

export interface KeyIconData {
  kind: KeyKind;
  /** Short text next to the icon: PK, U, I, FT, SP (+ "2/3" in composite keys), or the referenced table. */
  text: string;
  /** Full description (tooltip and accessible name). */
  tip: string;
  /** Where "click" goes in Structure. */
  target: { type: 'index'; name: string } | { type: 'fk'; name: string } | { type: 'column'; name: string };
}

export interface KeyInfo {
  indexes: { name: string; kind: 'PRIMARY' | 'UNIQUE' | 'INDEX' | 'FULLTEXT' | 'SPATIAL'; columns: string[] }[];
  foreignKeys: { name: string; columns: string[]; refTable: string; refColumns: string[] }[];
}

export interface InferredRef {
  column: string;
  table: string;
  toColumn: string;
}

const KIND: Record<KeyInfo['indexes'][number]['kind'], KeyKind> = { PRIMARY: 'pk', UNIQUE: 'uni', INDEX: 'idx', FULLTEXT: 'ft', SPATIAL: 'sp' };
const LETTER: Record<string, string> = { pk: 'PK', uni: 'U', idx: 'I', ft: 'FT', sp: 'SP' };
const ORDER: KeyKind[] = ['pk', 'uni', 'idx', 'ft', 'sp', 'fk', 'inferred'];

/** Every key a column takes part in, PK first. */
export function columnKeys(column: string, info: KeyInfo | null, inferred: InferredRef[] = []): KeyIconData[] {
  const out: KeyIconData[] = [];
  for (const i of info?.indexes ?? []) {
    const cols = i.columns.map(idxColName);
    const at = cols.indexOf(column);
    if (at < 0) continue;
    const kind = KIND[i.kind] ?? 'idx';
    const composite = cols.length > 1;
    const what = t(`keys.kind.${kind}`);
    const tip =
      i.kind === 'PRIMARY'
        ? composite
          ? t('keys.tipPkComposite', { pos: at + 1, of: cols.length, columns: cols.join(', ') })
          : what
        : composite
          ? t('keys.tipComposite', { what, name: i.name, pos: at + 1, of: cols.length, columns: cols.join(', ') })
          : t('keys.tip', { what, name: i.name });
    out.push({ kind, text: LETTER[kind] + (composite ? ` ${at + 1}/${cols.length}` : ''), tip, target: { type: 'index', name: i.name } });
  }
  for (const f of info?.foreignKeys ?? []) {
    const at = f.columns.indexOf(column);
    if (at < 0) continue;
    const ref = `${f.refTable}.${f.refColumns[at] ?? f.refColumns[0]}`;
    out.push({ kind: 'fk', text: f.refTable, tip: t('keys.tipFk', { ref, name: f.name }), target: { type: 'fk', name: f.name } });
  }
  // Inferred only where no declared FK covers the column.
  if (!out.some((k) => k.kind === 'fk')) {
    for (const r of inferred) {
      if (r.column !== column) continue;
      out.push({ kind: 'inferred', text: r.table, tip: t('keys.tipInferred', { ref: `${r.table}.${r.toColumn}` }), target: { type: 'column', name: column } });
    }
  }
  return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

/**
 * Header badges: at most one per category — PK, U, I (index / fulltext /
 * spatial), →table (declared or inferred). Several in one category: "I ×3";
 * the tooltip lists every one (names, positions in composite keys).
 */
export function groupKeys(icons: KeyIconData[]): KeyIconData[] {
  const cat = (k: KeyKind) => (k === 'pk' ? 'pk' : k === 'uni' ? 'uni' : k === 'fk' || k === 'inferred' ? 'rel' : 'idx');
  const groups = new Map<string, KeyIconData[]>();
  for (const k of icons) {
    const c = cat(k.kind);
    groups.set(c, [...(groups.get(c) ?? []), k]);
  }
  const out: KeyIconData[] = [];
  for (const c of ['pk', 'uni', 'idx', 'rel']) {
    const g = groups.get(c);
    if (!g) continue;
    if (g.length === 1) {
      out.push(g[0]);
      continue;
    }
    const first = g[0];
    const text = c === 'rel' ? `${first.text} ×${g.length}` : `${c === 'pk' ? 'PK' : c === 'uni' ? 'U' : 'I'} ×${g.length}`;
    out.push({ kind: first.kind, text, tip: g.map((x) => x.tip).join('\n'), target: first.target });
  }
  return out;
}
