<script lang="ts">
  // Database overview (shown when a database is picked without a table):
  // summary, every table with sizes and dates, sortable, filterable, with
  // multi-select and actions on the selection.
  import { formatBytes } from '../../lib/bytes';
  import { dbApi, type Overview, type OverviewTable } from '../../lib/dbApi';
  import { dbMenuItems, openDialog, openMenu, tableMenuItems } from '../../lib/dbActions.svelte';
  import { dbTools, need, needText } from '../../lib/dbTools.svelte';
  import { i18n, n, t } from '../../lib/i18n.svelte';
  import { app, selectTable } from '../../lib/state.svelte';

  let { db }: { db: string } = $props();

  let ov = $state<Overview | null>(null);
  let error = $state('');
  let filter = $state('');
  let sort = $state<{ key: keyof OverviewTable | 'size'; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  let selected = $state<Set<string>>(new Set());

  $effect(() => {
    void dbTools.tick;
    const d = db;
    error = '';
    dbApi
      .overview(d)
      .then((r) => {
        if (d === db) ov = r;
        selected = new Set([...selected].filter((x) => r.tables.some((tb) => tb.name === x)));
      })
      .catch((e) => (error = e instanceof Error ? e.message : String(e)));
  });

  const size = (b: number | null) => (b === null ? '—' : formatBytes(b, i18n.locale));
  const date = (s: string | null) => (s ? new Date(s.replace(' ', 'T')).toLocaleString(i18n.locale, { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const sizeOf = (x: OverviewTable) => (x.dataBytes ?? 0) + (x.indexBytes ?? 0);
  const rows = $derived.by(() => {
    if (!ov) return [];
    const f = filter.trim().toLowerCase();
    const list = ov.tables.filter((x) => !f || x.name.toLowerCase().includes(f) || x.comment.toLowerCase().includes(f));
    const k = sort.key;
    return list.sort((a, b) => {
      const va = k === 'size' ? sizeOf(a) : a[k];
      const vb = k === 'size' ? sizeOf(b) : b[k];
      if (va === vb) return a.name.localeCompare(b.name);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))) * sort.dir;
    });
  });
  const allOn = $derived(rows.length > 0 && rows.every((x) => selected.has(x.name)));
  const sel = $derived([...selected]);
  const selTablesOnly = $derived(sel.every((s) => ov?.tables.find((x) => x.name === s)?.type !== 'VIEW'));

  function setSort(key: typeof sort.key) {
    sort = sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' || key === 'engine' || key === 'collation' ? 1 : -1 };
  }
  function toggle(name: string) {
    const s = new Set(selected);
    s.has(name) ? s.delete(name) : s.add(name);
    selected = s;
  }
  const cols: { key: typeof sort.key; label: string; num?: boolean; cls?: string }[] = [
    { key: 'name', label: 'overview.col.name' },
    { key: 'approxRows', label: 'overview.col.rows', num: true },
    { key: 'size', label: 'overview.col.size', num: true },
    { key: 'dataBytes', label: 'overview.col.data', num: true, cls: 'wide' },
    { key: 'indexBytes', label: 'overview.col.index', num: true, cls: 'wide' },
    { key: 'freeBytes', label: 'overview.col.free', num: true, cls: 'wide' },
    { key: 'engine', label: 'overview.col.engine', cls: 'mid' },
    { key: 'collation', label: 'overview.col.collation', cls: 'wide' },
    { key: 'created', label: 'overview.col.created', cls: 'wide' },
    { key: 'updated', label: 'overview.col.updated', cls: 'mid' },
    { key: 'comment', label: 'overview.col.comment', cls: 'mid' },
  ];
  const nWrite = $derived(need(['DROP']));
  const nExport = $derived(need(['SELECT'], false));
  const nCreate = $derived(need(['CREATE']));
  const nImport = $derived(need(['INSERT', 'CREATE']));
</script>

<section class="ov" aria-labelledby="ov-title">
  <header class="head">
    <div>
      <h1 id="ov-title" class="mono">{db}</h1>
      {#if ov}
        <p class="summary">
          {t('overview.summary', {
            tables: n(ov.counts.tables),
            views: n(ov.counts.views),
            routines: n(ov.counts.procedures + ov.counts.functions),
            triggers: n(ov.counts.triggers),
            events: n(ov.counts.events),
          })}
          · {size(ov.bytes)} · <span class="mono">{ov.charset} / {ov.collation}</span>
        </p>
      {/if}
    </div>
    <div class="v-toolbar__group">
      <button class="v-btn-secondary v-btn--sm" onclick={() => openDialog({ kind: 'createTable', db })} disabled={!nCreate.ok} title={needText(nCreate)}>+ {t('overview.newTable')}</button>
      <button class="v-btn-ghost v-btn--sm" onclick={() => openDialog({ kind: 'import', db })} disabled={!nImport.ok} title={needText(nImport)}>{t('dbmenu.import')}</button>
      <button class="v-btn-ghost v-btn--sm" onclick={() => openDialog({ kind: 'export', db, tables: [] })} disabled={!nExport.ok} title={needText(nExport)}>{t('overview.exportAll')}</button>
      <button class="v-btn-icon v-btn--sm" aria-haspopup="menu" aria-label={t('dbmenu.label', { db })} title={t('dbmenu.label', { db })} onclick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); openMenu({ clientX: r.left, clientY: r.bottom + 4 }, dbMenuItems(db), t('dbmenu.label', { db })); }}>⋯</button>
    </div>
  </header>

  {#if dbTools.caps?.managedBy}
    <p class="v-banner v-banner--warning" role="note"><strong>⚠ {t('managed.title', { app: dbTools.caps.managedBy === 'glpi' ? 'GLPI' : 'WordPress' })}</strong> {t(`managed.${dbTools.caps.managedBy}`)}</p>
  {/if}
  {#if error}<p class="v-banner v-banner--danger" role="alert">{error}</p>{/if}

  <div class="bar" role="toolbar" aria-label={t('overview.selection')}>
    <input class="v-input filter" type="search" bind:value={filter} placeholder={t('overview.filter', { count: n(ov?.tables.length ?? 0) })} aria-label={t('overview.filterLabel')} />
    <span class="dim" aria-live="polite">{sel.length ? t('overview.selected', { count: n(sel.length) }) : ''}</span>
    <span class="spacer"></span>
    <button class="v-btn-ghost v-btn--sm" disabled={!sel.length || !nExport.ok} onclick={() => openDialog({ kind: 'export', db, tables: sel })}>{t('overview.export')}</button>
    <button class="v-btn-ghost v-btn--sm danger" disabled={!sel.length || !selTablesOnly || !nWrite.ok} title={needText(nWrite)} onclick={() => openDialog({ kind: 'truncate', db, tables: sel })}>{t('overview.truncate')}</button>
    <button class="v-btn-ghost v-btn--sm danger" disabled={!sel.length || !nWrite.ok} title={needText(nWrite)} onclick={() => openDialog({ kind: 'drop', db, tables: sel })}>{t('overview.drop')}</button>
    <button class="v-btn-ghost v-btn--sm" disabled={!sel.length || !selTablesOnly} onclick={() => openDialog({ kind: 'maintenance', db, tables: sel })}>{t('overview.maintenance')}</button>
    <button class="v-btn-ghost v-btn--sm" disabled={!sel.length || !selTablesOnly || !need(['ALTER']).ok} title={needText(need(['ALTER']))} onclick={() => openDialog({ kind: 'bulk', db, tables: sel })}>{t('overview.engineCollation')}</button>
  </div>

  <div class="wrap">
    <table class="grid tbl" aria-label={t('overview.tablesOf', { db })} aria-rowcount={rows.length + 1}>
      <thead>
        <tr>
          <th class="sel"><input type="checkbox" checked={allOn} aria-label={t('overview.selectAll')} onchange={() => (selected = allOn ? new Set() : new Set(rows.map((x) => x.name)))} /></th>
          {#each cols as c}
            <th class="{c.cls ?? ''}" class:num={c.num} aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
              <button class="sort" onclick={() => setSort(c.key)}>{t(c.label)}{#if sort.key === c.key}<span aria-hidden="true">{sort.dir === 1 ? ' ↑' : ' ↓'}</span>{/if}</button>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as x (x.name)}
          <tr class:on={selected.has(x.name)} oncontextmenu={(e) => openMenu(e, tableMenuItems(db, x.name, x.type === 'VIEW'), x.name)}>
            <td class="sel"><input type="checkbox" checked={selected.has(x.name)} onchange={() => toggle(x.name)} aria-label={t('overview.selectTable', { table: x.name })} /></td>
            <td><button class="link mono" onclick={() => selectTable(x.name)}>{x.name}</button>{#if x.type === 'VIEW'} <span class="v-badge">{t('overview.view')}</span>{/if}</td>
            <td class="num">{x.type === 'VIEW' ? '—' : `~${n(x.approxRows ?? 0)}`}</td>
            <td class="num">{x.type === 'VIEW' ? '—' : size(sizeOf(x))}</td>
            <td class="num wide">{size(x.dataBytes)}</td>
            <td class="num wide">{size(x.indexBytes)}</td>
            <td class="num wide">{x.freeBytes ? size(x.freeBytes) : '—'}</td>
            <td class="mid">{x.engine ?? '—'}</td>
            <td class="wide mono small">{x.collation ?? '—'}</td>
            <td class="wide small">{date(x.created)}</td>
            <td class="mid small">{date(x.updated)}</td>
            <td class="mid comment" title={x.comment}>{x.comment}</td>
          </tr>
        {:else}
          {#if ov}<tr><td colspan={cols.length + 1} class="empty">{filter ? t('sidebar.noMatch') : t('overview.empty')}</td></tr>{/if}
        {/each}
      </tbody>
    </table>
  </div>
  {#if !app.tables.length && ov && !ov.tables.length}
    <p class="hint">{t('overview.emptyHelp')}</p>
  {/if}
</section>

<style>
  .ov {
    height: 100%;
    overflow: auto;
    padding: 16px 20px 40px;
    display: grid;
    gap: 12px;
    align-content: start;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  h1 {
    margin: 0;
    font-size: 18px;
  }
  .summary {
    margin: 2px 0 0;
    font-size: 12.5px;
    color: var(--sp-text-secondary);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .filter {
    width: 240px;
    max-width: 100%;
    padding: 5px 10px;
    font-size: 13px;
  }
  .spacer {
    flex: 1;
  }
  .dim {
    color: var(--sp-text-tertiary);
    font-size: 12.5px;
  }
  .danger {
    color: var(--sp-danger);
  }
  .wrap {
    overflow-x: auto;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
  }
  .tbl {
    width: 100%;
    font-size: 12.5px;
  }
  .tbl th {
    position: sticky;
    top: 0;
    white-space: nowrap;
  }
  .sort {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .num {
    text-align: right;
    white-space: nowrap;
  }
  .sel {
    width: 28px;
  }
  tr.on td {
    background: var(--sp-bg-subtle);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--sp-text-primary);
    cursor: pointer;
    font-size: inherit;
    text-align: left;
  }
  .link:hover {
    text-decoration: underline;
  }
  .small {
    font-size: 11.5px;
    white-space: nowrap;
  }
  .comment {
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--sp-text-secondary);
  }
  .empty {
    padding: 20px;
    text-align: center;
    color: var(--sp-text-tertiary);
  }
  .hint {
    margin: 0;
    font-size: 12.5px;
    color: var(--sp-text-tertiary);
  }
  @media (max-width: 1100px) {
    .wide {
      display: none;
    }
  }
  @media (max-width: 640px) {
    .mid {
      display: none;
    }
    .ov {
      padding: 12px;
    }
  }
</style>
