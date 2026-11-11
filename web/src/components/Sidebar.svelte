<script lang="ts">
  import Select from './ui/Select.svelte';
  import type { TableInfo } from '../lib/api';
  import { formatBytes } from '../lib/bytes';
  import { commonPrefix, fuzzyFilter, type FuzzyMatch } from '../lib/fuzzy';
  import { i18n, n, t } from '../lib/i18n.svelte';
  import { pinnedTables, prefs, savePrefs, togglePin, type TableSort } from '../lib/prefs.svelte';
  import { app, selectDb, selectTable } from '../lib/state.svelte';
  import { tabs } from '../lib/tabs.svelte';
  import { toast } from '../lib/ui.svelte';
  import { dbMenuItems, objectMenuItems, openMenu, tableMenuItems } from '../lib/dbActions.svelte';
  import { openObject } from '../lib/state.svelte';
  import type { ObjKind } from '../lib/objects';

  // Groups: tables, views, procedures, functions, triggers, events (collapsible, remembered).
  type Group = 'tables' | 'views' | 'procedures' | 'functions' | 'triggers' | 'events';
  const GROUP_KEY = 'pmf_side_collapsed';
  let collapsed = $state<Set<Group>>(
    (() => {
      try {
        return new Set(JSON.parse(localStorage.getItem(GROUP_KEY) ?? '[]') as Group[]);
      } catch {
        return new Set<Group>();
      }
    })(),
  );
  function toggleGroup(g: Group) {
    const next = new Set(collapsed);
    next.has(g) ? next.delete(g) : next.add(g);
    collapsed = next;
    try {
      localStorage.setItem(GROUP_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }
  // A typed filter opens every group that has matches.
  const isOpen = (g: Group) => !!filter.trim() || !collapsed.has(g);
  const OBJ_KIND: Record<'procedures' | 'functions' | 'triggers' | 'events', ObjKind> = { procedures: 'PROCEDURE', functions: 'FUNCTION', triggers: 'TRIGGER', events: 'EVENT' };
  const OBJ_ICON: Record<ObjKind, string> = { VIEW: '◇', PROCEDURE: '▷', FUNCTION: 'ƒ', TRIGGER: '⚡', EVENT: '⏱' };

  const dbMenu = (e: MouseEvent | { clientX: number; clientY: number }) => openMenu(e, dbMenuItems(app.db), t('dbmenu.label', { db: app.db }));
  function menuAt(el: HTMLElement, items: ReturnType<typeof dbMenuItems>, label: string) {
    const r = el.getBoundingClientRect();
    openMenu({ clientX: r.left + 12, clientY: r.bottom + 2 }, items, label);
  }
  /** Context-menu key or Shift+F10 on a focused element opens its menu. */
  const menuKey = (e: KeyboardEvent) => e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');

  let filter = $state('');
  let showSystem = $state(false);

  const databases = $derived(app.databases.filter((d) => showSystem || !d.system || d.name === app.db));
  const prefix = $derived(commonPrefix(app.tables.map((tb) => tb.name)));
  const hide = $derived(!!prefix && prefs.hidePrefix);
  const currentDb = $derived(app.databases.find((d) => d.name === app.db));
  const dbBytes = $derived(app.tables.reduce((sum, tb) => sum + Number(tb.bytes ?? 0), 0));
  const maxBytes = $derived(Math.max(1, ...app.tables.map((tb) => Number(tb.bytes ?? 0))));
  const sorted = $derived.by(() => {
    const list = [...app.tables];
    if (prefs.tableSort === 'size') list.sort((a, b) => Number(b.bytes ?? 0) - Number(a.bytes ?? 0) || a.name.localeCompare(b.name));
    else if (prefs.tableSort === 'rows') list.sort((a, b) => Number(b.approxRows ?? 0) - Number(a.approxRows ?? 0) || a.name.localeCompare(b.name));
    return list;
  });
  // A typed filter ranks by match quality; otherwise the chosen sort applies.
  const matches = $derived(fuzzyFilter(sorted, filter, (tb) => tb.name));
  const sorts: TableSort[] = ['name', 'rows', 'size'];
  const size = (b: number | null | undefined) => formatBytes(b, i18n.locale);

  function setSort(value: TableSort) {
    prefs.tableSort = value;
    savePrefs();
  }
  const tableMatches = $derived(matches.filter((m) => m.item.type !== 'VIEW'));
  const viewMatches = $derived(matches.filter((m) => m.item.type === 'VIEW'));
  type ObjItem = { name: string; detail: string; table?: string };
  const objMatches = $derived.by(() => {
    const o = app.objects;
    const f = <T,>(list: T[], fn: (x: T) => ObjItem) => fuzzyFilter(list.map(fn), filter, (x) => x.name);
    const out = {
      procedures: f(o?.procedures ?? [], (x) => ({ name: x.name, detail: '' })),
      functions: f(o?.functions ?? [], (x) => ({ name: x.name, detail: x.returns ?? '' })),
      triggers: f(o?.triggers ?? [], (x) => ({ name: x.name, detail: `${x.table} · ${x.timing[0]}${x.event[0]}`, table: x.table })),
      events: f(o?.events ?? [], (x) => ({ name: x.name, detail: x.status === 'ENABLED' ? '' : t('sidebar.disabled') })),
    };
    return { ...out, total: out.procedures.length + out.functions.length + out.triggers.length + out.events.length };
  });
  const pins = $derived(new Set(pinnedTables()));
  const pinned = $derived(matches.filter((m) => pins.has(m.item.name)));

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && matches.length) selectTable(matches[0].item.name);
    if (e.key === 'Escape') filter = '';
  }

  /** Ctrl+click or middle click: SELECT in a new SQL tab, run right away. */
  function openInTab(name: string) {
    const quoted = '`' + name.replace(/`/g, '``') + '`';
    if (!tabs.create({ sql: `SELECT * FROM ${quoted} LIMIT 100`, db: app.db, autorun: true })) {
      toast(t('tabs.limit', { max: 30 }), 'error');
      return;
    }
    app.view = 'sql';
  }

  function onTableClick(e: MouseEvent, name: string) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      openInTab(name);
    } else selectTable(name);
  }

  function setHide(value: boolean) {
    prefs.hidePrefix = value;
    savePrefs();
  }

  /** Split a name into highlighted / plain runs, skipping a hidden prefix. */
  function segments(name: string, match: FuzzyMatch) {
    const start = hide && name.startsWith(prefix) ? prefix.length : 0;
    const hits = new Set(match.positions);
    const out: { text: string; hit: boolean; prefix: boolean }[] = [];
    for (let i = start; i < name.length; i++) {
      const hit = hits.has(i);
      const isPrefix = !hide && i < prefix.length && name.startsWith(prefix);
      const last = out[out.length - 1];
      if (last && last.hit === hit && last.prefix === isPrefix) last.text += name[i];
      else out.push({ text: name[i], hit, prefix: isPrefix });
    }
    return out;
  }

  function tip(tb: TableInfo) {
    const lines = [tb.name];
    if (tb.comment) lines.push(tb.comment);
    if (tb.type !== 'VIEW') {
      lines.push(
        t('sidebar.tipRows', { rows: n(Number(tb.approxRows ?? 0)) }),
        t('sidebar.tipSize', { total: size(tb.bytes), data: size(tb.dataBytes), index: size(tb.indexBytes) }),
      );
      if (Number(tb.freeBytes) > 0) lines.push(t('sidebar.tipFree', { free: size(tb.freeBytes) }));
      if (tb.engine) lines.push(tb.engine);
    }
    return lines.join('\n');
  }
