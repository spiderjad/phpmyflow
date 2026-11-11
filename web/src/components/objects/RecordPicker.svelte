<script lang="ts">
  // Pick a related record by its label or id: "3 · Mantenimiento".
  // Combobox (role="combobox" + listbox) with search, "None (NULL)" when the
  // column allows it, recent picks, and a warning when a typed id doesn't
  // exist. Compact mode is the in-grid editor (opens at once, Esc cancels).
  import { onMount, tick, untrack } from 'svelte';
  import { t } from '../../lib/i18n.svelte';
  import { objApi } from '../../lib/objects';

  type Row = { id: string; label: string; extra?: string };
  type Opt = { kind: 'null' } | ({ kind: 'row'; recent?: boolean } & Row);

  let {
    db,
    table,
    column = 'id',
    value,
    nullable = false,
    label,
    id,
    compact = false,
    autoOpen = false,
    onchange,
    oncancel,
  }: {
    db: string;
    table: string;
    column?: string;
    value: string | null;
    nullable?: boolean;
    label: string;
    id: string;
    compact?: boolean;
    autoOpen?: boolean;
    onchange: (v: string | null) => void;
    oncancel?: () => void;
  } = $props();

  let input: HTMLInputElement;
  let query = $state('');
  let typing = $state(false);
  let open = $state(false);
  let rows = $state<Row[]>([]);
  let more = $state(false);
  let slow = $state(false);
  let active = $state(0);
  let current = $state<{ id: string; label: string } | null>(null);
  let missing = $state<string | null>(null);
  let seq = 0;
  let timer: ReturnType<typeof setTimeout>;

  const recentKey = $derived(`pmf_recent_${db}.${table}`);
  function recents(): { id: string; label: string }[] {
    try {
      return JSON.parse(localStorage.getItem(recentKey) ?? '[]');
    } catch {
      return [];
    }
  }
  function remember(r: { id: string; label: string }) {
    try {
      localStorage.setItem(recentKey, JSON.stringify([r, ...recents().filter((x) => x.id !== r.id)].slice(0, 5)));
    } catch {
      /* ignore */
    }
  }

  // Label of the current value (shown as "3 · Mantenimiento").
  $effect(() => {
    const v = value;
    untrack(async () => {
      if (v === null || v === '') {
        current = null;
        return;
      }
      if (current?.id === v) return;
      try {
        const r = await objApi.lookup(db, table, v, column);
        const hit = r.rows.find((x) => String(x.id) === v);
        current = { id: v, label: hit ? String(hit.label ?? '') : '' };
        missing = hit ? null : v;
      } catch {
        current = { id: v, label: '' };
      }
    });
  });

  const shown = $derived(typing ? query : value === null ? '' : current ? (current.label ? `${current.id} · ${current.label}` : current.id) : value);
  const options = $derived<Opt[]>([
    ...(nullable ? [{ kind: 'null' } as Opt] : []),
    ...(!typing || !query.trim() ? recents().map((r) => ({ kind: 'row', ...r, recent: true }) as Opt) : []),
    ...rows.filter((r) => typing && query.trim() ? true : !recents().some((x) => x.id === r.id)).map((r) => ({ kind: 'row', ...r }) as Opt),
  ]);

  async function search(q: string) {
    const mine = ++seq;
    try {
      const r = await objApi.lookup(db, table, q, column);
      if (mine !== seq) return;
      rows = r.rows.map((x) => ({ id: String(x.id), label: String(x.label ?? ''), ...(x.extra != null && x.extra !== '' ? { extra: String(x.extra) } : {}) }));
      more = r.more;
      slow = r.timedOut;
      const trimmed = q.trim();
      missing = trimmed && /^-?\d+$/.test(trimmed) && !rows.some((x) => x.id === trimmed) ? trimmed : null;
      active = Math.min(active, Math.max(0, options.length - 1));
    } catch {
      if (mine === seq) {
        rows = [];
        more = slow = false;
      }
    }
  }
  // Open upward when the list would be cut by the bottom of the drawer / grid / window.
  let up = $state(false);
  function placeList() {
    if (!input) return;
    const r = input.getBoundingClientRect();
    let top = 0;
    let bottom = window.innerHeight;
    for (let el = input.parentElement; el; el = el.parentElement) {
      const o = getComputedStyle(el).overflowY;
      if (o === 'auto' || o === 'scroll' || o === 'hidden') {
        const b = el.getBoundingClientRect();
        top = Math.max(top, b.top);
        bottom = Math.min(bottom, b.bottom);
        break;
      }
    }
    const below = bottom - r.bottom;
    up = below < 270 && r.top - top > below;
  }
  function show() {
    if (!open) placeList();
    open = true;
    if (!rows.length) void search(typing ? query : '');
  }
  function onInput() {
    typing = true;
    if (!open) placeList();
    open = true;
    active = nullable ? 1 : 0;
    clearTimeout(timer);
    timer = setTimeout(() => search(query), 180);
  }
  function pick(o: Opt) {
    if (o.kind === 'null') {
      current = null;
      onchange(null);
    } else {
      current = { id: o.id, label: o.label };
      remember({ id: o.id, label: o.label });
      onchange(o.id);
    }
    missing = null;
    typing = false;
    query = '';
    open = false;
  }
  function cancel() {
    typing = false;
    query = '';
    open = false;
    oncancel?.();
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) show();
      else active = Math.min(options.length - 1, active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(0, active - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && options[active]) pick(options[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === 'Tab' && compact) {
      cancel();
    }
  }
  onMount(async () => {
    if (autoOpen) {
      await tick();
      input?.focus();
      input?.select();
      show();
    }
  });
  const optId = (i: number) => `${id}-o-${i}`;
</script>

<div class="picker" class:compact>
  <input
    bind:this={input}
    {id}
    class="v-input"
    class:mono={!typing && !current?.label}
    role="combobox"
    aria-label={label}
    aria-expanded={open}
    aria-controls="{id}-list"
    aria-autocomplete="list"
    aria-activedescendant={open && options[active] ? optId(active) : undefined}
    aria-invalid={!!missing}
    aria-describedby={missing ? `${id}-missing` : undefined}
    placeholder={value === null ? (nullable ? t('picker.null') : t('picker.search', { table })) : ''}
    value={shown}
    oninput={(e) => ((query = (e.currentTarget as HTMLInputElement).value), onInput())}
    onfocus={() => !compact && show()}
    onclick={() => show()}
    onkeydown={key}
    onblur={() =>
      setTimeout(() => {
        if (!open) return;
        if (compact) cancel();
        else {
          open = false;
          typing = false;
          query = '';
        }
      }, 150)}
  />
  {#if open}
    <div class="pop" class:up>
    <ul class="list" role="listbox" id="{id}-list" aria-label={label}>
      {#each options as o, i}
        <li id={optId(i)} role="option" aria-selected={i === active} class:on={i === active}>
          <button type="button" tabindex="-1" onmousedown={(e) => e.preventDefault()} onclick={() => pick(o)}>
            {#if o.kind === 'null'}
              <span class="dim">{t('picker.null')}</span>
            {:else}
              <span><span class="mono idn">{o.id}</span> · {o.label}{#if o.extra}{' '}<span class="mono dim">{o.extra}</span>{/if}</span>
              {#if o.recent}<span class="tag">{t('picker.recent')}</span>{/if}
            {/if}
          </button>
        </li>
      {/each}
    </ul>
    {#if !options.length || more || slow}
      <p class="none" role="status">
        {#if slow}{t('picker.slow')}{:else if !options.length}{t('picker.noMatch')}{:else}{t('picker.more', { count: 20 })}{/if}
      </p>
    {/if}
    </div>
  {/if}
  {#if missing}<p class="miss" id="{id}-missing" role="status">⚠ {t('picker.missing', { id: missing, table })}</p>{/if}
</div>

<style>
  .picker {
    position: relative;
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .picker input {
    width: 100%;
    min-width: 0;
  }
  .pop {
    position: absolute;
    top: 100%;
    left: 0;
    min-width: 100%;
    width: max-content;
    max-width: 420px;
    z-index: 70;
    margin: 4px 0 0;
    padding: 4px;
    background: var(--sp-bg);
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
    box-shadow: var(--sp-shadow-lg, 0 8px 24px rgb(0 0 0 / 0.12));
  }
  .pop.up {
    top: auto;
    bottom: 100%;
    margin: 0 0 4px;
  }
  .list {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 260px;
    overflow: auto;
  }
  .list button {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 5px 8px;
    border: 0;
    border-radius: var(--sp-radius);
    background: none;
    color: inherit;
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }
  .list li.on button,
  .list button:hover {
    background: var(--sp-bg-subtle);
  }
  .idn {
    color: var(--sp-text-secondary);
  }
  .dim {
    color: var(--sp-text-tertiary);
  }
  .tag {
    font-size: 10.5px;
    color: var(--sp-text-tertiary);
  }
  .none {
    margin: 0;
    padding: 6px 8px;
    font-size: 12px;
    color: var(--sp-text-tertiary);
  }
  .miss {
    margin: 0;
    font-size: 12px;
    color: var(--sp-warning);
  }
  .compact input {
    height: 28px;
    font-size: 12.5px;
    padding: 0 6px;
  }
  .compact .miss {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 71;
    padding: 2px 6px;
    background: var(--sp-bg);
    white-space: nowrap;
  }
</style>
