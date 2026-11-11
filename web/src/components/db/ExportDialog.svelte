<script lang="ts">
  import { untrack } from 'svelte';
  // Export a database, some tables or one table: SQL (structure/data,
  // options), CSV, JSON or XLSX (ZIP when several tables). Runs as a job.
  import { defaultExport, runExport, type ExportOptions } from '../../lib/exporter';
  import { closeDialog } from '../../lib/dbActions.svelte';
  import { n, t } from '../../lib/i18n.svelte';
  import { startJob } from '../../lib/jobs.svelte';
  import { app } from '../../lib/state.svelte';
  import Modal from './Modal.svelte';

  let { db, tables = [] }: { db: string; tables?: string[] } = $props();

  let o = $state<ExportOptions>(untrack(() => defaultExport(db, [...tables])));
  let scope = $state<'all' | 'some'>(untrack(() => (tables.length ? 'some' : 'all')));
  let picked = $state<Set<string>>(untrack(() => new Set(tables)));
  let filter = $state('');
  let error = $state('');

  const all = $derived(app.db === db ? app.tables : []);
  const shown = $derived(all.filter((x) => !filter.trim() || x.name.toLowerCase().includes(filter.trim().toLowerCase())));
  const isSql = $derived(o.format === 'sql');

  function toggle(name: string) {
    const s = new Set(picked);
    s.has(name) ? s.delete(name) : s.add(name);
    picked = s;
  }

  // gzip is done by the server (zlib); offered only when it has it.
  const canGzip = $derived(!!app.session?.gzip);

  function go() {
    error = '';
    const opts: ExportOptions = { ...o, tables: scope === 'all' ? [] : [...picked] };
    if (!isSql || !canGzip) opts.gzip = false;
    // Everything from props before closing: the dialog unmounts.
    const what = opts.tables.length === 1 ? `${opts.db}.${opts.tables[0]}` : opts.tables.length ? t('export.jobSome', { db: opts.db, count: n(opts.tables.length) }) : opts.db;
    closeDialog();
    const job = startJob('export', t('export.jobTitle', { name: what }));
    void runExport(opts, job);
  }
</script>

<Modal title={t('export.title', { db })} onclose={closeDialog} width={600}>
  <fieldset>
    <legend>{t('export.scope')}</legend>
    <label class="inline"><input type="radio" bind:group={scope} value="all" /> {t('export.scopeAll', { count: n(all.length) })}</label>
    <label class="inline"><input type="radio" bind:group={scope} value="some" /> {t('export.scopeSome', { count: n(picked.size) })}</label>
  </fieldset>
  {#if scope === 'some'}
    <div class="pick">
      <input class="v-input" type="search" bind:value={filter} placeholder={t('export.filter')} aria-label={t('export.filter')} />
      <div class="list" role="group" aria-label={t('export.scopeSome', { count: n(picked.size) })}>
        {#each shown as x (x.name)}
          <label class="inline"><input type="checkbox" checked={picked.has(x.name)} onchange={() => toggle(x.name)} /> <span class="mono">{x.name}</span>{#if x.type === 'VIEW'}<span class="v-badge">{t('overview.view')}</span>{/if}</label>
        {/each}
      </div>
      <div class="acts">
        <button class="v-btn-ghost v-btn--sm" onclick={() => (picked = new Set(all.map((x) => x.name)))}>{t('export.selectAll')}</button>
        <button class="v-btn-ghost v-btn--sm" onclick={() => (picked = new Set())}>{t('export.selectNone')}</button>
      </div>
    </div>
  {/if}

  <fieldset>
    <legend>{t('export.format')}</legend>
    <div class="formats">
      {#each ['sql', 'csv', 'json', 'xlsx'] as const as f}
        <label class="inline"><input type="radio" bind:group={o.format} value={f} /> {t(`export.fmt.${f}`)}</label>
      {/each}
    </div>
    {#if !isSql && (scope === 'all' || picked.size !== 1)}<p class="hint">{t('export.zipNote')}</p>{/if}
  </fieldset>

  {#if isSql}
    <fieldset>
      <legend>{t('export.sqlOptions')}</legend>
      <div class="checks">
        <label><input type="checkbox" bind:checked={o.structure} /> {t('export.structure')}</label>
        <label><input type="checkbox" bind:checked={o.data} /> {t('export.data')}</label>
        <label><input type="checkbox" bind:checked={o.dropTable} /> {t('export.dropTable')}</label>
        <label class="wide"><input type="checkbox" bind:checked={o.createDb} /> {t('export.createDbPortable')}</label>
        <label><input type="checkbox" bind:checked={o.noFkChecks} /> {t('export.noFkChecks')}</label>
        <label title={canGzip ? '' : t('export.noGzip')}><input type="checkbox" bind:checked={o.gzip} disabled={!canGzip} /> {t('export.gzip')}</label>
      </div>
      <div class="checks">
        <label><input type="checkbox" bind:checked={o.routines} disabled={!o.structure} /> {t('export.routines')}</label>
        <label><input type="checkbox" bind:checked={o.triggers} disabled={!o.structure} /> {t('export.triggers')}</label>
        <label><input type="checkbox" bind:checked={o.events} disabled={!o.structure} /> {t('export.events')}</label>
      </div>
      <p class="hint">{t('export.objectsNote')}</p>
      <label class="field small">
        <span>{t('export.insertRows')}</span>
        <input class="v-input" type="number" min="1" max="5000" bind:value={o.insertRows} />
      </label>
    </fieldset>
  {/if}

  <p class="hint">{t('export.stepsNote')}</p>
  {#if error}<p class="v-banner v-banner--danger" role="alert">{error}</p>{/if}
  {#snippet footer()}
    <button class="v-btn-secondary" onclick={closeDialog}>{t('common.cancel')}</button>
    <button class="v-btn-primary" onclick={go} disabled={(scope === 'some' && !picked.size) || (isSql && !o.structure && !o.data)}>{t('export.go')}</button>
  {/snippet}
</Modal>

<style>
  .pick {
    display: grid;
    gap: 6px;
  }
  .list {
    max-height: 180px;
    overflow: auto;
    display: grid;
    gap: 2px;
    padding: 6px 8px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
    font-size: 12.5px;
  }
  .acts {
    display: flex;
    gap: 6px;
  }
  .formats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
  }
  .checks {
    grid-template-columns: 1fr 1fr;
  }
  .checks .wide {
    grid-column: 1 / -1;
  }
  .small input {
    max-width: 140px;
  }
  @media (max-width: 520px) {
    .checks {
      grid-template-columns: 1fr;
    }
  }
</style>
