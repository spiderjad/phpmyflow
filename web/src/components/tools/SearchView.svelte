<script lang="ts">
  // Search text across tables, databases or the whole server (Ctrl+Shift+F).
  import { n, t } from '../../lib/i18n.svelte';
  import { cancelSearch, runSearch, search, searchSql, type SearchHit } from '../../lib/search.svelte';
  import { app, openFiltered, selectDb } from '../../lib/state.svelte';
  import { tabs } from '../../lib/tabs.svelte';
  import type { SearchMode } from '../../lib/toolsApi';
  import { toast } from '../../lib/ui.svelte';
  import Segmented from '../ui/Segmented.svelte';

  const userDbs = $derived(app.databases.filter((d) => !d.system));
  const tables = $derived(app.tables.filter((x) => x.type !== 'VIEW'));
  const modes: SearchMode[] = ['contains', 'exact', 'starts', 'regex'];
  const canRun = $derived(!!search.q.trim() && (search.scope !== 'dbs' || search.dbs.length > 0) && (!search.someTables || search.scope !== 'db' || search.tables.length > 0));
  const total = $derived(search.hits.reduce((s, h) => s + h.matches.reduce((a, m) => a + m.count, 0), 0));

  function toggle(list: string[], v: string): string[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }
  async function openTable(h: SearchHit, column: string) {
    const last = search.last!;
    const filter = last.mode === 'exact' ? `=${last.q}` : last.q;
    if (app.db !== h.db) await selectDb(h.db);
    openFiltered(h.table, { [column]: filter });
  }
  function openQuery(h: SearchHit, column: string) {
    if (!tabs.create({ sql: searchSql(h, column, search.last!), db: h.db, autorun: true })) {
      toast(t('tabs.limit', { max: 30 }), 'error');
      return;
    }
    app.view = 'sql';
  }
  const filterable = $derived(!!search.last && !search.last.caseSensitive && (search.last.mode === 'contains' || search.last.mode === 'exact'));
</script>

