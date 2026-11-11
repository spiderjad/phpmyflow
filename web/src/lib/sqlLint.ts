/*
 * Live SQL diagnostics in four layers, cheapest first:
 *   0. Rules       — sqlRules.ts: clause order, commas, aliases, = NULL…
 *                    Precise messages and quick fixes. When a rule finds
 *                    an error the slower layers are skipped.
 *   1. Syntax      — node-sql-parser in the browser (instant, offline).
 *   2. Names       — tables/columns checked against the loaded schema,
 *                    with "did you mean" quick fixes.
 *   3. Server      — EXPLAIN on the real server (never executes). Catches
 *                    what a JS parser can't: permissions, views, dialect.
 * Layer 3 only runs when 1 and 2 are clean, to save round trips.
 */
import { linter, type Diagnostic, type Action } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';
import { api, type SchemaMap } from './api';
import { closest, friendlyError } from './errors';
import { t } from './i18n.svelte';
import { checkStatement, tableRefs, type RuleDiagnostic } from './sqlRules';
import { findIdentifier, mask, splitStatements, wordAt } from './sqlText';

/** A diagnostic as listed in the Problems panel. */
export interface Problem {
  id: number;
  from: number;
  to: number;
  line: number;
  col: number;
  severity: 'error' | 'warning';
  message: string;
  /** Quick fix labels, in order. */
  fixes: string[];
}

export interface LintContext {
  db: string;
  schema: SchemaMap;
  mariadb: boolean;
}

type ParserLike = {
  astify(sql: string, opt?: object): unknown;
  tableList(sql: string, opt?: object): string[];
  columnList(sql: string, opt?: object): string[];
};

const parsers: Partial<Record<'mysql' | 'mariadb', Promise<ParserLike>>> = {};

function getParser(flavor: 'mysql' | 'mariadb'): Promise<ParserLike> {
  // Each dialect build is ~270 KB, so load it only when the editor is used.
  parsers[flavor] ??= (flavor === 'mariadb' ? import('node-sql-parser/build/mariadb') : import('node-sql-parser/build/mysql')).then(
    (mod: any) => {
      const P = mod.Parser ?? mod.default?.Parser;
      return new P() as ParserLike;
    },
  );
  return parsers[flavor]!;
}

const replaceAction = (label: string, replacement: string): Action => ({
  name: label,
  apply(view: EditorView, from: number, to: number) {
    const current = view.state.sliceDoc(from, to);
    const quoted = current.startsWith('`') ? '`' + replacement + '`' : replacement;
    view.dispatch({ changes: { from, to, insert: quoted } });
  },
});

/** Translate a rule diagnostic into a CodeMirror one, shifted to the document. */
export function ruleToDiagnostic(d: RuleDiagnostic, offset: number): Diagnostic {
  return {
    from: offset + d.from,
    to: offset + Math.max(d.to, d.from + 1),
    severity: d.severity,
    source: 'rules',
    message: t(d.key, d.params),
    actions: d.fixes.map((fix) => ({
      name: t(fix.key, fix.params ?? {}),
      apply(view: EditorView) {
        view.dispatch({ changes: fix.changes.map((c) => ({ from: offset + c.from, to: offset + c.to, insert: c.insert })) });
      },
    })),
  };
}

/** Layer 0, synchronous. Returns diagnostics and the statements that have rule errors. */
function ruleDiagnostics(doc: string, ctx: LintContext): { diags: Diagnostic[]; broken: Set<number> } {
  const diags: Diagnostic[] = [];
  const broken = new Set<number>();
  for (const st of splitStatements(doc)) {
    for (const d of checkStatement(st.text, { schema: ctx.schema })) {
      diags.push(ruleToDiagnostic(d, st.from));
      if (d.severity === 'error') broken.add(st.from);
    }
  }
  return { diags, broken };
}

/** Collect names defined inside the query itself: aliases and CTEs. */
function localNames(ast: unknown): Set<string> {
  const names = new Set<string>();
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node.as === 'string') names.add(node.as.toLowerCase());
    if (Array.isArray(node.with)) {
      for (const w of node.with) {
        const n = typeof w?.name === 'string' ? w.name : w?.name?.value;
        if (n) names.add(String(n).toLowerCase());
      }
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(ast);
  return names;
}

function syntaxDiagnostic(sql: string, offset: number, err: any): Diagnostic {
  const m = /but (.+) found\.?$/.exec(err?.message ?? '');
  const found = m ? m[1].replace(/^"(.*)"$/, '$1') : '';
  const atEnd = found === 'end of input' || offset >= sql.length;
  const { from, to } = atEnd ? { from: Math.max(0, sql.length - 1), to: sql.length } : wordAt(sql, offset);
  return {
    from,
    to,
    severity: 'error',
    source: 'syntax',
    message: atEnd ? t('lint.unexpectedEnd') : t('lint.syntax', { near: sql.slice(from, to) }),
  };
}

