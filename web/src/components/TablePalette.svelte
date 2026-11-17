<script lang="ts">
  // Ctrl+P: jump to a table. Recent tables of this connection and database
  // first, then a fuzzy match over every table and view. Enter opens it,
  // Ctrl+Enter runs SELECT in a new SQL tab, Esc closes. Native <dialog>.
  import { tick } from 'svelte';
  import type { TableInfo } from '../lib/api';
  import { fuzzyFilter, type FuzzyMatch } from '../lib/fuzzy';
  import { relativeSeconds } from '../lib/grid';
  import { i18n, n, t } from '../lib/i18n.svelte';
  import { MENU_ICONS } from '../lib/menuIcons';
  import { recentKey, recentTables } from '../lib/recentTables';
  import { app, selectTable } from '../lib/state.svelte';
  import { tabs } from '../lib/tabs.svelte';
  import { toast } from '../lib/ui.svelte';

  const LIMIT = 60;
  let dlg: HTMLDialogElement;
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLUListElement | undefined = $state();
  let q = $state('');
  let active = $state(0);
  let now = $state(Date.now());

  export async function open() {
    if (!app.db || dlg.open) return;
    q = '';
    active = 0;
    now = Date.now();
    dlg.showModal();
    await tick();
    input?.focus();
  }

  interface Item {
    tb: TableInfo;
    match: FuzzyMatch | null;
    at?: number;
  }
  const recents = $derived.by(() => {
    void now;
    const a = app.session?.auth;
    if (!a || !app.db) return [];
    const known = new Map(app.tables.map((tb) => [tb.name, tb]));
    return recentTables(recentKey(a), app.db).flatMap((r) => (known.has(r.name) ? [{ tb: known.get(r.name)!, at: r.at }] : []));
  });
  const groups = $derived.by((): { recent: Item[]; rest: Item[] } => {
    const recentAt = new Map(recents.map((r) => [r.tb.name, r.at]));
    if (!q.trim()) {
      const recent = recents.slice(0, 5).map((r) => ({ tb: r.tb, match: null, at: r.at }));
      const shown = new Set(recent.map((r) => r.tb.name));
      return { recent, rest: app.tables.filter((tb) => !shown.has(tb.name)).slice(0, LIMIT).map((tb) => ({ tb, match: null })) };
    }
    const hits = fuzzyFilter(app.tables, q, (tb) => tb.name);
    const recent = hits.filter((h) => recentAt.has(h.item.name)).map((h) => ({ tb: h.item, match: h.match, at: recentAt.get(h.item.name) }));
    const rest = hits.filter((h) => !recentAt.has(h.item.name)).slice(0, LIMIT).map((h) => ({ tb: h.item, match: h.match }));
    return { recent, rest };
  });
  const flat = $derived([...groups.recent, ...groups.rest]);

  function choose(it: Item | undefined, inSql: boolean) {
    if (!it) return;
    dlg.close();
    if (inSql) {
      const quoted = '`' + it.tb.name.replace(/`/g, '``') + '`';
      if (!tabs.create({ sql: `SELECT * FROM ${quoted} LIMIT 100`, db: app.db, autorun: true })) toast(t('tabs.limit', { max: 30 }), 'error');
      else app.view = 'sql';
    } else selectTable(it.tb.name);
  }

  async function move(d: number) {
    if (!flat.length) return;
    active = (active + d + flat.length) % flat.length;
    await tick();
    list?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') move(1);
    else if (e.key === 'ArrowUp') move(-1);
    else if (e.key === 'Enter') choose(flat[active], e.ctrlKey || e.metaKey);
    else return;
    e.preventDefault();
  }

  function segments(name: string, match: FuzzyMatch | null) {
    const hits = new Set(match?.positions ?? []);
    const out: { text: string; hit: boolean }[] = [];
    for (let i = 0; i < name.length; i++) {
      const hit = hits.has(i);
      const last = out[out.length - 1];
      if (last && last.hit === hit) last.text += name[i];
      else out.push({ text: name[i], hit });
    }
    return out;
  }
  const meta = (it: Item) => {
    const what = it.tb.type === 'VIEW' ? t('palette.view') : t('grid.rows', { count: n(Number(it.tb.approxRows ?? 0)) });
    const ago = it.at ? relativeSeconds((it.at - now) / 1000, i18n.locale) : null;
    return ago ? `${ago} · ${what}` : what;
  };
</script>

{#snippet icon(name: string)}
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d={MENU_ICONS[name]} /></svg>
{/snippet}

{#snippet option(it: Item, i: number)}
  <!-- Keyboard is handled by the input (aria-activedescendant). -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <li
    id="pal-o-{i}"
    data-i={i}
    role="option"
    aria-selected={i === active}
    class:on={i === active}
    onpointerenter={() => (active = i)}
    onpointerdown={(e) => e.preventDefault()}
    onclick={(e) => choose(it, e.ctrlKey || e.metaKey)}
  >
    {@render icon(it.tb.type === 'VIEW' ? 'view' : 'table')}
    <span class="nm">{#each segments(it.tb.name, it.match) as seg}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</span>
    <span class="r">{meta(it)}</span>
  </li>
{/snippet}

<dialog bind:this={dlg} class="pal" aria-labelledby="pal-title" onclick={(e) => e.target === dlg && dlg.close()}>
  <h2 id="pal-title" class="sr-only">{t('palette.title')}</h2>
  <div class="q">
    {@render icon('search')}
    <input
      bind:this={input}
      bind:value={q}
      oninput={() => (active = 0)}
      onkeydown={key}
      role="combobox"
      aria-expanded="true"
      aria-controls="pal-list"
      aria-activedescendant={flat[active] ? `pal-o-${active}` : undefined}
      aria-label={t('palette.title')}
      placeholder={t('palette.placeholder')}
      autocomplete="off"
      spellcheck="false"
    />
    <kbd class="v-kbd">Esc</kbd>
  </div>
  <ul id="pal-list" role="listbox" aria-label={t('palette.title')} bind:this={list}>
    {#if groups.recent.length}
      <li class="grp" role="presentation">{t('palette.recent')}</li>
      {#each groups.recent as it, k (it.tb.name)}{@render option(it, k)}{/each}
    {/if}
    {#if groups.rest.length}
      <li class="grp" role="presentation">{t('palette.tables')}</li>
      {#each groups.rest as it, k (it.tb.name)}{@render option(it, groups.recent.length + k)}{/each}
    {/if}
    {#if !flat.length}
      <li class="none" role="presentation">{t('sidebar.noMatch')}</li>
    {/if}
  </ul>
  <div class="foot">
    <span><kbd class="v-kbd">↑</kbd><kbd class="v-kbd">↓</kbd> {t('palette.move')}</span>
    <span><kbd class="v-kbd">Enter</kbd> {t('palette.open')}</span>
    <span><kbd class="v-kbd">Ctrl</kbd><kbd class="v-kbd">Enter</kbd> {t('palette.inSql')}</span>
    <span class="end"><kbd class="v-kbd">Alt</kbd><kbd class="v-kbd">↑↓</kbd> {t('palette.prevNext')}</span>
  </div>
</dialog>

<style>
  .pal {
    width: min(600px, calc(100vw - 32px));
    max-height: min(560px, calc(100dvh - 120px));
    margin: 10vh auto auto;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--sp-border);
    border-radius: 12px;
    background: var(--surface-3);
    color: var(--sp-text-primary);
    box-shadow: var(--sp-shadow-lg);
  }
  .pal[open] {
    display: flex;
    flex-direction: column;
  }
  .pal::backdrop {
    background: color-mix(in srgb, #000 30%, transparent);
  }
  svg {
    flex: none;
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    color: var(--sp-text-secondary);
  }
  .q {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 52px;
    padding: 0 16px;
    border-bottom: 1px solid var(--sp-border);
  }
  .q svg {
    width: 18px;
    height: 18px;
  }
  .q input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    background: transparent;
    color: var(--sp-text-primary);
    font: inherit;
    font-size: 15px;
    outline: none;
  }
  .q input::placeholder {
    color: var(--sp-text-secondary);
  }
  ul {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 4px 6px 6px;
    overflow-y: auto;
    list-style: none;
  }
  .grp {
    padding: 10px 10px 4px;
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--sp-text-secondary);
  }
  li[role='option'] {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 36px;
    padding: 0 10px;
    border-radius: 8px;
    font-size: 13.5px;
    cursor: pointer;
  }
  li.on {
    background: var(--sp-bg-muted);
  }
  .nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  mark {
    padding: 0;
    color: inherit;
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 2px;
    background: none;
  }
  .r {
    flex: none;
    margin-left: auto;
    font-size: 12px;
    color: var(--sp-text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .none {
    padding: 16px 10px;
    color: var(--sp-text-secondary);
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    padding: 10px 16px;
    border-top: 1px solid var(--sp-border);
    background: var(--sp-bg-subtle);
    font-size: 12px;
    color: var(--sp-text-secondary);
  }
  .foot span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }
  .foot .end {
    margin-left: auto;
  }
  @media (max-width: 640px) {
    .foot .end {
      display: none;
    }
  }
</style>