<section class="sv" aria-labelledby="sv-title">
  <h1 id="sv-title">{t('search.title')}</h1>
  <form
    class="form"
    onsubmit={(e) => {
      e.preventDefault();
      if (canRun) void runSearch(app.db);
    }}
  >
    <div class="qrow">
      <input class="v-input q" type="search" bind:value={search.q} placeholder={t('search.placeholder')} aria-label={t('search.text')} maxlength="500" />
      {#if search.running}
        <button type="button" class="v-btn-secondary" onclick={cancelSearch}>{t('common.cancel')}</button>
      {:else}
        <button type="submit" class="v-btn-primary" disabled={!canRun}>{t('search.go')}</button>
      {/if}
    </div>
    <div class="opts">
      <div class="field">
        <span>{t('search.mode')}</span>
        <Segmented options={modes.map((m) => ({ value: m, label: t(`search.m.${m}`) }))} value={search.mode} label={t('search.mode')} onchange={(v) => (search.mode = v)} />
      </div>
      <label class="inline"><input type="checkbox" bind:checked={search.caseSensitive} /> {t('search.case')}</label>
      <label class="inline"><input type="checkbox" bind:checked={search.allColumns} /> {t('search.allColumns')}</label>
      <label class="inline tl">{t('search.timeout')} <input class="v-input" type="number" min="1" max="120" bind:value={search.timeoutSec} /> s</label>
    </div>
    <fieldset class="scope">
      <legend>{t('search.scope')}</legend>
      <label class="inline"><input type="radio" bind:group={search.scope} value="db" /> {t('search.scopeDb', { db: app.db })}</label>
      <label class="inline"><input type="radio" bind:group={search.scope} value="dbs" /> {t('search.scopeDbs')}</label>
      <label class="inline"><input type="radio" bind:group={search.scope} value="server" /> {t('search.scopeServer')}</label>
    </fieldset>
    {#if search.scope === 'dbs'}
      <div class="pick" role="group" aria-label={t('search.scopeDbs')}>
        {#each userDbs as d}<label class="inline"><input type="checkbox" checked={search.dbs.includes(d.name)} onchange={() => (search.dbs = toggle(search.dbs, d.name))} /> <span class="mono">{d.name}</span></label>{/each}
      </div>
    {:else if search.scope === 'db'}
      <label class="inline"><input type="checkbox" bind:checked={search.someTables} /> {t('search.someTables')}</label>
      {#if search.someTables}
        <div class="pick" role="group" aria-label={t('search.someTables')}>
          {#each tables as x}<label class="inline"><input type="checkbox" checked={search.tables.includes(x.name)} onchange={() => (search.tables = toggle(search.tables, x.name))} /> <span class="mono">{x.name}</span></label>{/each}
        </div>
      {/if}
    {/if}
  </form>

  {#if search.running || search.scanned}
    <div class="status" aria-live="polite">
      <div class="bar" role="progressbar" aria-label={t('search.title')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(search.progress * 100)}><span style:width="{search.progress * 100}%"></span></div>
      <p>
        {#if search.running}{t('search.scanning', { table: search.current, n: search.scanned + 1, of: search.total })}
        {:else}{t('search.summary', { rows: n(total), tables: search.hits.length, scanned: search.scanned })}{/if}
      </p>
    </div>
  {/if}
  {#if search.error}<p class="v-banner v-banner--danger" role="alert">{search.error}</p>{/if}

  {#if search.hits.length}
    <div class="results">
      {#each search.hits as h (h.db + '.' + h.table)}
        <article class="hit">
          <h2 class="mono">{h.db}.{h.table}</h2>
          <ul>
            {#each h.matches as m}
              <li>
                <span class="mono col">{m.column}</span>
                <span class="count">{t('search.matches', { count: n(m.count) })}</span>
                {#if filterable}<button class="v-btn-ghost v-btn--sm" onclick={() => openTable(h, m.column)}>{t('search.openFiltered')}</button>{/if}
                <button class="v-btn-ghost v-btn--sm" onclick={() => openQuery(h, m.column)}>{t('search.openQuery')}</button>
              </li>
            {/each}
          </ul>
        </article>
      {/each}
    </div>
  {:else if !search.running && search.scanned && !search.error}
    <p class="hint">{t('search.none')}</p>
  {/if}
  {#if search.problems.length}
    <details class="problems">
      <summary>{t('search.problems', { count: n(search.problems.length) })}</summary>
      <ul>{#each search.problems as p}<li><span class="mono">{p.db}.{p.table}</span> — {p.timedOut ? t('search.timedOut') : p.error}</li>{/each}</ul>
    </details>
  {/if}
</section>

<style>
  .sv {
    height: 100%;
    overflow: auto;
    padding: 16px 20px 40px;
    display: grid;
    gap: 14px;
    align-content: start;
    max-width: 1100px;
  }
  h1 {
    margin: 0;
    font-size: 18px;
  }
  .form {
    display: grid;
    gap: 10px;
  }
  .qrow {
    display: flex;
    gap: 8px;
  }
  .q {
    flex: 1;
    font-size: 14px;
  }
  .opts {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 18px;
    align-items: flex-end;
  }
  .field {
    display: grid;
    gap: 4px;
  }
  .field > span,
  legend {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--sp-text-secondary);
  }
  .inline {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 13px;
  }
  .tl input {
    width: 70px;
  }
  .scope {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .scope legend {
    width: 100%;
    margin-bottom: 4px;
  }
  .pick {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    max-height: 140px;
    overflow: auto;
    padding: 6px 8px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
  }
  .status {
    display: grid;
    gap: 4px;
  }
  .status p {
    margin: 0;
    font-size: 12.5px;
    color: var(--sp-text-secondary);
  }
  .bar {
    height: 4px;
    border-radius: 2px;
    background: var(--sp-bg-subtle);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--sp-text-primary);
  }
  .results {
    display: grid;
    gap: 10px;
  }
  .hit {
    padding: 10px 12px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
  }
  .hit h2 {
    margin: 0 0 6px;
    font-size: 13.5px;
  }
  .hit ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 4px;
  }
  .hit li {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    font-size: 13px;
  }
  .col {
    min-width: 140px;
  }
  .count {
    color: var(--sp-text-secondary);
  }
  .hint {
    margin: 0;
    color: var(--sp-text-tertiary);
    font-size: 13px;
  }
  .problems {
    font-size: 12.5px;
    color: var(--sp-text-secondary);
  }
  @media (max-width: 560px) {
    .sv {
      padding: 12px;
    }
  }
</style>
