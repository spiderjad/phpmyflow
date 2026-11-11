<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { basicSetup } from 'codemirror';
  import { syntaxHighlighting } from '@codemirror/language';
  import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
  import { Compartment, EditorState, Prec } from '@codemirror/state';
  import { sql, MySQL, MariaSQL, type SQLNamespace } from '@codemirror/lang-sql';
  import { forEachDiagnostic, lintGutter, type Diagnostic } from '@codemirror/lint';
  import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
  import type { Relation, SchemaMap } from '../lib/api';
  import { joinConditions } from '../lib/relations';
  import { tableRefs } from '../lib/sqlRules';
  import { statementAt } from '../lib/sqlText';
  import { sqlLinter, type Problem } from '../lib/sqlLint';
  import { sqlHighlightStyle } from '../lib/sqlHighlight';
  import { settings } from '../lib/settings.svelte';

  interface Props {
    value: string;
    /** Document identity (the tab id). Each one keeps its own EditorState: undo, selection, scroll. */
    docId?: string;
    /** Initial cursor for a document seen for the first time (restored tabs). */
    cursor?: number;
    oncursor?: (pos: number) => void;
    /** Number of error diagnostics currently shown. */
    onlint?: (errors: number) => void;
    /** Every diagnostic, for the Problems panel. */
    ondiagnostics?: (list: Problem[]) => void;
    db: string;
    schema: SchemaMap;
    /** Declared + inferred relations, for "JOIN x ON " completions. */
    relations?: Relation[];
    mariadb: boolean;
    placeholder?: string;
    onrun: (sql: string, cursor: number, selection: string) => void;
  }

  let { value = $bindable(), docId = 'default', cursor = 0, oncursor, onlint, ondiagnostics, relations = [], db, schema, mariadb, placeholder = '', onrun }: Props = $props();

  // One EditorView; one EditorState per document, swapped on tab change.
  const states = new Map<string, EditorState>();
  const scrolls = new Map<string, number>();
  let currentId = untrack(() => docId);

  let host: HTMLDivElement;
  let view: EditorView | undefined;
  const language = new Compartment();
  const hint = new Compartment();
  // Settings › SQL editor: linter on/off and line wrapping.
  const linting = new Compartment();
  const wrapping = new Compartment();
  const lintExt = () => (settings.editor.lint ? [sqlLinter(() => ({ db, schema, mariadb })), lintGutter()] : []);
  const wrapExt = () => (settings.editor.wrap ? EditorView.lineWrapping : []);

  // Tables complete with their column count; columns with type and key.
  function namespace(s: SchemaMap): SQLNamespace {
    const ns: Record<string, SQLNamespace> = {};
    for (const [name, info] of Object.entries(s)) {
      ns[name] = {
        self: { label: name, type: 'type', detail: info.type === 'VIEW' ? 'view' : `${info.columns.length} col` } as Completion,
        children: info.columns.map(
          (c) =>
            ({
              label: c.name,
              type: 'property',
              detail: c.type + (c.key === 'PRI' ? ' · PK' : ''),
              info: c.comment || undefined,
            }) as Completion,
        ),
      };
    }
    return ns;
  }

  /**
   * After "JOIN glpi_users u ON " suggest the whole condition from the
   * relations (declared first, then inferred): "u.id = t.users_id".
   */
  function joinCompletion(ctx: CompletionContext): CompletionResult | null {
    const before = ctx.state.sliceDoc(Math.max(0, ctx.pos - 400), ctx.pos);
    const m = /\bJOIN\s+`?([\w$]+)`?(?:\s+(?:AS\s+)?`?([\w$]+)`?)?\s+ON\s+$/i.exec(before);
    if (!m || !relations.length) return null;
    const doc = ctx.state.doc.toString();
    const st = statementAt(doc, ctx.pos);
    if (!st) return null;
    const refs = tableRefs(st.text);
    const joinedName = m[1];
    const joined = { table: joinedName, alias: m[2] && !/^ON$/i.test(m[2]) ? m[2] : joinedName };
    const others = refs.filter((r) => (r.alias ?? r.table) !== joined.alias).map((r) => ({ table: r.table, alias: r.alias ?? r.table }));
    const conds = joinConditions(relations, joined, others);
    if (!conds.length) return null;
    return {
      from: ctx.pos,
      options: conds.map((c, i) => ({
        label: c.text,
        type: 'keyword',
        detail: c.kind === 'inferred' ? 'inferred' : 'FK',
        boost: 99 - i,
      })),
      validFor: /^$/,
    };
  }

  function languageExt() {
    return sql({ dialect: mariadb ? MariaSQL : MySQL, schema: namespace(schema), upperCaseKeywords: settings.editor.upperKeywords });
  }

  const theme = EditorView.theme({
    '&': { height: '100%', fontSize: 'var(--editor-font, 13px)', backgroundColor: 'var(--sp-bg)', color: 'var(--sp-text-primary)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--sp-font-mono)', lineHeight: '1.6', fontVariantLigatures: 'none' },
    '.cm-content': { caretColor: 'var(--sp-text-primary)', padding: '10px 0' },
    '.cm-gutters': { backgroundColor: 'var(--sp-bg)', color: 'var(--sp-text-tertiary)', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--sp-bg-muted) 60%, transparent)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'color-mix(in srgb, var(--sp-text-primary) 16%, transparent) !important',
    },
    '.cm-tooltip': { border: '1px solid var(--sp-border)', backgroundColor: 'var(--sp-bg)', borderRadius: '8px', boxShadow: 'var(--sp-shadow-md)', overflow: 'hidden' },
    '.cm-tooltip-autocomplete > ul > li': { padding: '3px 10px', fontFamily: 'var(--sp-font-mono)' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--sp-inverse)', color: 'var(--sp-on-inverse)' },
    '.cm-completionDetail': { opacity: '0.65', fontStyle: 'normal', marginLeft: '12px' },
    '.cm-diagnostic': { padding: '6px 10px', fontFamily: 'var(--sp-font)', fontSize: '13px' },
    '.cm-diagnostic-error': { borderLeft: '3px solid var(--sp-danger)' },
    '.cm-diagnostic-warning': { borderLeft: '3px solid var(--sp-warning)' },
    '.cm-diagnosticAction': {
      backgroundColor: 'var(--sp-inverse)',
      color: 'var(--sp-on-inverse)',
      borderRadius: '4px',
      padding: '2px 8px',
      fontSize: '12px',
      marginLeft: '8px',
    },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--sp-danger)', textUnderlineOffset: '3px' },
    '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--sp-warning)', textUnderlineOffset: '3px' },
    '.cm-placeholder': { color: 'var(--sp-text-tertiary)' },
  });

  // Colors come from CSS variables so light/dark themes just work.
  const highlight = sqlHighlightStyle;

  function run() {
    if (!view) return true;
    const sel = view.state.selection.main;
    onrun(view.state.doc.toString(), sel.head, view.state.sliceDoc(sel.from, sel.to));
    return true;
  }

  function errorCount(state: EditorState): number {
    let count = 0;
    forEachDiagnostic(state, (d) => {
      if (d.severity === 'error') count++;
    });
    return count;
  }

  let current: { d: Diagnostic; from: number; to: number }[] = [];
  function report(state: EditorState) {
    onlint?.(errorCount(state));
    if (!ondiagnostics) return;
    current = [];
    forEachDiagnostic(state, (d, from, to) => current.push({ d, from, to }));
    ondiagnostics(
      current.map(({ d, from, to }, i) => {
        const line = state.doc.lineAt(from);
        return { id: i, from, to, line: line.number, col: from - line.from + 1, severity: d.severity === 'error' ? 'error' : 'warning', message: d.message, fixes: (d.actions ?? []).map((a) => a.name) };
      }),
    );
  }

  /** Select a range and focus the editor (Problems panel click). */
  export function goto(from: number, to = from) {
    if (!view) return;
    view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    view.focus();
  }

  /** Run quick fix `fix` of problem `id` as listed by ondiagnostics. */
  export function applyFix(id: number, fix: number) {
    const entry = current[id];
    const action = entry?.d.actions?.[fix];
    if (view && action) {
      action.apply(view, entry.from, entry.to);
      view.focus();
    }
  }

  function createState(doc: string, pos: number): EditorState {
    return EditorState.create({
      doc,
      selection: { anchor: Math.max(0, Math.min(pos, doc.length)) },
      extensions: [
        basicSetup,
        Prec.highest(keymap.of([{ key: 'Mod-Enter', run }])),
        language.of(languageExt()),
        EditorState.languageData.of(() => [{ autocomplete: joinCompletion }]),
        hint.of(cmPlaceholder(placeholder)),
        linting.of(lintExt()),
        theme,
        syntaxHighlighting(highlight, { fallback: false }),
        wrapping.of(wrapExt()),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) value = u.state.doc.toString();
          if (u.selectionSet || u.docChanged) oncursor?.(u.state.selection.main.head);
          if (u.docChanged || u.transactions.some((tr) => tr.effects.length)) report(u.state);
        }),
        EditorView.contentAttributes.of({ 'aria-label': 'SQL', spellcheck: 'false' }),
      ],
    });
  }

  onMount(() => {
    view = new EditorView({ parent: host, state: createState(value, cursor) });
  });

  /** Drop the saved state of a closed tab. */
  export function forget(id: string) {
    states.delete(id);
    scrolls.delete(id);
  }

  onDestroy(() => view?.destroy());

  // Settings changed: linter, wrapping (keyword case is part of the language below).
  $effect(() => {
    void settings.editor.lint;
    void settings.editor.wrap;
    untrack(() => view?.dispatch({ effects: [linting.reconfigure(lintExt()), wrapping.reconfigure(wrapExt())] }));
  });

  // Schema, server flavor or keyword case changed: refresh completions.
  $effect(() => {
    void schema;
    void mariadb;
    void settings.editor.upperKeywords;
    view?.dispatch({ effects: language.reconfigure(languageExt()) });
  });

  $effect(() => {
    view?.dispatch({ effects: hint.reconfigure(cmPlaceholder(placeholder)) });
  });

  // Tab switch: park the current state and bring the other one back.
  // Same tab: external changes (AI insert, history) flow into the editor.
  $effect(() => {
    const id = docId;
    const text = value;
    if (!view) return;
    untrack(() => {
      const v = view!;
      if (id !== currentId) {
        states.set(currentId, v.state);
        scrolls.set(currentId, v.scrollDOM.scrollTop);
        currentId = id;
        let next = states.get(id);
        if (!next || next.doc.toString() !== text) next = createState(text, cursor);
        v.setState(next);
        // Schema may have changed while this tab was hidden.
        v.dispatch({ effects: [language.reconfigure(languageExt()), hint.reconfigure(cmPlaceholder(placeholder)), linting.reconfigure(lintExt()), wrapping.reconfigure(wrapExt())] });
        const top = scrolls.get(id) ?? 0;
        requestAnimationFrame(() => (v.scrollDOM.scrollTop = top));
        report(v.state);
      } else if (text !== v.state.doc.toString()) {
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
      }
    });
  });

  export function focus() {
    view?.focus();
  }
</script>

<div class="editor" bind:this={host}></div>

<style>
  .editor {
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  .editor :global(.cm-editor) {
    height: 100%;
  }
</style>
