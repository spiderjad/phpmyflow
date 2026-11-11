<script lang="ts" module>
  export interface SelectOption {
    value: string;
    label: string;
    /** Why it can't be chosen (tooltip); the option is shown but not selectable. */
    disabled?: string | false | null;
    hint?: string;
  }
</script>

<script lang="ts">
  // Custom select (spider-ui has no listbox select): a button that opens a
  // listbox. Keyboard: Enter/Space/↓ open, ↑/↓/Home/End move, Enter picks,
  // Esc closes, typing filters (with a search box when there are many).
  import { tick, untrack } from 'svelte';
  import { t } from '../../lib/i18n.svelte';

  let {
    value,
    options,
    label,
    onchange,
    mono = false,
    compact = false,
    disabled = false,
    id,
  }: { value: string; options: SelectOption[]; label: string; onchange: (v: string) => void; mono?: boolean; compact?: boolean; disabled?: boolean; id?: string } = $props();

  const uid = untrack(() => id) ?? `sel-${Math.random().toString(36).slice(2, 8)}`;
  let open = $state(false);
  let active = $state(0);
  let query = $state('');
  let btn: HTMLButtonElement;
  let list: HTMLUListElement | undefined = $state();
  let pos = $state({ x: 0, y: 0, w: 0, up: false });

  const searchable = $derived(options.length > 12);
  const shown = $derived(options.filter((o) => !query.trim() || o.label.toLowerCase().includes(query.trim().toLowerCase())));
  const current = $derived(options.find((o) => o.value === value));

  async function show() {
    if (disabled) return;
    const r = btn.getBoundingClientRect();
    const up = r.bottom + 260 > window.innerHeight && r.top > 260;
    pos = { x: r.left, y: up ? r.top : r.bottom, w: Math.max(r.width, 160), up };
    query = '';
    open = true;
    active = Math.max(0, shown.findIndex((o) => o.value === value));
    await tick();
    (searchable ? document.getElementById(`${uid}-q`) : list)?.focus();
    list?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  function close(refocus = true) {
    open = false;
    if (refocus) btn?.focus();
  }
  function pick(o: SelectOption) {
    if (o.disabled) return;
    if (o.value !== value) onchange(o.value);
    close();
  }
  function move(d: number) {
    if (!shown.length) return;
    active = (active + d + shown.length) % shown.length;
    list?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  function listKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') move(1);
    else if (e.key === 'ArrowUp') move(-1);
    else if (e.key === 'Home') active = 0;
    else if (e.key === 'End') active = shown.length - 1;
    else if (e.key === 'Enter' || (e.key === ' ' && !searchable)) {
      if (shown[active]) pick(shown[active]);
    } else if (e.key === 'Escape' || e.key === 'Tab') close(e.key === 'Escape');
    else if (!searchable && e.key.length === 1) {
      const i = shown.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) active = i;
      return;
    } else return;
    e.preventDefault();
  }
  function outside(e: PointerEvent) {
    if (open && !list?.parentElement?.contains(e.target as Node) && !btn.contains(e.target as Node)) close(false);
  }
</script>

<svelte:window onpointerdown={outside} onresize={() => open && close(false)} />

<button
  bind:this={btn}
  id={uid}
  type="button"
  class="v-input sel"
  class:mono
  class:compact
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-label={label}
  {disabled}
  title={current?.hint ?? current?.label}
  onclick={() => (open ? close() : show())}
  onkeydown={(e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      show();
    }
  }}
>
  <span class="val">{current?.label ?? value}</span>
  <span class="chev" aria-hidden="true">▾</span>
</button>

{#if open}
  <div class="pop" class:up={pos.up} style:left="{pos.x}px" style:top="{pos.y}px" style:min-width="{pos.w}px">
    {#if searchable}
      <input id="{uid}-q" class="v-input q" type="search" bind:value={query} placeholder={t('select.search')} aria-label={t('select.search')} aria-controls="{uid}-list" aria-activedescendant={shown[active] ? `${uid}-o-${active}` : undefined} onkeydown={listKey} oninput={() => (active = 0)} />
    {/if}
    <ul id="{uid}-list" class="list" role="listbox" aria-label={label} tabindex="-1" bind:this={list} aria-activedescendant={shown[active] ? `${uid}-o-${active}` : undefined} onkeydown={listKey}>
      {#each shown as o, i}
        <!-- Keyboard is handled by the listbox (aria-activedescendant). -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id="{uid}-o-{i}"
          data-i={i}
          role="option"
          aria-selected={o.value === value}
          aria-disabled={o.disabled ? 'true' : undefined}
          class:active={i === active}
          class:off={!!o.disabled}
          class:mono
          title={o.disabled || o.hint || undefined}
          onpointerenter={() => (active = i)}
          onpointerdown={(e) => e.preventDefault()}
          onclick={() => pick(o)}
        >
          <span>{o.label}</span>
          {#if o.value === value}<span aria-hidden="true">✓</span>{/if}
        </li>
      {:else}
        <li class="none">{t('select.none')}</li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .sel {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    min-width: 0;
    cursor: pointer;
    text-align: left;
  }
  .sel.compact {
    height: 28px;
    padding: 0 8px;
    font-size: 12.5px;
  }
  .val {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chev {
    color: var(--sp-text-tertiary);
    font-size: 11px;
  }
  .pop {
    position: fixed;
    z-index: 80;
    margin-top: 4px;
    padding: 4px;
    background: var(--sp-bg);
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
    box-shadow: var(--sp-shadow-lg, 0 8px 24px rgb(0 0 0 / 0.12));
  }
  .pop.up {
    transform: translateY(calc(-100% - 8px));
  }
  .q {
    width: 100%;
    margin-bottom: 4px;
    padding: 4px 8px;
    font-size: 12.5px;
  }
  .list {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 240px;
    overflow: auto;
    outline: none;
  }
  .list li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 5px 8px;
    border-radius: var(--sp-radius);
    font-size: 12.5px;
    cursor: pointer;
    white-space: nowrap;
  }
  .list li.active {
    background: var(--sp-bg-subtle);
  }
  .list:focus-visible li.active,
  .q:focus-visible ~ .list li.active {
    outline: 2px solid var(--sp-focus);
    outline-offset: -2px;
  }
  .list li.off {
    color: var(--sp-text-tertiary);
    cursor: not-allowed;
  }
  .none {
    color: var(--sp-text-tertiary);
  }
</style>
