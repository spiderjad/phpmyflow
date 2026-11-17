<script lang="ts">
  import Select from './ui/Select.svelte';
  import { tick, untrack } from 'svelte';
  import { api, ApiError, editorApi, type Cell, type RowsResult } from '../lib/api';
  import { friendlyError } from '../lib/errors';
  import type { GridColumn } from '../lib/grid';
  import { i18n, n, t } from '../lib/i18n.svelte';
  import { linksOf } from '../lib/relations';
  import { columnKeys, type KeyIconData, type KeyInfo } from '../lib/keyIcons';
  import { settings } from '../lib/settings.svelte';
  import { applyLabels, collectRefs, lookupMany, type ColumnLabels } from '../lib/fkLabels';
  import { app, openFiltered } from '../lib/state.svelte';
  import { confirmAction, toast } from '../lib/ui.svelte';
  import { openMenu } from '../lib/dbActions.svelte';
  import { prefs } from '../lib/prefs.svelte';
  import { update } from '../lib/settings.svelte';
  import type { MenuItem } from './ui/Menu.svelte';
  import DataGrid from './DataGrid.svelte';
  import DensityToggle from './DensityToggle.svelte';
  import InsertRowDrawer from './InsertRowDrawer.svelte';

  let { db, table }: { db: string; table: string } = $props();

  let meta = $state<Omit<RowsResult, 'rows'> | null>(null);
  let rows = $state<Cell[][]>([]);
  let total = $state<number | null>(null);
  let totalApprox = $state(false);
  let counting = $state(false);
  let loading = $state(false);
  let error = $state('');
  let page = $state(1);
  // Default from Settings › Data and grid; the footer select changes it for this table only.
  let perPage = $state<number>(settings.data.perPage);
  let sort = $state<{ col: string; dir: 'ASC' | 'DESC' } | null>(null);
  let filters = $state<Record<string, string>>({});
  let filtersOpen = $state(false);
  let selected = $state<Set<number>>(new Set());

  const readOnly = $derived(app.session?.readOnly ?? false);
  const isView = $derived(app.tables.find((tb) => tb.name === table)?.type === 'VIEW');
  let inserting = $state(false);

  async function insertRow(values: Record<string, string | number | null>) {
    const res = await api.insertRow({ db, table, values });
    toast(res.insertId ? t('insert.doneId', { id: res.insertId }) : t('insert.done'), 'success');
    countKey = '';
    await load();
  }
  const editable = $derived(!!meta && meta.primaryKey.length > 0 && !readOnly);
  const shownTotal = $derived(total ?? meta?.estimate ?? 0);
  const pages = $derived(meta ? Math.max(1, Math.ceil(shownTotal / meta.perPage)) : 1);
  const activeFilters = $derived(Object.fromEntries(Object.entries(filters).filter(([, v]) => v.trim() !== '')));
  const filterCount = $derived(Object.keys(activeFilters).length);
  const linkMap = $derived(linksOf(app.relations, table));
  const columns = $derived<GridColumn[]>(
    meta?.columns.map((c) => ({ name: c.name, type: c.dataType, fullType: c.type, pk: c.key === 'PRI', nullable: c.nullable, comment: c.comment })) ?? [],
  );

  const links = $derived(columns.map((c) => linkMap.get(c.name)));

  // Key icons in the header: indexes and declared FKs (table_info, once per
  // table) plus inferred relations. A click opens the definition in Structure.
  let keyInfo = $state<KeyInfo | null>(null);
  let keySeq = 0;
  $effect(() => {
    const [d, tb] = [db, table];
    const mine = ++keySeq;
    keyInfo = null;
    editorApi
      .info(d, tb)
      .then((r) => {
        if (mine === keySeq) keyInfo = { indexes: r.indexes, foreignKeys: r.foreignKeys };
      })
      .catch(() => {});
  });
  const inferredRefs = $derived([...linkMap.entries()].filter(([, l]) => l.kind === 'inferred').map(([column, l]) => ({ column, table: l.to, toColumn: l.toColumn })));
  const keyIcons = $derived(keyInfo ? columns.map((c) => columnKeys(c.name, keyInfo, inferredRefs)) : null);
  function openKey(k: KeyIconData) {
    app.structureFocus = k.target;
    app.view = 'structure';
  }

  // Names for related columns: ONE lookup_many per loaded page (ids shown meanwhile).
  let labels = $state<(ColumnLabels | undefined)[]>([]);
  let labelSeq = 0;
  async function loadLabels() {
    const mine = ++labelSeq;
    const ls = links;
    labels = [];
    const refs = collectRefs(rows, ls);
    if (!refs.length) return;
    try {
      const r = await lookupMany(db, refs);
      if (mine === labelSeq) labels = applyLabels(ls, r.labels);
    } catch {
      /* the ids stay visible */
    }
  }

  /** Follow a cell's relation: target table filtered by the value. */
  function follow(r: number, c: number) {
    const link = links[c];
    const v = rows[r]?.[c];
    if (!link || v === null || v === undefined || typeof v === 'object') return;
    openFiltered(link.to, { [link.toColumn]: '=' + String(v) });
  }

  const pkIndex = $derived(meta && meta.primaryKey.length === 1 ? columns.findIndex((c) => c.name === meta!.primaryKey[0]) : -1);

  function loadRelated(r: number) {
    const v = rows[r]?.[pkIndex];
    if (pkIndex === -1 || v === null || v === undefined || typeof v === 'object') return Promise.resolve([]);
    return api.refCounts({ db, table, value: v }).then((res) => res.counts);
  }

  function openRelated(ref: { table: string; column: string }, r: number) {
    const v = rows[r]?.[pkIndex];
    if (v === null || v === undefined || typeof v === 'object') return;
    openFiltered(ref.table, { [ref.column]: '=' + String(v) });
  }

  let requestId = 0;
  async function load() {
    const id = ++requestId;
    loading = true;
    error = '';
    try {
      const res = await api.rows({ db, table, page, perPage, sort: sort?.col, dir: sort?.dir ?? 'ASC', filters: activeFilters });
      if (id !== requestId) return;
      const { rows: data, ...rest } = res;
      meta = rest;
      rows = data.map((r) => rest.columns.map((c) => r[c.name]));
      void loadLabels();
      selected = new Set();
      if (res.total !== null) {
        total = res.total;
        totalApprox = false;
      } else {
        // Rows are on screen; count in the background ("~N" meanwhile).
        countRows(id);
      }
    } catch (err) {
      if (id === requestId) error = err instanceof ApiError ? friendlyError(err, app.schema).title : String(err);
    } finally {
      if (id === requestId) loading = false;
    }
  }

  let countKey = '';
  async function countRows(id: number) {
    const key = JSON.stringify([db, table, activeFilters]);
    if (key === countKey && total !== null) return; // same filters: paging doesn't change the count
    total = null;
    counting = true;
    try {
      const res = await api.count({ db, table, filters: activeFilters });
      if (id !== requestId && key !== JSON.stringify([db, table, activeFilters])) return;
      total = res.total;
      totalApprox = res.approx;
      countKey = key;
    } catch {
      /* keep the estimate */
    } finally {
      counting = false;
    }
  }

  // New table: reset state and reload. Only db/table are tracked.
  $effect(() => {
    void db;
    void table;
    untrack(() => {
      page = 1;
      sort = null;
      const pending = app.pendingFilter?.table === table ? app.pendingFilter.filters : null;
      app.pendingFilter = null;
      filters = pending ? { ...pending } : {};
      filtersOpen = !!pending;
      meta = null;
      rows = [];
      total = null;
      countKey = '';
      load();
    });
  });

  function toggleSort(col: string) {
    sort = sort?.col === col ? { col, dir: sort.dir === 'ASC' ? 'DESC' : 'ASC' } : { col, dir: 'ASC' };
    load();
  }

  let filterTimer: ReturnType<typeof setTimeout>;
  function onFilter(col: string, value: string) {
    filters[col] = value;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      page = 1;
      load();
    }, 350);
  }

  function clearFilters() {
    filters = {};
    page = 1;
    load();
  }

  function keyOf(row: Cell[]): Record<string, Cell> {
    return Object.fromEntries(meta!.primaryKey.map((k) => [k, row[columns.findIndex((c) => c.name === k)]]));
  }

  async function saveCell(r: number, c: number, value: string | null): Promise<boolean> {
    try {
      await api.updateCell({ db, table, column: columns[c].name, key: keyOf(rows[r]), value });
      rows[r][c] = value;
      if (links[c]) void loadLabels(); // the new id needs its name
      toast(t('grid.saved'), 'success', 1800);
      return true;
    } catch (err) {
      toast(err instanceof ApiError ? friendlyError(err, app.schema).title : String(err), 'error', 6000);
      return false;
    }
  }

  /** "Filter by / exclude this value" from the grid menu. */
  function filterValue(col: string, value: Cell, exclude: boolean) {
    filters[col] = value === null ? (exclude ? '!NULL' : 'NULL') : (exclude ? '!=' : '=') + String(value);
    filtersOpen = true;
    page = 1;
    load();
  }

  async function deleteSelected(indexes: number[] = [...selected]) {
    if (!meta || !indexes.length) return;
    const ok = await confirmAction({
      title: t('grid.deleteTitle', { count: indexes.length }),
      body: t('grid.deleteBody', { table }),
      confirmLabel: t('grid.deleteConfirm'),
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await api.deleteRows({ db, table, keys: indexes.map((i) => keyOf(rows[i])) });
      toast(t('grid.deleted', { count: res.affected }), 'success');
      countKey = '';
      load();
    } catch (err) {
      toast(err instanceof ApiError ? friendlyError(err, app.schema).title : String(err), 'error', 6000);
    }
  }

  function go(p: number) {
    page = p;
    load();
  }

  // Bar actions that don't fit move into "⋯", in this order (the first one folds first).
  // Measured, not fixed breakpoints: labels differ per language.
  const FOLD_ORDER = ['refresh', 'density', 'clear', 'filter', 'insert'] as const;
  type Fold = (typeof FOLD_ORDER)[number];
  const META_MIN = 120; // the row count stays readable
  let folded = $state(0);
  let barW = $state(0);
  let barEl: HTMLElement | undefined = $state();
  let actionsEl: HTMLElement | undefined = $state();
  const isFolded = (a: Fold) => FOLD_ORDER.indexOf(a) < folded;
  // At most one fit per frame, so a resize storm can never keep the page busy.
  let fitFrame = 0;
  let fitting = false;
  let refit = false;
  function scheduleFit() {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => void fit());
  }
  async function fit() {
    if (!barEl || !actionsEl) return;
    if (fitting) {
      refit = true;
      return;
    }
    fitting = true;
    folded = 0;
    await tick();
    const room = () => (barEl ? barEl.clientWidth - 28 - META_MIN : Infinity);
    while (actionsEl && actionsEl.offsetWidth > room() && folded < FOLD_ORDER.length) {
      folded++;
      await tick();
    }
    fitting = false;
    if (refit) {
      refit = false;
      scheduleFit();
    }
  }
  $effect(() => {
    void [barW, selected.size, filterCount, !!meta, readOnly, isView, i18n.locale, loading];
    untrack(scheduleFit);
    return () => cancelAnimationFrame(fitFrame);
  });
  const setDensity = (d: 'compact' | 'comfortable') => update('appearance', { density: d });
  function moreMenu(): MenuItem[] {
    const items: MenuItem[] = [];
    if (isFolded('clear') && filterCount) items.push({ label: t('grid.clearFilters'), id: 'clear-filters', icon: 'exclude', action: clearFilters });
    if (isFolded('insert') && meta && !readOnly && !isView) items.push({ label: t('insert.button'), id: 'insert-row', icon: 'plus', action: () => (inserting = true) });
    if (isFolded('filter')) items.push({ label: t('grid.filter'), id: 'toggle-filters', icon: 'filter', checked: filtersOpen, toggle: true, action: () => (filtersOpen = !filtersOpen) });
    if (isFolded('density')) {
      if (items.length) items.push('sep');
      items.push(
        { label: t('grid.compact'), id: 'density-compact', checked: prefs.density === 'compact', action: () => setDensity('compact') },
        { label: t('grid.comfortable'), id: 'density-comfortable', checked: prefs.density === 'comfortable', action: () => setDensity('comfortable') },
      );
    }
    if (isFolded('refresh')) {
      if (items.length) items.push('sep');
      items.push({ label: t('common.refresh'), id: 'refresh', icon: 'refresh', disabled: loading, action: load });
    }
    return items;
  }
