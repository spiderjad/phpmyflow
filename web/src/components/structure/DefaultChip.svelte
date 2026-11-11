<script lang="ts">
  // Default value chip: none / NULL / now / value…, edited in place.
  import { familyOf, isBool, type ColumnDef, type DefaultValue } from '../../lib/columnTypes';
  import { t } from '../../lib/i18n.svelte';
  import Popover from './Popover.svelte';

  let { def, editable, onchange }: { def: ColumnDef; editable: boolean; onchange: (d: DefaultValue) => void } = $props();

  let btn: HTMLButtonElement | undefined = $state();
  let open = $state(false);
  let editing = $state(false);
  let value = $state('');

  const canNow = $derived(familyOf(def.type) === 'time' || def.type === 'date');
  const text = $derived(
    def.generated ? t('editor.default.generated') : def.default.kind === 'value' ? valueText(def.default.value ?? '') : def.default.kind === 'now' ? t('editor.default.now') : def.default.kind === 'null' ? 'NULL' : t('editor.default.none'),
  );

  /** Yes/No columns read "Yes (1)"; numbers without quotes; text quoted. */
  function valueText(v: string): string {
    if (isBool(def) && (v === '0' || v === '1')) return `${v === '1' ? t('editor.default.yes') : t('editor.default.no')} (${v})`;
    if (['int', 'decimal', 'float', 'bit'].includes(familyOf(def.type)) && /^-?\d+(\.\d+)?$/.test(v)) return v;
    return `'${v}'`;
  }

  function choose(kind: DefaultValue['kind']) {
    if (kind === 'value') {
      value = def.default.kind === 'value' ? (def.default.value ?? '') : '';
      editing = true;
      open = false;
      return;
    }
    onchange({ kind });
    open = false;
  }
  function commit() {
    onchange({ kind: 'value', value });
    editing = false;
  }
  function focusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
</script>

{#if editing}
  <input
    class="chip-input mono"
    bind:value
    use:focusSelect
    aria-label={t('editor.default.value')}
    onkeydown={(e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        editing = false;
      }
    }}
    onblur={commit}
  />
{:else if editable && !def.generated}
  <button class="chip" class:muted={def.default.kind === 'none'} bind:this={btn} onclick={() => (open = !open)} aria-haspopup="dialog" aria-expanded={open} title={t('editor.default.title')}>
    <span class:mono={def.default.kind === 'value' || def.default.kind === 'null'}>{text}</span>
  </button>
{:else}
  <span class="chip static" class:muted={def.default.kind === 'none'}>{text}</span>
{/if}

{#if open && btn}
  <Popover anchor={btn} label={t('editor.default.title')} onclose={() => (open = false)} width={230}>
    <div class="opts" role="menu">
      <button role="menuitemradio" aria-checked={def.default.kind === 'none'} onclick={() => choose('none')} data-autofocus>{t('editor.default.none')}</button>
      <button role="menuitemradio" aria-checked={def.default.kind === 'null'} disabled={!def.nullable} onclick={() => choose('null')}>NULL {#if !def.nullable}<span class="dim">· {t('editor.default.needsNull')}</span>{/if}</button>
      <button role="menuitemradio" aria-checked={def.default.kind === 'now'} disabled={!canNow} onclick={() => choose('now')}>{t('editor.default.now')} <span class="dim mono">CURRENT_TIMESTAMP</span></button>
      <button role="menuitemradio" aria-checked={def.default.kind === 'value'} onclick={() => choose('value')}>{t('editor.default.value')}</button>
    </div>
  </Popover>
{/if}

<style>
  /* Clickable chip (spider-ui has no editable chip yet). */
  .chip {
    display: inline-flex;
    align-items: center;
    max-width: 160px;
    height: 24px;
    padding: 0 9px;
    border: 1px solid var(--sp-border);
    border-radius: 999px;
    background: var(--sp-bg);
    color: var(--sp-text-primary);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    transition: border-color var(--sp-ease);
  }
  button.chip:hover {
    border-color: var(--sp-border-hover);
  }
  .chip.static {
    cursor: default;
    border-style: dashed;
  }
  .muted {
    color: var(--sp-text-tertiary);
  }
  .chip-input {
    width: 140px;
    height: 24px;
    padding: 0 9px;
    border: 1px solid var(--sp-focus);
    border-radius: 999px;
    background: var(--sp-bg);
    font-size: 12px;
  }
  .chip-input:focus {
    outline: none;
  }
  .opts {
    display: grid;
    gap: 2px;
  }
  .opts button {
    display: flex;
    gap: 6px;
    align-items: baseline;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--sp-radius);
    background: none;
    text-align: left;
    font-size: 13px;
    cursor: pointer;
  }
  .opts button:hover:not(:disabled),
  .opts button[aria-checked='true'] {
    background: var(--sp-bg-muted);
  }
  .opts button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .dim {
    color: var(--sp-text-tertiary);
    font-size: 11.5px;
  }
</style>
