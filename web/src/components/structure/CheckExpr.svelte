<script lang="ts">
  // One-line CodeMirror for a CHECK expression, with column autocompletion.
  import { onDestroy, onMount, untrack } from 'svelte';
  import { autocompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete';
  import { sql, MySQL, MariaSQL } from '@codemirror/lang-sql';
  import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
  import { EditorState } from '@codemirror/state';
  import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';

  let {
    value,
    columns,
    mariadb,
    label,
    placeholder = '',
    invalid = false,
    describedby,
    onchange,
  }: { value: string; columns: { name: string; type: string }[]; mariadb: boolean; label: string; placeholder?: string; invalid?: boolean; describedby?: string; onchange: (v: string) => void } = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;

  function complete(ctx: CompletionContext) {
    const word = ctx.matchBefore(/[\w$]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    return {
      from: word.from,
      options: columns.map((c) => ({ label: c.name, type: 'property', detail: c.type }) as Completion),
    };
  }

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: untrack(() => value),
        extensions: [
          sql({ dialect: mariadb ? MariaSQL : MySQL, upperCaseKeywords: true }),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          autocompletion({ override: [complete], activateOnTyping: true }),
          cmPlaceholder(placeholder),
          // One line: Enter confirms (blurs) instead of inserting a newline.
          keymap.of([{ key: 'Enter', run: (v) => (v.contentDOM.blur(), true) }]),
          EditorState.transactionFilter.of((tr) => (tr.newDoc.lines > 1 ? [] : tr)),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onchange(u.state.doc.toString());
          }),
          EditorView.contentAttributes.of({ 'aria-label': label, ...(describedby ? { 'aria-describedby': describedby } : {}) }),
          EditorView.theme({
            '&': { fontSize: '12.5px', backgroundColor: 'transparent' },
            '&.cm-focused': { outline: 'none' },
            '.cm-content': { fontFamily: 'var(--sp-font-mono)', padding: '4px 0', caretColor: 'var(--sp-text-primary)' },
            '.cm-line': { padding: '0 6px' },
            '.cm-scroller': { overflow: 'hidden' },
            '.cm-placeholder': { color: 'var(--sp-text-tertiary)' },
            '.cm-tooltip': { border: '1px solid var(--sp-border)', backgroundColor: 'var(--sp-bg)', borderRadius: '6px' },
            '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--sp-inverse)', color: 'var(--sp-on-inverse)' },
          }),
        ],
      }),
    });
  });
  onDestroy(() => view?.destroy());

  // External value changes (undo/redo) flow back in.
  $effect(() => {
    const v = value;
    if (view && v !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
  });
</script>

<div class="expr" class:invalid bind:this={host}></div>

<style>
  .expr {
    min-width: 0;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
    background: var(--sp-bg);
  }
  .expr:focus-within {
    border-color: var(--sp-focus);
  }
  .expr.invalid {
    border-color: var(--sp-danger);
  }
</style>