</script>

<section class="view">
  <header class="bar" bind:this={barEl} bind:clientWidth={barW}>
    <div class="meta">
      {#if meta}
        <span class="count" aria-live="polite">
          {#if total === null || totalApprox}~{/if}{t('grid.rows', { count: n(shownTotal) })}
          {#if counting}<span class="dim">· {t('grid.counting')}</span>{/if}
        </span>
        <span class="dim ms">{t('common.ms', { ms: meta.timeMs })}</span>
      {/if}
      {#if meta && !meta.primaryKey.length}
        <span class="v-badge" title={t('grid.noPkHelp')}>{t('grid.noPk')}</span>
      {/if}
      {#if readOnly}
        <span class="v-badge">{t('common.readOnly')}</span>
      {/if}
    </div>
    <div class="actions" bind:this={actionsEl}>
      {#if selected.size && editable}
        <button class="v-btn-danger v-btn--sm" onclick={() => deleteSelected()}>{t('grid.deleteSelected', { count: selected.size })}</button>
      {/if}
      {#if filterCount && !isFolded('clear')}
        <button class="v-btn-ghost v-btn--sm" onclick={clearFilters}>{t('grid.clearFilters')}</button>
      {/if}
      {#if meta && !readOnly && !isView && !isFolded('insert')}
        <button class="v-btn-secondary v-btn--sm" onclick={() => (inserting = true)}>+ {t('insert.button')}</button>
      {/if}
      {#if !isFolded('filter')}
        <button class="v-btn-ghost v-btn--sm" aria-pressed={filtersOpen} aria-expanded={filtersOpen} onclick={() => (filtersOpen = !filtersOpen)}>
          {t('grid.filter')}{#if filterCount}<span class="v-badge">{filterCount}</span>{/if}
        </button>
      {/if}
      {#if !isFolded('density')}<DensityToggle />{/if}
      {#if !isFolded('refresh')}
        <button class="v-btn-ghost v-btn--sm" onclick={load} disabled={loading}>{t('common.refresh')}</button>
      {/if}
      {#if folded}
        <button
          class="v-btn-ghost v-btn--sm more"
          aria-haspopup="menu"
          aria-label={t('grid.moreActions')}
          title={t('grid.moreActions')}
          data-testid="bar-more"
          onclick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            openMenu({ clientX: r.right - 200, clientY: r.bottom + 4 }, moreMenu(), t('grid.moreActions'));
          }}
        >
          ⋯{#if filterCount && isFolded('filter')}<span class="v-badge">{filterCount}</span>{/if}
        </button>
      {/if}
    </div>
  </header>

  {#if error}
    <p class="v-banner v-banner--danger error" role="alert">{error}</p>
  {/if}

  <div class="body" class:loading>
    {#if meta}
      <DataGrid
        {columns}
        {rows}
        label={table}
        tableName={table}
        onfiltervalue={filterValue}
        {links}
        {labels}
        {db}
        {keyIcons}
        onkey={openKey}
        onfollow={follow}
        loadRelated={pkIndex === -1 ? undefined : loadRelated}
        onopenrelated={openRelated}
        ondeleterows={editable ? (r) => deleteSelected(r) : undefined}
        rowOffset={(page - 1) * meta.perPage}
        {sort}
        onsort={toggleSort}
        onsortdir={(col, dir) => (sort = { col, dir })}
        onopenfilter={() => (filtersOpen = true)}
        onstructure={(col) => {
          app.structureFocus = { type: 'column', name: col };
          app.view = 'structure';
        }}
        {filters}
        {filtersOpen}
        onfilter={onFilter}
        {editable}
        onedit={saveCell}
        selectable={editable}
        bind:selected
        emptyText={filterCount ? t('grid.noMatches') : t('grid.empty')}
      />
    {:else if loading}
      <p class="empty">{t('common.loading')}</p>
    {/if}
  </div>

  {#if meta && shownTotal > 0}
    <footer class="pager">
      <span class="per-page">
        <span id="per-page-lbl" class="per-page-lbl">{t('grid.perPage')}</span>
        <Select
          compact
          value={String(perPage)}
          label={t('grid.perPage')}
          options={[25, 50, 100, 250, 500].map((x) => ({ value: String(x), label: String(x) }))}
          onchange={(v) => {
            perPage = Number(v);
            go(1);
          }}
        />
      </span>
      <div class="nav">
        <button class="v-btn-ghost v-btn--sm" disabled={page <= 1 || loading} onclick={() => go(page - 1)}>{t('grid.prev')}</button>
        <span class="page-of">{t('grid.page', { page: n(page), pages: (total === null ? '~' : '') + n(pages) })}</span>
        <button class="v-btn-ghost v-btn--sm" disabled={(total !== null && page >= pages) || rows.length < perPage || loading} onclick={() => go(page + 1)}>{t('grid.next')}</button>
      </div>
    </footer>
  {/if}
</section>

{#if inserting && meta}
  <InsertRowDrawer {db} {table} columns={meta.columns} links={linkMap} onsave={insertRow} onclose={() => (inserting = false)} />
{/if}

<style>
  .view {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    height: 100%;
  }
  /* One line at every width: the meta shrinks (ellipsis), actions fold into "⋯". */
  .bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding: 6px 12px 6px 16px;
    border-bottom: 1px solid var(--sp-border);
    font-size: 13px;
  }
  .meta,
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .meta {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  .meta > * {
    flex-shrink: 0;
  }
  .meta .count {
    flex-shrink: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .actions {
    flex: none;
    white-space: nowrap;
  }
  .more {
    min-width: 28px;
    font-size: 15px;
    line-height: 1;
  }
  .count {
    font-variant-numeric: tabular-nums;
  }
  .dim {
    color: var(--sp-text-tertiary);
  }
  .error {
    margin: 12px 16px 0;
  }
  .body {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
  }
  .loading {
    opacity: 0.6;
  }
  .empty {
    padding: 32px 16px;
    color: var(--sp-text-tertiary);
    text-align: center;
    flex: 1;
  }
  .pager {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding: 4px 16px;
    border-top: 1px solid var(--sp-border);
    font-size: 12px;
    color: var(--sp-text-secondary);
  }
  .nav {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
  }
  .per-page {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    white-space: nowrap;
  }
  .per-page-lbl {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
