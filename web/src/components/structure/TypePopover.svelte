<script lang="ts">
  import { COMMON, familyOf, GROUPS, isBool, realType, typeLabelKey, withType, type ColumnDef } from '../../lib/columnTypes';
  import { t } from '../../lib/i18n.svelte';
  import Popover from './Popover.svelte';
  import Switch from './Switch.svelte';

  let { anchor, def, onchange, onclose }: { anchor: HTMLElement; def: ColumnDef; onchange: (d: ColumnDef) => void; onclose: () => void } = $props();

  let query = $state('');
  let newValue = $state('');
  const fam = $derived(familyOf(def.type));
  const current = $derived(isBool(def) ? 'bool' : def.type);
  const label = (type: string) => (type === 'bool' ? t('types.bool') : t(typeLabelKey({ type, length: null })));
  const matches = (type: string) => !query.trim() || type.includes(query.trim().toLowerCase()) || label(type).toLowerCase().includes(query.trim().toLowerCase());

  function pick(type: string) {
    onchange(withType(def, type));
  }
  function set<K extends keyof ColumnDef>(k: K, v: ColumnDef[K]) {
    onchange({ ...def, [k]: v });
  }
  function addValue() {
    const v = newValue.trim();
    if (!v || def.values.includes(v)) return;
    set('values', [...def.values, v]);
    newValue = '';
  }
  function editValue(i: number, v: string) {
    const next = [...def.values];
    next[i] = v;
    set('values', next);
  }
  function onSearchKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      const first = [...COMMON, ...GROUPS.flatMap((g) => g.types)].find(matches);
      if (first) pick(first);
      e.preventDefault();
    }
  }
</script>

<Popover {anchor} label={t('editor.type.title')} {onclose} width={340}>
  <input class="v-input search" placeholder={t('editor.type.search')} bind:value={query} onkeydown={onSearchKey} aria-label={t('editor.type.search')} data-autofocus />

  <div class="section" role="group" aria-label={t('editor.type.common')}>
    <h4>{t('editor.type.common')}</h4>
    <div class="grid">
      {#each COMMON.filter(matches) as type}
        <button class="opt" class:on={current === type} aria-pressed={current === type} onclick={() => pick(type)}>
          <span class="lbl">{label(type)}</span><span class="raw mono">{type === 'bool' ? 'tinyint(1)' : type}</span>
        </button>
      {/each}
    </div>
  </div>

  {#each GROUPS as g}
    {@const list = g.types.filter((x) => matches(x) && !(COMMON as readonly string[]).includes(x))}
    {#if list.length}
      <details class="section" open={!!query.trim()}>
        <summary>{t(`editor.type.group.${g.key}`)}</summary>
        <div class="grid">
          {#each list as type}
            <button class="opt" class:on={current === type} aria-pressed={current === type} onclick={() => pick(type)}>
              <span class="lbl">{label(type)}</span><span class="raw mono">{type}</span>
            </button>
          {/each}
        </div>
      </details>
    {/if}
  {/each}

  <div class="fields">
    <p class="now">{t(typeLabelKey(def))} · <span class="mono">{realType(def)}</span></p>
    {#if fam === 'char'}
      <label>{t('editor.type.length')} <input class="v-input small" type="number" min="1" max="65535" value={def.length ?? ''} oninput={(e) => set('length', Number((e.currentTarget as HTMLInputElement).value) || null)} /></label>
    {:else if fam === 'decimal'}
      <label>{t('editor.type.digits')} <input class="v-input small" type="number" min="1" max="65" value={def.length ?? 10} oninput={(e) => set('length', Number((e.currentTarget as HTMLInputElement).value) || 10)} /></label>
      <label>{t('editor.type.decimals')} <input class="v-input small" type="number" min="0" max="30" value={def.scale ?? 0} oninput={(e) => set('scale', Number((e.currentTarget as HTMLInputElement).value) || 0)} /></label>
    {/if}
    {#if (fam === 'int' && !isBool(def)) || fam === 'decimal' || fam === 'float'}
      <div class="row"><Switch checked={def.unsigned} label={t('editor.col.unsigned')} onchange={(v) => set('unsigned', v)} /> <span>{t('editor.type.unsignedHelp')}</span></div>
    {/if}
    {#if fam === 'enum'}
      <div class="values" role="group" aria-label={t('editor.type.values')}>
        <span class="vl">{t('editor.type.values')}</span>
        {#each def.values as v, i}
          <span class="chip">
            <input class="chip-in mono" value={v} size={Math.max(2, v.length)} oninput={(e) => editValue(i, (e.currentTarget as HTMLInputElement).value)} aria-label={t('editor.type.value', { n: i + 1 })} />
            <button class="x" onclick={() => set('values', def.values.filter((_, k) => k !== i))} aria-label={t('editor.type.removeValue', { value: v })}>✕</button>
          </span>
        {/each}
        <input
          class="chip-new mono"
          placeholder={t('editor.type.addValue')}
          bind:value={newValue}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addValue();
            }
          }}
          aria-label={t('editor.type.addValue')}
        />
      </div>
    {/if}
  </div>
</Popover>

<style>
  .search {
    padding: 6px 10px;
    font-size: 13px;
    margin-bottom: 8px;
  }
  .section {
    margin-bottom: 8px;
  }
  h4,
  summary {
    margin: 0 0 4px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--sp-text-secondary);
    cursor: default;
  }
  summary {
    cursor: pointer;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
  }
  .opt {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: var(--sp-radius);
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .opt:hover {
    background: var(--sp-bg-muted);
  }
  .opt.on {
    border-color: var(--sp-border-hover);
    background: var(--sp-bg-subtle);
  }
  .lbl {
    font-size: 13px;
    color: var(--sp-text-primary);
  }
  .raw {
    font-size: 11px;
    color: var(--sp-text-tertiary);
  }
  .fields {
    display: grid;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--sp-border);
    font-size: 12.5px;
  }
  .now {
    margin: 0;
    color: var(--sp-text-secondary);
  }
  .fields label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .small {
    width: 90px;
    padding: 4px 8px;
    font-size: 12.5px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .values {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .vl {
    width: 100%;
    color: var(--sp-text-secondary);
  }
  /* Editable chip: spider-ui has none yet. */
  .chip {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--sp-border);
    border-radius: 999px;
    background: var(--sp-bg-subtle);
    padding: 0 2px 0 8px;
  }
  .chip-in {
    border: 0;
    background: none;
    font-size: 12px;
    padding: 2px 0;
    min-width: 2ch;
  }
  .chip-in:focus {
    outline: none;
  }
  .chip:focus-within {
    border-color: var(--sp-focus);
  }
  .x {
    border: 0;
    background: none;
    color: var(--sp-text-tertiary);
    font-size: 10px;
    cursor: pointer;
    padding: 2px 4px;
  }
  .chip-new {
    flex: 1;
    min-width: 90px;
    border: 1px dashed var(--sp-border-hover);
    border-radius: 999px;
    background: none;
    padding: 2px 8px;
    font-size: 12px;
  }
</style>
