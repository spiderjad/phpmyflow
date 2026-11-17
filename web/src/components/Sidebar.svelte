<script lang="ts">
  // Database sidebar in the spider-ui app frame look (shell.css: the SpiderFolio
  // menu). The database on top as the "company" row (it switches databases),
  // then search, create (+) and the database menu (⋯), the list (pinned, tables
  // with one fold per shared prefix such as "sap_" / "cfg_", views and the other
  // objects) and the connection at the bottom. Each row shows one number and the
  // "Tables" line says which one. Empty groups are left out. The current row
  // takes the theme accent (scoped --sp-primary-*), so violet only shows up in
  // the Spider theme and stays the assistant's color everywhere else.
  import Select from './ui/Select.svelte';
  import type { TableInfo } from '../lib/api';
  import { formatBytes } from '../lib/bytes';
  import { fuzzyFilter, prefixGroups, type FuzzyMatch } from '../lib/fuzzy';
  import { i18n, n, t } from '../lib/i18n.svelte';
  import { MENU_ICONS } from '../lib/menuIcons';
  import { pinnedTables, prefs, savePrefs, togglePin, type TableSort } from '../lib/prefs.svelte';
  import { app, selectDb, selectTable } from '../lib/state.svelte';
  import { tabs } from '../lib/tabs.svelte';
  import { toast } from '../lib/ui.svelte';
  import { dbMenuItems, objectMenuItems, openMenu, tableMenuItems } from '../lib/dbActions.svelte';
  import { openObject } from '../lib/state.svelte';
  import type { ObjKind } from '../lib/objects';
  import type { MenuItem } from './ui/Menu.svelte';

  let { onsettings, onlogout }: { onsettings?: () => void; onlogout?: () => void } = $props();

  // Collapsed groups (remembered): 'views', … and 'p:<prefix>' for prefix groups.
  const GROUP_KEY = 'pmf_side_collapsed';
  let collapsed = $state<Set<string>>(
    (() => {
      try {
        return new Set(JSON.parse(localStorage.getItem(GROUP_KEY) ?? '[]') as string[]);
      } catch {
        return new Set<string>();
      }
    })(),
  );
  function toggleGroup(g: string) {
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
  const isOpen = (g: string) => !!filter.trim() || !collapsed.has(g);

  type ObjGroup = 'procedures' | 'functions' | 'triggers' | 'events';
  const OBJ_KIND: Record<ObjGroup, ObjKind> = { procedures: 'PROCEDURE', functions: 'FUNCTION', triggers: 'TRIGGER', events: 'EVENT' };
  const OBJ_ICON: Record<ObjKind, string> = { VIEW: 'view', PROCEDURE: 'play', FUNCTION: 'fn', TRIGGER: 'zap', EVENT: 'clock' };

  const dbMenu = (e: MouseEvent | { clientX: number; clientY: number }) => openMenu(e, dbMenuItems(app.db), t('dbmenu.label', { db: app.db }));
  function menuAt(el: HTMLElement, items: MenuItem[], label: string) {
    const r = el.getBoundingClientRect();
    const up = r.bottom + 240 > window.innerHeight;
    openMenu({ clientX: r.left, clientY: up ? r.top - 4 : r.bottom + 4 }, items, label);
  }
  /** Context-menu key or Shift+F10 on a focused element opens its menu. */
  const menuKey = (e: KeyboardEvent) => e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');

  let filter = $state('');
  let showSystem = $state(false);
  const searching = $derived(!!filter.trim());

  const databases = $derived(app.databases.filter((d) => showSystem || !d.system || d.name === app.db));
  const maxBytes = $derived(Math.max(1, ...app.tables.map((tb) => Number(tb.bytes ?? 0))));
  const sorted = $derived.by(() => {
    const list = [...app.tables];
    if (prefs.tableSort === 'size') list.sort((a, b) => Number(b.bytes ?? 0) - Number(a.bytes ?? 0) || a.name.localeCompare(b.name));
    else if (prefs.tableSort === 'rows') list.sort((a, b) => Number(b.approxRows ?? 0) - Number(a.approxRows ?? 0) || a.name.localeCompare(b.name));
    return list;
  });
  // A typed filter ranks by match quality; otherwise the chosen sort applies.
  const matches = $derived(fuzzyFilter(sorted, filter, (tb) => tb.name));
  const size = (b: number | null | undefined) => formatBytes(b, i18n.locale);
  const compact = $derived(new Intl.NumberFormat(i18n.locale, { notation: 'compact', maximumSignificantDigits: 3 }));

  const tableMatches = $derived(matches.filter((m) => m.item.type !== 'VIEW'));
  const viewMatches = $derived(matches.filter((m) => m.item.type === 'VIEW'));
  // Prefix groups come from every table (they don't move while typing); a search shows one ranked list.
  const prefixes = $derived(prefixGroups(app.tables.filter((tb) => tb.type !== 'VIEW'), (tb) => tb.name));
  const groupOf = $derived(new Map((prefixes ?? []).flatMap((g) => g.items.map((tb) => [tb.name, g.prefix] as const))));
  type TableGroup = { key: string; prefix: string | null; items: typeof tableMatches };
  const tableGroups = $derived.by((): TableGroup[] => {
    if (!prefixes || !prefs.groupPrefix || searching) return [{ key: 'tables', prefix: null, items: tableMatches }];
    return prefixes.map((g) => ({ key: `p:${g.prefix}`, prefix: g.prefix, items: tableMatches.filter((m) => groupOf.get(m.item.name) === g.prefix) }));
  });

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

  // The number on each row: size when sorted by size, approximate rows otherwise.
  const bySize = $derived(prefs.tableSort === 'size');
  const metric = $derived(t(bySize ? 'sidebar.metric.size' : 'sidebar.metric.rows') + (!searching && prefs.tableSort !== 'name' ? ' ↓' : ''));
  const metricTip = $derived(t(bySize ? 'sidebar.sizeHelp' : 'sidebar.rowsHelp'));

  const tableCount = $derived(app.tables.filter((tb) => tb.type !== 'VIEW').length);
  const dbInfo = $derived(app.databases.find((d) => d.name === app.db));
  /** "conector_sap" → "CS", "shop" → "S". */
  const initialOf = (s: string) =>
    s
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('') || '?';
  const user = $derived(app.session?.auth?.user ?? '');
  const host = $derived(app.session?.auth?.host ?? '');

  function setSort(value: TableSort) {
    prefs.tableSort = value;
    savePrefs();
  }
  function optionsMenu(): MenuItem[] {
    const sorts: [TableSort, string][] = [
      ['name', 'sidebar.sortName'],
      ['rows', 'sidebar.sortRows'],
      ['size', 'sidebar.sortSize'],
    ];
    const items: MenuItem[] = sorts.map(([v, key]) => ({ label: t(key), checked: prefs.tableSort === v, action: () => setSort(v), id: `sort-${v}` }));
    items.push('sep');
    if (prefixes) {
      items.push({
        label: t('sidebar.groupPrefix'),
        checked: prefs.groupPrefix,
        toggle: true,
        id: 'group-prefix',
        action: () => {
          prefs.groupPrefix = !prefs.groupPrefix;
          savePrefs();
        },
      });
    }
    items.push({ label: t('sidebar.showSystem'), checked: showSystem, toggle: true, id: 'show-system', action: () => (showSystem = !showSystem) });
    return items;
  }
  /** "+": the create items of the database menu, table first and a new database last. */
  function createMenu(): MenuItem[] {
    const create = dbMenuItems(app.db).find((i) => i !== 'sep' && i.id === 'createNew');
    const items = create && create !== 'sep' ? (create.submenu ?? []) : [];
    const isDb = (i: MenuItem) => i !== 'sep' && i.id === 'newDb';
    return [...items.filter((i) => !isDb(i)), 'sep', ...items.filter(isDb)];
  }
  function accountMenu(): MenuItem[] {
    return [
      { label: t('settings.title'), id: 'settings', icon: 'sliders', keys: ['Ctrl', ','], action: () => onsettings?.() },
      'sep',
      { label: t('nav.logout'), id: 'logout', icon: 'logout', action: () => onlogout?.() },
    ];
  }

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

  /** Split a name into matched / plain runs, without the group's prefix. */
  function segments(name: string, match: FuzzyMatch, prefix = '') {
    const start = prefix && name.startsWith(prefix) ? prefix.length : 0;
    const hits = new Set(match.positions);
    const out: { text: string; hit: boolean }[] = [];
    for (let i = start; i < name.length; i++) {
      const hit = hits.has(i);
      const last = out[out.length - 1];
      if (last && last.hit === hit) last.text += name[i];
      else out.push({ text: name[i], hit });
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

{#snippet icon(name: string, cls = '')}
  <svg class={cls} viewBox="0 0 16 16" aria-hidden="true"><path d={MENU_ICONS[name]} fill="none" stroke="currentColor" stroke-width={name === 'more' ? 2.4 : 1.5} stroke-linecap="round" stroke-linejoin="round" /></svg>
{/snippet}

{#snippet item(tb: TableInfo, match: FuzzyMatch, prefix = '')}
  {@const isPinned = pins.has(tb.name)}
  {@const current = tb.name === app.table && app.view !== 'sql'}
  <div class="pmf-row">
    {#if bySize && tb.type !== 'VIEW'}
      <span class="pmf-bar" style:width="calc((100% - 24px) * {Number(tb.bytes ?? 0) / maxBytes})" aria-hidden="true"></span>
    {/if}
    <button
      class="v-nav-item v-nav-item--compact"
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
      title={tip(tb) + '\n\n' + t('sidebar.ctrlClick')}
      data-table={tb.name}
      aria-current={current ? 'page' : undefined}
    >
      <span class="v-sidebar__slot">{@render icon(tb.type === 'VIEW' ? 'view' : 'table')}</span>
      <span class="v-nav-item__label">{#if prefix}<span class="sr-only">{prefix}</span>{/if}{#each segments(tb.name, match, prefix) as seg}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</span>
      {#if tb.type !== 'VIEW'}
        <span class="pmf-value">{bySize ? size(tb.bytes) : compact.format(Number(tb.approxRows ?? 0))}</span>
      {/if}
    </button>
    <button
      class="pmf-pin"
      class:on={isPinned}
      onclick={() => togglePin(tb.name)}
      aria-pressed={isPinned}
      aria-label={isPinned ? t('sidebar.unpin', { table: tb.name }) : t('sidebar.pin', { table: tb.name })}
      title={isPinned ? t('sidebar.unpin', { table: tb.name }) : t('sidebar.pin', { table: tb.name })}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 1.5l5 5-2 .5-2.5 2.5.5 3-1.5 1.5-3-3-3.5 3.5-.5-.5L5.5 10l-3-3L4 5.5l3 .5L9.5 3.5z" fill={isPinned ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" /></svg>
    </button>
  </div>
{/snippet}

{#snippet fold(key: string, title: string, count: number, opts: { prefix?: boolean; tip?: string } = {})}
  <button class="v-sidebar__group" class:pmf-prefix={opts.prefix} aria-expanded={isOpen(key)} onclick={() => toggleGroup(key)} data-group={key} title={opts.tip}>
    {@render icon('chevDown')}
    <span class="pmf-fold-name">{title}</span>
    <span class="pmf-count">{n(count)}</span>
  </button>
{/snippet}

{#snippet dbRow()}
  <span class="v-sidebar__slot">
    {#if app.db}
      <span class="v-mark pmf-initial" data-initial={initialOf(app.db).slice(0, 1)} aria-hidden="true"></span>
    {:else}
      {@render icon('database', 'pmf-db-icon')}
    {/if}
  </span>
  <span class="v-sidebar__row-text">
    <strong>{app.db || t('sidebar.pickDbShort')}</strong>
    {#if app.db}
      <!-- " · " keeps "name · …" as the button's text (e2e pickDb, screen readers). -->
      <span><span class="sr-only">{' · '}</span>{app.loadingTables || !app.tables.length ? size(dbInfo?.bytes) : t('sidebar.dbSub', { count: n(tableCount), size: size(dbInfo?.bytes) })}</span>
    {:else}
      <span>{t('sidebar.database')}</span>
    {/if}
  </span>
  {@render icon('chevUpDown')}
{/snippet}

<aside class="v-sidebar__panel side" aria-label={t('sidebar.database')}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="v-sidebar__top"
    oncontextmenu={(e) => app.db && dbMenu(e)}
    onkeydown={(e) => {
      if (app.db && menuKey(e)) {
        e.preventDefault();
        menuAt(e.target as HTMLElement, dbMenuItems(app.db), t('dbmenu.label', { db: app.db }));
      }
    }}
  >
    <Select
      id="db-select"
      triggerClass="v-sidebar__row"
      trigger={dbRow}
      value={app.db}
      label={t('sidebar.database')}
      options={databases.map((d) => ({ value: d.name, label: `${d.name} · ${size(d.bytes)}`, hint: t('sidebar.sizeHelp') }))}
      onchange={(v) => void selectDb(v)}
    />
  </div>

  <div class="v-sidebar__actions">
    <label class="v-sidebar__search">
      <span class="v-sidebar__slot">{@render icon('search')}</span>
      <input type="search" placeholder={t('sidebar.filter')} bind:value={filter} onkeydown={onKey} aria-label={t('sidebar.filterLabel')} disabled={!app.db} />
    </label>
    <button
      class="v-sidebar__add"
      aria-haspopup="menu"
      aria-label={t('sidebar.create')}
      title={t('sidebar.createTip')}
      onclick={(e) => menuAt(e.currentTarget as HTMLElement, createMenu(), t('sidebar.create'))}
    >
      {@render icon('plus')}
    </button>
    <button
      class="v-sidebar__add"
      aria-haspopup="menu"
      aria-label={t('dbmenu.label', { db: app.db })}
      title={t('dbmenu.label', { db: app.db })}
      disabled={!app.db}
      onclick={(e) => menuAt(e.currentTarget as HTMLElement, dbMenuItems(app.db), t('dbmenu.label', { db: app.db }))}
    >
      {@render icon('more')}
    </button>
  </div>

  <nav class="v-sidebar__nav tables" aria-label={t('sidebar.tables')}>
    {#if !app.db}
      <p class="pmf-empty">{t('sidebar.pickDb')}</p>
    {:else if app.loadingTables}
      <p class="pmf-empty">{t('common.loading')}</p>
    {:else}
      {#if pinned.length && !searching}
        <p class="v-sidebar__section">{t('sidebar.pinned')}</p>
        {#each pinned as m (m.item.name)}{@render item(m.item, m.match)}{/each}
      {/if}
      <div class="v-sidebar__section pmf-section">
        <span>{t('sidebar.group.tables')}</span>
        <span class="pmf-count">{n(tableMatches.length)}</span>
        {#if tableMatches.length}<span class="pmf-metric" title={metricTip}>{metric}</span>{/if}
        <button
          class="pmf-tool"
          aria-haspopup="menu"
          aria-label={t('sidebar.options')}
          title={t('sidebar.optionsTip')}
          data-testid="sidebar-options"
          onclick={(e) => menuAt(e.currentTarget as HTMLElement, optionsMenu(), t('sidebar.options'))}
        >
          {@render icon('sliders')}
        </button>
      </div>
      {#if !matches.length && !objMatches.total}
        <p class="pmf-empty">{filter ? t('sidebar.noMatch') : t('sidebar.empty')}</p>
      {/if}
      {#each tableGroups as g (g.key)}
        {#if g.items.length}
          {#if g.prefix === null}
            {#each g.items as m (m.item.name)}{@render item(m.item, m.match)}{/each}
          {:else}
            {#if g.prefix}
              {@render fold(g.key, g.prefix, g.items.length, { prefix: true, tip: t('sidebar.prefixTip', { prefix: g.prefix }) })}
            {:else}
              {@render fold(g.key, t('sidebar.group.other'), g.items.length)}
            {/if}
            {#if isOpen(g.key)}{#each g.items as m (m.item.name)}{@render item(m.item, m.match, g.prefix ?? '')}{/each}{/if}
          {/if}
        {/if}
      {/each}
      {#if viewMatches.length || objMatches.total}
        <hr class="v-sidebar__sep" />
      {/if}
      {#if viewMatches.length}
        {@render fold('views', t('sidebar.group.views'), viewMatches.length)}
        {#if isOpen('views')}{#each viewMatches as m (m.item.name)}{@render item(m.item, m.match)}{/each}{/if}
      {/if}
      {#each ['procedures', 'functions', 'triggers', 'events'] as const as g}
        {#if objMatches[g].length}
          {@render fold(g, t(`sidebar.group.${g}`), objMatches[g].length)}
          {#if isOpen(g)}
            {#each objMatches[g] as m (m.item.name)}
              {@const kind = OBJ_KIND[g]}
              {@const on = app.view === 'object' && app.object?.kind === kind && app.object?.name === m.item.name}
              <div class="pmf-row">
                <button
                  class="v-nav-item v-nav-item--compact"
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
                  <span class="v-sidebar__slot">{@render icon(OBJ_ICON[kind])}</span>
                  <span class="v-nav-item__label">{#each segments(m.item.name, m.match) as seg}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</span>
                  {#if m.item.detail}<span class="pmf-value">{m.item.detail}</span>{/if}
                </button>
              </div>
            {/each}
          {/if}
        {/if}
      {/each}
    {/if}
  </nav>

  {#if user}
    <div class="v-sidebar__foot">
      <button
        class="v-sidebar__row"
        aria-haspopup="menu"
        aria-label={t('sidebar.account', { user, host })}
        title={`${user}@${host}${app.serverVersion ? `\n${app.serverVersion}` : ''}`}
        onclick={(e) => menuAt(e.currentTarget as HTMLElement, accountMenu(), `${user}@${host}`)}
      >
        <span class="v-sidebar__slot"><span class="v-avatar">{initialOf(user)}</span></span>
        <span class="v-sidebar__row-text"><strong>{user}</strong><span>{host}</span></span>
        {@render icon('chevUpDown')}
      </button>
    </div>
  {/if}
</aside>

<style>
  /* Sidebar only (pmf- = phpMyFlow). The frame classes come from spider-ui (shell.css). */

  /* The current row and the marks take the theme accent instead of violet. */
  .side {
    --sp-primary: var(--sp-inverse);
    --sp-on-primary: var(--sp-on-inverse);
    --sp-primary-light: color-mix(in srgb, var(--sp-inverse) 10%, var(--sp-bg));
    --sp-primary-text: color-mix(in srgb, var(--sp-inverse) 70%, var(--sp-text-primary));
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  /* The database's initial, drawn from an attribute so the button text starts with the name. */
  .pmf-initial::before {
    content: attr(data-initial);
  }
  .side :global(svg.pmf-db-icon) {
    width: 20px;
    height: 20px;
    margin: 0;
  }

  /* Search: the spider-ui search button, holding an input. */
  .v-sidebar__search {
    cursor: text;
  }
  .v-sidebar__search:focus-within {
    outline: 2px solid var(--sp-focus);
    outline-offset: 1px;
  }
  .v-sidebar__search input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 8px 0 0;
    font: inherit;
    font-size: var(--sp-fs-sm);
    color: var(--sp-text-primary);
    background: transparent;
    border: 0;
    outline: none;
  }
  .v-sidebar__search input::placeholder {
    color: var(--sp-text-secondary);
  }
  .v-sidebar__add:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* "Tables 26 · Rows ↓ [options]" line. */
  .pmf-section {
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 8px 2px 4px 10px;
  }
  .pmf-metric {
    margin-left: auto;
    cursor: help;
  }
  .pmf-tool {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    margin-left: auto;
    padding: 0;
    color: var(--sp-text-secondary);
    background: transparent;
    border: 0;
    border-radius: 4px;
    cursor: pointer;
  }
  .pmf-metric + .pmf-tool {
    margin-left: 0;
  }
  .pmf-tool:hover {
    color: var(--sp-text-primary);
    background: var(--sp-bg-muted);
  }
  .pmf-tool:focus-visible {
    outline: 2px solid var(--sp-focus);
  }
  .pmf-tool svg {
    width: 14px;
    height: 14px;
  }
  .pmf-count {
    font-weight: 400;
    letter-spacing: 0;
    color: var(--sp-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  /* Folds: a table prefix keeps its case ("sap_"), in the identifier font. */
  .v-sidebar__group {
    flex-shrink: 0;
    width: 100%;
    text-align: left;
  }
  .pmf-prefix {
    font-family: var(--sp-font-mono);
    font-size: 12px;
    text-transform: none;
    letter-spacing: 0;
  }
  .pmf-fold-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* A row: the item, its number and the pin (on hover / focus). */
  .pmf-row {
    position: relative;
    flex-shrink: 0;
  }
  .pmf-row :global(.v-nav-item) {
    padding: 0;
    font-family: inherit;
    text-align: left;
    background: transparent;
    border: 0;
    cursor: pointer;
  }
  .pmf-row :global(.v-nav-item:hover) {
    background: var(--sp-bg-muted);
  }
  .pmf-row :global(.v-nav-item[aria-current='page']) {
    background: var(--sp-primary-light);
  }
  .pmf-value {
    flex-shrink: 0;
    margin-right: 8px;
    font-size: var(--sp-fs-xs);
    color: var(--sp-text-secondary);
    font-variant-numeric: tabular-nums;
  }
  [aria-current='page'] .pmf-value {
    color: var(--sp-primary-text);
  }
  .pmf-bar {
    position: absolute;
    bottom: 2px;
    left: 16px;
    height: 2px;
    border-radius: 1px;
    background: color-mix(in srgb, var(--sp-text-primary) 18%, transparent);
    pointer-events: none;
  }
  .pmf-pin {
    position: absolute;
    top: 3px;
    right: 4px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    color: var(--sp-text-secondary);
    background: var(--sp-bg-muted);
    border: 0;
    border-radius: 4px;
    opacity: 0;
    cursor: pointer;
  }
  .pmf-row:hover .pmf-pin,
  .pmf-pin:focus-visible {
    opacity: 1;
  }
  .pmf-row:hover .pmf-value,
  .pmf-row:has(.pmf-pin:focus-visible) .pmf-value {
    visibility: hidden;
  }
  .pmf-pin:hover {
    color: var(--sp-text-primary);
  }
  .pmf-pin:focus-visible {
    outline: 2px solid var(--sp-focus);
  }
  .pmf-pin svg {
    width: 14px;
    height: 14px;
  }
  mark {
    padding: 0;
    color: inherit;
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 2px;
    background: none;
  }
  .pmf-empty {
    margin: 0;
    padding: 8px 10px;
    font-size: var(--sp-fs-sm);
    color: var(--sp-text-secondary);
  }
  @media (hover: none) {
    .pmf-pin.on {
      opacity: 1;
    }
  }
</style>