async function clientDiagnostics(doc: string, ctx: LintContext, skip: Set<number>): Promise<Diagnostic[]> {
  const parser = await getParser(ctx.mariadb ? 'mariadb' : 'mysql');
  const opt = { database: ctx.mariadb ? 'MariaDB' : 'MySQL' };
  const out: Diagnostic[] = [];
  const masked = mask(doc);

  for (const st of splitStatements(doc)) {
    if (skip.has(st.from)) continue; // a rule already explains this statement better
    let ast: unknown;
    try {
      ast = parser.astify(st.text, opt);
    } catch (err: any) {
      // The JS grammar doesn't cover every server statement (e.g. some
      // admin commands). Only trust it for the common DML/DDL verbs.
      const verb = st.text.match(/^\s*\(?\s*(\w+)/)?.[1]?.toUpperCase() ?? '';
      if (['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(verb) || !/^[A-Z]+$/.test(verb)) {
        out.push(syntaxDiagnostic(doc, st.from + (err?.location?.start?.offset ?? 0), err));
      }
      continue;
    }

    if (!Object.keys(ctx.schema).length) continue;

    const tablesLower = new Map(Object.keys(ctx.schema).map((n) => [n.toLowerCase(), n]));
    const local = localNames(ast);
    const usedTables: string[] = [];

    let tableRefs: string[] = [];
    let columnRefs: string[] = [];
    try {
      tableRefs = parser.tableList(st.text, opt);
      columnRefs = parser.columnList(st.text, opt);
    } catch {
      continue;
    }

    const stMasked = masked.slice(st.from, st.to);

    for (const ref of tableRefs) {
      const [, dbPart, name] = ref.split('::');
      if (dbPart && dbPart !== 'null' && dbPart !== ctx.db) continue; // other database: can't verify
      const real = tablesLower.get(name.toLowerCase());
      if (real) {
        usedTables.push(real);
        continue;
      }
      if (local.has(name.toLowerCase()) || /^(dual)$/i.test(name)) continue;
      const pos = findIdentifier(stMasked, name);
      if (!pos) continue;
      const suggestion = closest(name, Object.keys(ctx.schema));
      out.push({
        from: st.from + pos.from,
        to: st.from + pos.to,
        severity: 'error',
        source: 'schema',
        message: suggestion ? t('lint.unknownTableSuggest', { name, suggestion }) : t('lint.unknownTable', { name }),
        actions: suggestion ? [replaceAction(t('lint.replaceWith', { suggestion }), suggestion)] : [],
      });
    }

    const seen = new Set<string>();
    for (const ref of columnRefs) {
      const [, tablePart, col] = ref.split('::');
      if (!col || col === '(.*)' || col === '*' || local.has(col.toLowerCase())) continue;
      const key = `${tablePart}.${col}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const realTable = tablePart && tablePart !== 'null' ? tablesLower.get(tablePart.toLowerCase()) : undefined;
      const scope = realTable ? [realTable] : usedTables.length ? usedTables : Object.keys(ctx.schema);
      const candidates = scope.flatMap((tb) => ctx.schema[tb]?.columns.map((c) => c.name) ?? []);
      if (tablePart && tablePart !== 'null' && !realTable) continue; // alias or other db: can't verify safely
      if (candidates.some((c) => c.toLowerCase() === col.toLowerCase())) continue;

      const pos = findIdentifier(stMasked, col);
      if (!pos) continue;
      const suggestion = closest(col, candidates);
      out.push({
        from: st.from + pos.from,
        to: st.from + pos.to,
        // Warning, not error: a JS parser can misread exotic syntax. The
        // server check upgrades it to an error if it's really wrong.
        severity: 'warning',
        source: 'schema',
        message: suggestion ? t('lint.unknownColumnSuggest', { name: col, suggestion }) : t('lint.unknownColumn', { name: col }),
        actions: suggestion ? [replaceAction(t('lint.replaceWith', { suggestion }), suggestion)] : [],
      });
    }
  }
  return out;
}

const serverCache = new Map<string, Diagnostic | null>();

async function serverDiagnostics(doc: string, ctx: LintContext): Promise<Diagnostic[]> {
  if (!ctx.db) return [];
  const out: Diagnostic[] = [];
  const masked = mask(doc);
  for (const st of splitStatements(doc).slice(0, 5)) {
    const cacheKey = `${ctx.db}\u0000${st.text}`;
    let cached = serverCache.get(cacheKey);
    if (cached === undefined) {
      cached = null;
      try {
        const res = await api.check({ db: ctx.db, sql: st.text });
        if (!res.ok && res.error) {
          const fe = friendlyError(res.error, ctx.schema);
          const d = (res.error.details ?? {}) as Record<string, any>;
          const stMasked = masked.slice(st.from, st.to);
          const pos =
            (d.name && findIdentifier(stMasked, String(d.name).split('.').pop()!)) ||
            (d.near && findNear(st.text, String(d.near))) ||
            { from: 0, to: Math.min(st.text.length, st.text.search(/\s|$/) || 1) };
          cached = {
            from: pos.from,
            to: pos.to,
            severity: 'error',
            source: 'server',
            message: fe.title + (fe.suggestion ? ' ' + t('lint.didYouMean', { suggestion: fe.suggestion }) : ''),
            actions: fe.suggestion ? [replaceAction(t('lint.replaceWith', { suggestion: fe.suggestion }), fe.suggestion)] : serverActions(st.text, fe, ctx),
          };
        }
      } catch {
        // Network or session issue: stay quiet in the editor.
      }
      serverCache.set(cacheKey, cached);
      if (serverCache.size > 200) serverCache.delete(serverCache.keys().next().value!);
    }
    if (cached) out.push({ ...cached, from: st.from + cached.from, to: st.from + cached.to });
  }
  return out;
}

/**
 * Quick fixes for server errors the rules can't see:
 *   1052 ambiguous column -> "Use t.id" for every joined table that has it;
 *   1055 ONLY_FULL_GROUP_BY -> wrap the column in ANY_VALUE().
 * Offsets are relative to the statement; the caller shifts them.
 */
function serverActions(sql: string, fe: ReturnType<typeof friendlyError>, ctx: LintContext): Action[] {
  const masked = mask(sql);
  if (fe.mysqlCode === 1052 && fe.name) {
    const col = String(fe.name).split('.').pop()!;
    const pos = findIdentifier(masked, col);
    if (!pos) return [];
    const lower = new Map(Object.keys(ctx.schema).map((n) => [n.toLowerCase(), n]));
    return tableRefs(sql)
      .filter((r) => ctx.schema[lower.get(r.table.toLowerCase()) ?? '']?.columns.some((c) => c.name.toLowerCase() === col.toLowerCase()))
      .map((r) => {
        const q = `${r.alias ?? r.table}.${col}`;
        return {
          name: t('lint.useQualified', { name: q }),
          apply(view: EditorView, from: number) {
            // `from` is the diagnostic start; rebase to the statement start.
            const base = from - pos.from;
            view.dispatch({ changes: { from: base + pos.from, to: base + pos.to, insert: q } });
          },
        };
      });
  }
  if (fe.mysqlCode === 1055 && fe.name) {
    const col = String(fe.name).split('.').pop()!;
    const pos = findIdentifier(masked, col);
    if (!pos) return [];
    // Include a "t." qualifier in the wrapped expression.
    let start = pos.from;
    const before = sql.slice(0, pos.from).match(/([`\w$]+)\.$/);
    if (before) start -= before[0].length;
    return [
      {
        name: t('lint.wrapAnyValue'),
        apply(view: EditorView, from: number) {
          const base = from - pos.from;
          const expr = sql.slice(start, pos.to);
          view.dispatch({ changes: { from: base + start, to: base + pos.to, insert: `ANY_VALUE(${expr})` } });
        },
      },
    ];
  }
  return [];
}

function findNear(text: string, near: string): { from: number; to: number } | null {
  const idx = text.indexOf(near.slice(0, 40));
  if (idx === -1) return null;
  const end = text.slice(idx).search(/\s/);
  return { from: idx, to: idx + (end === -1 ? near.length : Math.max(1, end)) };
}

export function sqlLinter(getContext: () => LintContext) {
  return linter(
    async (view) => {
      const doc = view.state.doc.toString();
      if (!doc.trim()) return [];
      const ctx = getContext();
      // Layer 0 is synchronous: a rule error is shown without waiting for
      // the parser download or the server.
      const rules = ruleDiagnostics(doc, ctx);
      if (rules.broken.size === splitStatements(doc).length) return rules.diags;
      const client = await clientDiagnostics(doc, ctx, rules.broken);
      const local = [...rules.diags, ...client];
      if (local.some((d) => d.severity === 'error')) return local;
      const server = await serverDiagnostics(doc, ctx);
      // Server errors replace local warnings on the same range.
      const covered = (d: Diagnostic) => server.some((s) => s.from < d.to && d.from < s.to);
      return [...local.filter((d) => !covered(d)), ...server];
    },
    { delay: 350 },
  );
}

export function clearServerLintCache() {
  serverCache.clear();
}
