<script lang="ts">
  // Multi-line SQL body editor for views, routines, triggers and events:
  // schema autocomplete (+ extra names: parameters, NEW.* / OLD.*), and the
  // SQL linter for view bodies (a SELECT). Routine bodies (BEGIN ... END) are
  // not linted: the parser does not know compound statements.
  import { onDestroy, onMount, untrack } from 'svelte';
  import { basicSetup } from 'codemirror';
  import { autocompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete';
  import { sql, MySQL, MariaSQL, type SQLNamespace } from '@codemirror/lang-sql';
  import { lintGutter } from '@codemirror/lint';
  import { EditorState } from '@codemirror/state';
  import { EditorView } from '@codemirror/view';
  import type { SchemaMap } from '../../lib/api';
  import { sqlLinter } from '../../lib/sqlLint';
  import { sqlHighlight } from '../../lib/sqlHighlight';

  let {
    value = $bindable(),
    db,
    schema,
    mariadb,
    extra = [],
    lint = false,
    label,
    minHeight = 180,
    describedby,
  }: {
    value: string;
    db: string;
    schema: SchemaMap;
    mariadb: boolean;
    /** Extra completions: parameter names, NEW.col / OLD.col. */
    extra?: { label: string; detail?: string }[];
    lint?: boolean;
    label: string;
    minHeight?: number;
    describedby?: string;
  } = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;

  function namespace(s: SchemaMap): SQLNamespace {
    const ns: Record<string, SQLNamespace> = {};
    for (const [name, info] of Object.entries(s)) {
      ns[name] = { self: { label: name, type: 'type' } as Completion, children: info.columns.map((c) => ({ label: c.name, type: 'property', detail: c.type }) as Completion) };
    }
    return ns;
  }

  function extraSource(ctx: CompletionContext) {
    const word = ctx.matchBefore(/[\w.$]*/);
    if (!word || (word.from === word.to && !ctx.explicit) || !extra.length) return null;
    return { from: word.from, options: extra.map((e) => ({ label: e.label, detail: e.detail, type: 'variable', boost: 5 }) as Completion), validFor: /^[\w.$]*$/ };
  }

  onMount(() => {
    const lang = sql({ dialect: mariadb ? MariaSQL : MySQL, schema: namespace(untrack(() => schema)), upperCaseKeywords: true });
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: untrack(() => value),
        extensions: [
          basicSetup,
          sqlHighlight(),
          lang,
          lang.language.data.of({ autocomplete: extraSource }),
          autocompletion({ activateOnTyping: true }),
          ...(untrack(() => lint) ? [sqlLinter(() => ({ db, schema, mariadb })), lintGutter()] : []),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) value = u.state.doc.toString();
          }),
          EditorView.contentAttributes.of({ 'aria-label': untrack(() => label), spellcheck: 'false', ...(describedby ? { 'aria-describedby': describedby } : {}) }),
          EditorView.theme({
            '&': { fontSize: '12.5px', minHeight: `${untrack(() => minHeight)}px`, backgroundColor: 'var(--sp-bg)', color: 'var(--sp-text-primary)' },
            '&.cm-focused': { outline: 'none' },
            '.cm-content': { fontFamily: 'var(--sp-font-mono)', caretColor: 'var(--sp-text-primary)' },
            '.cm-scroller': { minHeight: `${untrack(() => minHeight)}px` },
            '.cm-gutters': { backgroundColor: 'var(--sp-bg-subtle)', color: 'var(--sp-text-tertiary)', borderRight: '1px solid var(--sp-border)' },
            '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
            '.cm-tooltip': { border: '1px solid var(--sp-border)', backgroundColor: 'var(--sp-bg)' },
            '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--sp-inverse)', color: 'var(--sp-on-inverse)' },
          }),
        ],
      }),
    });
  });
  onDestroy(() => view?.destroy());

  // Value replaced from outside (load, template): update the editor.
  $effect(() => {
    const v = value;
    if (view && v !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
  });
</script>

<div class="codebox" bind:this={host}></div>

<style>
  .codebox {
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
    overflow: hidden;
    min-width: 0;
  }
  .codebox:focus-within {
    border-color: var(--sp-focus);
  }
</style>
