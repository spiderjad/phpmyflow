<script lang="ts">
  import { groupByDay, searchHistory, type DayGroup, type HistoryEntry } from '../lib/history';
  import { i18n, n, t } from '../lib/i18n.svelte';

  let {
    entries,
    onpick,
    onremove,
    onclear,
    onclose,
  }: {
    entries: HistoryEntry[];
    /** newTab: Alt+click opens the query in a new tab. */
    onpick: (e: HistoryEntry, newTab: boolean) => void;
    onremove: (id: string) => void;
    onclear: () => void;
    onclose: () => void;
  } = $props();

  let query = $state('');
  let search: HTMLInputElement | undefined = $state();
  const groups = $derived(groupByDay(searchHistory(entries, query), Date.now()));

  $effect(() => {
    search?.focus();
  });

  function dayLabel(g: DayGroup): string {
    if (g.kind === 'today') return t('history.today');
    if (g.kind === 'yesterday') return t('history.yesterday');
    if (g.kind === 'older') return t('history.older');
    const [y, m, d] = g.key.split('-').map(Number);
    return new Intl.DateTimeFormat(i18n.locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d));
  }

  const time = (ms: number) => new Intl.DateTimeFormat(i18n.locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(ms));

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="panel" role="dialog" aria-label={t('sql.history')} tabindex="-1" onkeydown={onKey}>
  <div class="head">
    <input class="v-input search" type="search" bind:this={search} bind:value={query} placeholder={t('history.search')} aria-label={t('history.search')} />
    <button class="v-btn-ghost v-btn--sm" onclick={onclear} disabled={!entries.length}>{t('history.clear')}</button>
  </div>
  <div class="list">
    {#if !groups.length}
      <p class="empty">{query ? t('history.noMatch') : t('history.empty')}</p>
    {/if}
    {#each groups as g (g.key)}
      <section>
        <h3 class="day">{dayLabel(g)} <span class="dim">· {n(g.entries.length)}</span></h3>
        <ul>
          {#each g.entries as e (e.id)}
            <li class="item">
              <button class="pick" onclick={(ev) => onpick(e, ev.altKey)} title={e.sql + '\n\n' + t('history.altHint')}>
                <span class="meta">
                  {#if e.at}<span class="time">{time(e.at)}</span>{/if}
                  {#if e.db}<span class="v-badge db">{e.db}</span>{/if}
                  {#if !e.ok}<span class="v-badge v-badge--danger">{t('history.failed')}</span>{/if}
                  {#if e.count > 1}<span class="dim">×{n(e.count)}</span>{/if}
                  {#if e.ok && e.rows != null}<span class="dim">{t('sql.resultRows', { count: n(e.rows) })}</span>{/if}
                  {#if e.ms != null}<span class="dim">{t('common.ms', { ms: e.ms })}</span>{/if}
                </span>
                <span class="sql">{e.sql}</span>
              </button>
              <button class="v-btn-icon v-btn--sm remove" onclick={() => onremove(e.id)} aria-label={t('history.remove')} title={t('history.remove')}>✕</button>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
</div>

<style>
  .panel {
    position: absolute;
    z-index: 20;
    top: calc(100% + 4px);
    left: 0;
    width: min(680px, calc(100vw - 32px));
    max-height: min(520px, 70vh);
    display: flex;
    flex-direction: column;
    background: var(--sp-bg);
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
    box-shadow: var(--sp-shadow-md);
  }
  .panel:focus {
    outline: none;
  }
  .head {
    display: flex;
    gap: 8px;
    padding: 8px;
    border-bottom: 1px solid var(--sp-border);
  }
  .search {
    padding: 6px 10px;
    font-size: 13px;
  }
  .list {
    overflow: auto;
    padding: 4px 4px 8px;
  }
  .day {
    position: sticky;
    top: 0;
    margin: 0;
    padding: 8px 8px 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--sp-text-secondary);
    background: var(--sp-bg);
  }
  .day::first-letter {
    text-transform: uppercase;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .item {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    border-radius: var(--sp-radius);
  }
  .item:hover {
    background: var(--sp-bg-muted);
  }
  .pick {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
    padding: 6px 8px;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
    border-radius: var(--sp-radius);
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
  }
  .time {
    font-variant-numeric: tabular-nums;
    color: var(--sp-text-secondary);
  }
  .db {
    font-family: var(--sp-font-mono);
  }
  .sql {
    font-family: var(--sp-font-mono);
    font-size: 12.5px;
    color: var(--sp-text-primary);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .remove {
    margin-top: 4px;
    opacity: 0;
  }
  .item:hover .remove,
  .remove:focus-visible {
    opacity: 1;
  }
  .dim {
    color: var(--sp-text-tertiary);
  }
  .empty {
    padding: 16px;
    color: var(--sp-text-tertiary);
    text-align: center;
  }
</style>