</script>

{#snippet item(tb: TableInfo, match: FuzzyMatch)}
  {@const isPinned = pins.has(tb.name)}
  <div class="row" class:active={tb.name === app.table && app.view !== 'sql'}>
    {#if prefs.tableSort === 'size' && tb.type !== 'VIEW'}
      <span class="bar" style:width="{(Number(tb.bytes ?? 0) / maxBytes) * 100}%" aria-hidden="true"></span>
    {/if}
    <button
      class="tbl"
      onclick={(e) => onTableClick(e, tb.name)}
      onauxclick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          openInTab(tb.name);
        }
      }}
      onmousedown={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
      oncontextmenu={(e) => openMenu(e, tableMenuItems(app.db, tb.name, tb.type === 'VIEW'), tb.name)}
      onkeydown={(e) => {
        if (menuKey(e)) {
          e.preventDefault();
          menuAt(e.currentTarget as HTMLElement, tableMenuItems(app.db, tb.name, tb.type === 'VIEW'), tb.name);
        }
      }}
      title={tip(tb) + '\n\n' + t('sidebar.ctrlClick')} data-table={tb.name} aria-current={tb.name === app.table && app.view !== 'sql' ? 'page' : undefined}>
      <span class="icon" aria-hidden="true">{tb.type === 'VIEW' ? '◇' : '▦'}</span>
      <span class="name">
        {#each segments(tb.name, match) as seg}<span class:hit={seg.hit} class:pfx={seg.prefix}>{seg.text}</span>{/each}
      </span>
      {#if tb.type !== 'VIEW'}
        {#if prefs.tableSort === 'rows'}
          <span class="count">~{n(Number(tb.approxRows ?? 0))}</span>
        {:else}
          <span class="count">{size(tb.bytes)}</span>
        {/if}
      {/if}
    </button>
    <button
      class="pin"
      class:on={isPinned}
      onclick={() => togglePin(tb.name)}
      aria-pressed={isPinned}
      aria-label={isPinned ? t('sidebar.unpin', { table: tb.name }) : t('sidebar.pin', { table: tb.name })}
      title={isPinned ? t('sidebar.unpin', { table: tb.name }) : t('sidebar.pin', { table: tb.name })}
    >
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M9.5 1.5l5 5-2 .5-2.5 2.5.5 3-1.5 1.5-3-3-3.5 3.5-.5-.5L5.5 10l-3-3L4 5.5l3 .5L9.5 3.5z" fill={isPinned ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" /></svg>
    </button>
  </div>
{/snippet}

{#snippet groupHead(g: Group, count: number)}
  <h3 class="group">
    <button class="ghead" aria-expanded={isOpen(g)} onclick={() => toggleGroup(g)} data-group={g}>
      <span class="chev" aria-hidden="true">{isOpen(g) ? '▾' : '▸'}</span>
      {t(`sidebar.group.${g}`)} <span class="gcount">{n(count)}</span>
    </button>
  </h3>
{/snippet}

<aside class="side">
  <div class="block">
    <div class="db-head">
      <label class="lbl" for="db-select">{t('sidebar.database')}</label>
      <button class="v-btn-icon v-btn--sm more" aria-haspopup="menu" aria-label={t('dbmenu.label', { db: app.db })} title={t('dbmenu.label', { db: app.db })} onclick={(e) => menuAt(e.currentTarget as HTMLElement, dbMenuItems(app.db), t('dbmenu.label', { db: app.db }))}>⋯</button>
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="db-pick"
      oncontextmenu={dbMenu}
      onkeydown={(e) => {
        if (menuKey(e)) {
          e.preventDefault();
          menuAt(e.target as HTMLElement, dbMenuItems(app.db), t('dbmenu.label', { db: app.db }));
        }
      }}
    >
      <Select
        id="db-select"
        value={app.db}
        label={t('sidebar.database')}
        options={databases.map((d) => ({ value: d.name, label: `${d.name} · ${size(d.bytes)}` }))}
        onchange={(v) => void selectDb(v)}
      />
    </div>
    {#if app.db && !app.loadingTables}
      <p class="db-size" title={t('sidebar.sizeHelp')}>
        {t('sidebar.dbSummary', { tables: n(app.tables.length), size: size(currentDb?.bytes || dbBytes) })}
      </p>
    {/if}
    <label class="check">
      <input type="checkbox" bind:checked={showSystem} />
      {t('sidebar.showSystem')}
    </label>
  </div>

  <div class="block">
    <input
      class="v-input filter"
      type="search"
      placeholder={t('sidebar.filter', { count: n(app.tables.length) })}
      bind:value={filter}
      onkeydown={onKey}
      aria-label={t('sidebar.filterLabel')}
    />
    {#if prefix}
      <label class="check">
        <input type="checkbox" checked={prefs.hidePrefix} onchange={(e) => setHide((e.currentTarget as HTMLInputElement).checked)} />
        {t('sidebar.hidePrefix')} <code>{prefix}</code>
      </label>
    {/if}
  </div>

  <div class="sortbar">
    <span class="lbl">{t('sidebar.sortBy')}</span>
    <div class="v-segmented" role="group" aria-label={t('sidebar.sortBy')}>
      {#each sorts as so}
        <button class="v-segmented__item" aria-pressed={prefs.tableSort === so} onclick={() => setSort(so)}>{t(`sidebar.sort.${so}`)}</button>
      {/each}
    </div>
  </div>

  <nav class="tables" aria-label={t('sidebar.tables')}>
    {#if app.loadingTables}
      <p class="muted">{t('common.loading')}</p>
    {:else if !matches.length && !objMatches.total}
      <p class="muted">{filter ? t('sidebar.noMatch') : t('sidebar.empty')}</p>
    {/if}
    {#if pinned.length}
      <h3 class="group">{t('sidebar.pinned')}</h3>
      {#each pinned as m (m.item.name)}{@render item(m.item, m.match)}{/each}
    {/if}
    {@render groupHead('tables', tableMatches.length)}
    {#if isOpen('tables')}{#each tableMatches as m (m.item.name)}{@render item(m.item, m.match)}{/each}{/if}
    {#if viewMatches.length || !filter}
      {@render groupHead('views', viewMatches.length)}
      {#if isOpen('views')}{#each viewMatches as m (m.item.name)}{@render item(m.item, m.match)}{/each}{/if}
    {/if}
    {#each ['procedures', 'functions', 'triggers', 'events'] as const as g}
      {#if objMatches[g].length || !filter}
        {@render groupHead(g, objMatches[g].length)}
        {#if isOpen(g)}
          {#each objMatches[g] as m (m.item.name)}
            {@const kind = OBJ_KIND[g]}
            {@const on = app.view === 'object' && app.object?.kind === kind && app.object?.name === m.item.name}
            <div class="row" class:active={on}>
              <button
                class="tbl obj"
                data-object={m.item.name}
                data-kind={kind}
                aria-current={on ? 'page' : undefined}
                title={m.item.detail ? `${m.item.name}\n${m.item.detail}` : m.item.name}
                onclick={() => openObject(kind, m.item.name, m.item.table)}
                oncontextmenu={(e) => openMenu(e, objectMenuItems(app.db, kind, m.item.name, m.item.table), m.item.name)}
                onkeydown={(e) => {
                  if (menuKey(e)) {
                    e.preventDefault();
                    menuAt(e.currentTarget as HTMLElement, objectMenuItems(app.db, kind, m.item.name, m.item.table), m.item.name);
                  }
                }}
              >
                <span class="icon" aria-hidden="true">{OBJ_ICON[kind]}</span>
                <span class="name">{#each segments(m.item.name, m.match) as seg}<span class:hit={seg.hit} class:pfx={seg.prefix}>{seg.text}</span>{/each}</span>
                {#if m.item.detail}<span class="count">{m.item.detail}</span>{/if}
              </button>
            </div>
          {:else}
            <p class="muted small">{t('sidebar.groupEmpty')}</p>
          {/each}
        {/if}
      {/if}
    {/each}
  </nav>
</aside>

<style>
  .ghead {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 2px 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    cursor: pointer;
    text-align: left;
  }
  .ghead:focus-visible {
    outline: 2px solid var(--sp-focus);
    outline-offset: 2px;
    border-radius: var(--sp-radius);
  }
  .chev {
    width: 10px;
  }
  .gcount {
    margin-left: auto;
    font-weight: 400;
  }
  .small {
    margin: 0 8px 4px 22px;
    font-size: 11.5px;
  }
  .db-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .more {
    min-width: 24px;
    min-height: 24px;
  }
  .side {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    border-right: 1px solid var(--sp-border);
    background: var(--sp-bg-subtle);
  }
  .block {
    padding: 12px 12px 0;
    display: grid;
    gap: 6px;
  }
  .lbl {
    font-size: 12px;
    font-weight: 500;
    color: var(--sp-text-secondary);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--sp-text-secondary);
    cursor: pointer;
  }
  .check code {
    font-family: var(--sp-font-mono);
    font-size: 11.5px;
  }
  .filter {
    padding: 6px 10px;
    font-size: 13px;
  }
  .tables {
    flex: 1;
    overflow: auto;
    padding: 8px 6px 16px;
  }
  .group {
    margin: 8px 8px 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--sp-text-tertiary);
  }
  .group:first-child {
    margin-top: 0;
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    border-radius: var(--sp-radius);
  }
  .bar {
    position: absolute;
    left: 0;
    bottom: 1px;
    height: 2px;
    border-radius: 2px;
    background: var(--sp-border-hover);
    pointer-events: none;
  }
  .row.active .bar {
    background: var(--sp-on-inverse);
    opacity: 0.5;
  }
  .db-size {
    margin: 0;
    font-size: 12px;
    color: var(--sp-text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .sortbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px 0;
  }
  .sortbar .v-segmented__item {
    height: 22px;
    padding: 0 8px;
    font-size: 12px;
  }
  .row:hover {
    background: var(--sp-bg-muted);
  }
  .row.active {
    background: var(--sp-inverse);
  }
  .tbl {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 4px 4px 8px;
    border: 0;
    border-radius: var(--sp-radius);
    background: none;
    text-align: left;
    font-size: 13px;
    color: var(--sp-text-secondary);
    cursor: pointer;
  }
  .row:hover .tbl {
    color: var(--sp-text-primary);
  }
  .row.active .tbl,
  .row.active .pin {
    color: var(--sp-on-inverse);
  }
  .icon {
    font-size: 11px;
    opacity: 0.6;
  }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--sp-font-mono);
    font-size: 12.5px;
  }
  .pfx {
    opacity: 0.5;
  }
  .hit {
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .count {
    font-size: 11px;
    opacity: 0.6;
    font-variant-numeric: tabular-nums;
  }
  .pin {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    margin-right: 2px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--sp-text-tertiary);
    cursor: pointer;
    opacity: 0;
  }
  .row:hover .pin,
  .pin:focus-visible,
  .pin.on {
    opacity: 1;
  }
  .pin:hover {
    color: var(--sp-text-primary);
  }
  .muted {
    padding: 4px 8px;
    color: var(--sp-text-tertiary);
    font-size: 13px;
  }
  .db-pick :global(.sel) {
    width: 100%;
  }
</style>
