<script lang="ts">
  // Database sidebar = spider-ui explorer (data.css, v-explorer). Two rows on
  // top (database + its menu, search + list options), then the list: pinned,
  // tables (one group per shared prefix: "sap_", "cfg_"), views and the other
  // objects. Each row shows one number and the group head says which one.
  // Empty groups are left out; with no database chosen, a hint instead.
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

  // Collapsed groups (remembered): 'tables', 'views', … and 'p:<prefix>' for prefix groups.
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
    openMenu({ clientX: r.left, clientY: r.bottom + 4 }, items, label);
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

{#snippet icon(name: string, cls = 'v-explorer__icon')}
  <svg class={cls} viewBox="0 0 16 16" aria-hidden="true"><path d={MENU_ICONS[name]} fill="none" stroke="currentColor" stroke-width={name === 'more' ? 2.2 : 1.4} stroke-linecap="round" stroke-linejoin="round" /></svg>
{/snippet}

{#snippet item(tb: TableInfo, match: FuzzyMatch, prefix = '')}
  {@const isPinned = pins.has(tb.name)}
  {@const current = tb.name === app.table && app.view !== 'sql'}
  <div class="v-explorer__item">
    {#if bySize && tb.type !== 'VIEW'}
      <span class="v-explorer__bar" style:width="{(Number(tb.bytes ?? 0) / maxBytes) * 100}%" aria-hidden="true"></span>
    {/if}
    <button
      class="v-explorer__link"
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
      {@render icon(tb.type === 'VIEW' ? 'view' : 'table')}
      <span class="v-explorer__name">{#if prefix}<span class="sr-only">{prefix}</span>{/if}{#each segments(tb.name, match, prefix) as seg}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</span>
      {#if tb.type !== 'VIEW'}
        <span class="v-explorer__value">{bySize ? size(tb.bytes) : compact.format(Number(tb.approxRows ?? 0))}</span>
      {/if}
    </button>
    <button
      class="v-explorer__action"
      onclick={() => togglePin(tb.name)}
      aria-pressed={isPinned}
      aria-label={isPinned ? t('sidebar.unpin', { table: tb.name }) : t('sidebar.pin', { table: tb.name })}
      title={isPinned ? t('sidebar.unpin', { table: tb.name }) : t('sidebar.pin', { table: tb.name })}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 1.5l5 5-2 .5-2.5 2.5.5 3-1.5 1.5-3-3-3.5 3.5-.5-.5L5.5 10l-3-3L4 5.5l3 .5L9.5 3.5z" fill={isPinned ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" /></svg>
    </button>
  </div>
{/snippet}

{#snippet groupHead(key: string, title: string, count: number, opts: { mono?: boolean; metric?: boolean; tip?: string } = {})}
  <h3 class="v-explorer__head">
    <button aria-expanded={isOpen(key)} onclick={() => toggleGroup(key)} data-group={key} title={opts.tip}>
      {@render icon('chevDown', 'v-explorer__chev')}
      <span class="v-explorer__title" class:v-mono={opts.mono}>{title}</span>
      <span class="v-explorer__count">{n(count)}</span>
      {#if opts.metric}<span class="v-explorer__metric" title={metricTip}>{metric}</span>{/if}
    </button>
  </h3>
{/snippet}

<aside class="v-explorer side" aria-label={t('sidebar.database')}>
  <div class="v-explorer__top">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="v-explorer__row"
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
        compact
        value={app.db}
        label={t('sidebar.database')}
        placeholder={t('sidebar.pickDbShort')}
        options={databases.map((d) => ({ value: d.name, label: `${d.name} · ${size(d.bytes)}`, hint: t('sidebar.sizeHelp') }))}
        onchange={(v) => void selectDb(v)}
      />
      <button
        class="v-btn-icon v-btn--sm"
        aria-haspopup="menu"
        aria-label={t('dbmenu.label', { db: app.db })}
        title={t('dbmenu.label', { db: app.db })}
        onclick={(e) => menuAt(e.currentTarget as HTMLElement, dbMenuItems(app.db), t('dbmenu.label', { db: app.db }))}
      >
        {@render icon('more', '')}
      </button>
    </div>
    <div class="v-explorer__row">
      <label class="v-explorer__search">
        {@render icon('search', '')}
        <input type="search" placeholder={t('sidebar.filter')} bind:value={filter} onkeydown={onKey} aria-label={t('sidebar.filterLabel')} />
      </label>
      <button
        class="v-btn-icon v-btn--sm"
        aria-haspopup="menu"
        aria-label={t('sidebar.options')}
        title={t('sidebar.optionsTip')}
        data-testid="sidebar-options"
        onclick={(e) => menuAt(e.currentTarget as HTMLElement, optionsMenu(), t('sidebar.options'))}
      >
        {@render icon('sliders', '')}
      </button>
    </div>
  </div>

  <nav class="v-explorer__list tables" aria-label={t('sidebar.tables')}>
    {#if !app.db}
      <p class="v-explorer__empty">{t('sidebar.pickDb')}</p>
    {:else if app.loadingTables}
      <p class="v-explorer__empty">{t('common.loading')}</p>
    {:else}
      {#if !matches.length && !objMatches.total}
        <p class="v-explorer__empty">{filter ? t('sidebar.noMatch') : t('sidebar.empty')}</p>
      {/if}
      {#if pinned.length && !searching}
        <section class="v-explorer__group">
          <h3 class="v-explorer__head"><span>{t('sidebar.pinned')}</span></h3>
          {#each pinned as m (m.item.name)}{@render item(m.item, m.match)}{/each}
        </section>
      {/if}
      {#each tableGroups as g (g.key)}
        {#if g.items.length}
          <section class="v-explorer__group">
            {#if g.prefix === null}
              {@render groupHead('tables', t('sidebar.group.tables'), g.items.length, { metric: true })}
            {:else if g.prefix}
              {@render groupHead(g.key, g.prefix, g.items.length, { mono: true, metric: true, tip: t('sidebar.prefixTip', { prefix: g.prefix }) })}
            {:else}
              {@render groupHead(g.key, t('sidebar.group.other'), g.items.length, { metric: true })}
            {/if}
            {#if isOpen(g.key)}{#each g.items as m (m.item.name)}{@render item(m.item, m.match, g.prefix ?? '')}{/each}{/if}
          </section>
        {/if}
      {/each}
      {#if viewMatches.length}
        <section class="v-explorer__group">
          {@render groupHead('views', t('sidebar.group.views'), viewMatches.length)}
          {#if isOpen('views')}{#each viewMatches as m (m.item.name)}{@render item(m.item, m.match)}{/each}{/if}
        </section>
      {/if}
      {#each ['procedures', 'functions', 'triggers', 'events'] as const as g}
        {#if objMatches[g].length}
          <section class="v-explorer__group">
            {@render groupHead(g, t(`sidebar.group.${g}`), objMatches[g].length)}
            {#if isOpen(g)}
              {#each objMatches[g] as m (m.item.name)}
                {@const kind = OBJ_KIND[g]}
                {@const on = app.view === 'object' && app.object?.kind === kind && app.object?.name === m.item.name}
                <div class="v-explorer__item">
                  <button
                    class="v-explorer__link"
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
                    {@render icon(OBJ_ICON[kind])}
                    <span class="v-explorer__name">{#each segments(m.item.name, m.match) as seg}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</span>
                    {#if m.item.detail}<span class="v-explorer__value">{m.item.detail}</span>{/if}
                  </button>
                </div>
              {/each}
            {/if}
          </section>
        {/if}
      {/each}
    {/if}
  </nav>
</aside>

<style>
  /* The rest comes from spider-ui (data.css, v-explorer). */
  .side :global(.sel) {
    width: 100%;
  }
  .side .v-btn-icon svg {
    width: 16px;
    height: 16px;
  }
</style>
