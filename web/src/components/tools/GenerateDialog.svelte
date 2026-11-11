<script lang="ts">
  // Test data for one table: N rows (1-100,000), a generator per column
  // (guessed from type and name, editable), foreign keys from existing ids,
  // UNIQUE kept unique; 10-row preview, then batches of 500 as a job.
  // Blocked on databases managed by an app (GLPI, WordPress).
  import { onMount, untrack } from 'svelte';
  import { closeDialog } from '../../lib/dbActions.svelte';
  import { n, t } from '../../lib/i18n.svelte';
  import { startJob } from '../../lib/jobs.svelte';
  import { app, refreshSchema } from '../../lib/state.svelte';
  import { runGenerate } from '../../lib/toolJobs';
  import { strategiesFor, toolsApi, type GenColumn } from '../../lib/toolsApi';
  import Modal from '../db/Modal.svelte';
  import ResultTable from '../objects/ResultTable.svelte';
  import Select from '../ui/Select.svelte';

  let { db, table = '' }: { db: string; table?: string } = $props();

  let tbl = $state(untrack(() => table || app.table || app.tables.find((x) => x.type !== 'VIEW')?.name || ''));
  let columns = $state<GenColumn[]>([]);
  let managed = $state<'glpi' | 'wordpress' | null>(null);
  let count = $state(500);
  let preview = $state<{ columns: string[]; rows: unknown[][] } | null>(null);
  let error = $state('');
  let loading = $state(false);
  const seed = Math.floor(Math.random() * 2 ** 30);
  const token = Math.random().toString(36).slice(2, 6);
  const tables = $derived(app.tables.filter((x) => x.type !== 'VIEW'));

  async function load() {
    error = '';
    preview = null;
    loading = true;
    try {
      const p = await toolsApi.genPlan(db, tbl);
      columns = p.columns.map((c) => ({ ...c, options: { ...(c.options ?? {}) } }));
      managed = p.managedBy;
      await doPreview();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }
  onMount(load);

  async function doPreview() {
    error = '';
    try {
      preview = await toolsApi.genPreview(db, tbl, $state.snapshot(columns) as GenColumn[], seed, token);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      preview = null;
    }
  }
  function go() {
    const [d, tb, cols, total] = [db, tbl, $state.snapshot(columns) as GenColumn[], Math.max(1, Math.min(100000, Math.floor(count)))];
    closeDialog();
    const job = startJob('generate', t('gen.jobTitle', { count: n(total), table: tb }));
    void runGenerate(d, tb, cols, total, seed, token, job, () => void refreshSchema());
  }
  const label = (s: string) => t(`gen.s.${s}`);
  const numeric = (c: GenColumn) => ['int', 'amount'].includes(c.strategy);
  const dated = (c: GenColumn) => ['date', 'datetime'].includes(c.strategy);
</script>

<Modal title={t('gen.title', { db })} onclose={closeDialog} width={840}>
  {#if managed}
    <p class="v-banner v-banner--danger" role="alert"><strong>{t('managed.title', { app: managed === 'glpi' ? 'GLPI' : 'WordPress' })}</strong> {t('gen.blocked')}</p>
  {/if}
  <div class="row">
    <div class="field">
      <span>{t('objects.table')}</span>
      <Select value={tbl} label={t('objects.table')} mono options={tables.map((x) => ({ value: x.name, label: x.name }))} onchange={(v) => ((tbl = v), load())} />
    </div>
    <label class="field">
      <span>{t('gen.count')}</span>
      <input class="v-input" type="number" min="1" max="100000" bind:value={count} aria-invalid={count < 1 || count > 100000} />
    </label>
  </div>

  {#if columns.length}
    <div class="grid-wrap">
      <table class="grid cols" aria-label={t('gen.columns')}>
        <thead><tr><th>{t('editor.idx.name')}</th><th>{t('objects.type')}</th><th>{t('gen.generator')}</th><th>{t('gen.options')}</th></tr></thead>
        <tbody>
          {#each columns as c, i (c.name)}
            <tr>
              <td class="mono">{c.name}{#if c.unique} <span class="v-badge">UNIQUE</span>{/if}{#if !c.nullable} <span class="v-badge">NOT NULL</span>{/if}</td>
              <td class="mono dim">{c.columnType}</td>
              <td>
                <Select compact value={c.strategy} label={t('gen.generatorFor', { name: c.name })} options={strategiesFor(c).map((s) => ({ value: s, label: s === 'fk' && c.fk ? `${label('fk')} → ${c.fk.table}.${c.fk.column}` : label(s), disabled: s === 'null' && !c.nullable ? t('gen.notNull') : null }))} onchange={(v) => ((columns[i] = { ...c, strategy: v }), doPreview())} />
              </td>
              <td class="opts">
                {#if numeric(c)}
                  <label><span class="sr-only">{t('gen.min', { name: c.name })}</span><input class="v-input" type="number" placeholder={t('gen.minPh')} value={c.options.min ?? ''} onchange={(e) => ((columns[i] = { ...c, options: { ...c.options, min: (e.currentTarget as HTMLInputElement).value === '' ? undefined : Number((e.currentTarget as HTMLInputElement).value) } }), doPreview())} /></label>
                  <label><span class="sr-only">{t('gen.max', { name: c.name })}</span><input class="v-input" type="number" placeholder={t('gen.maxPh')} value={c.options.max ?? ''} onchange={(e) => ((columns[i] = { ...c, options: { ...c.options, max: (e.currentTarget as HTMLInputElement).value === '' ? undefined : Number((e.currentTarget as HTMLInputElement).value) } }), doPreview())} /></label>
                {:else if dated(c)}
                  <label><span class="sr-only">{t('gen.from', { name: c.name })}</span><input class="v-input" type="date" value={c.options.from ?? ''} onchange={(e) => ((columns[i] = { ...c, options: { ...c.options, from: (e.currentTarget as HTMLInputElement).value || undefined } }), doPreview())} /></label>
                  <label><span class="sr-only">{t('gen.to', { name: c.name })}</span><input class="v-input" type="date" value={c.options.to ?? ''} onchange={(e) => ((columns[i] = { ...c, options: { ...c.options, to: (e.currentTarget as HTMLInputElement).value || undefined } }), doPreview())} /></label>
                {/if}
                {#if c.nullable && c.strategy !== 'null' && !c.unique}
                  <label class="nullpct" title={t('gen.nullPct')}><input class="v-input" type="number" min="0" max="100" value={c.options.nullPct ?? 10} aria-label={t('gen.nullPctFor', { name: c.name })} onchange={(e) => ((columns[i] = { ...c, options: { ...c.options, nullPct: Number((e.currentTarget as HTMLInputElement).value) } }), doPreview())} /> % NULL</label>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="hint">{t('gen.rules')}</p>
  {:else if loading}
    <p class="hint">{t('common.loading')}</p>
  {/if}

  {#if preview}
    <div class="field">
      <span>{t('gen.preview')}</span>
      <ResultTable columns={preview.columns} rows={preview.rows} caption={t('gen.preview')} />
    </div>
  {/if}
  {#if error}<p class="v-banner v-banner--danger" role="alert">{error}</p>{/if}
  {#snippet footer()}
    <button class="v-btn-ghost" onclick={doPreview} disabled={!columns.length}>{t('gen.refresh')}</button>
    <span class="spacer"></span>
    <button class="v-btn-secondary" onclick={closeDialog}>{t('common.cancel')}</button>
    <button class="v-btn-primary" onclick={go} disabled={!!managed || !preview || count < 1 || count > 100000 || app.session?.readOnly} title={managed ? t('gen.blocked') : ''}>{t('gen.insert', { count: n(Math.max(0, Math.floor(count))) })}</button>
  {/snippet}
</Modal>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: flex-end;
  }
  .field {
    display: grid;
    gap: 4px;
  }
  .field > span {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--sp-text-secondary);
  }
  .field input[type='number'] {
    max-width: 140px;
  }
  .grid-wrap {
    max-height: 300px;
    overflow: auto;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
  }
  .cols {
    width: 100%;
    font-size: 12.5px;
  }
  .cols th {
    position: sticky;
    top: 0;
  }
  .cols td {
    vertical-align: middle;
  }
  .dim {
    color: var(--sp-text-tertiary);
    font-size: 11.5px;
  }
  .opts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .opts input {
    width: 110px;
    height: 28px;
    font-size: 12px;
  }
  .nullpct {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    font-size: 11.5px;
    color: var(--sp-text-secondary);
  }
  .nullpct input {
    width: 60px;
  }
  .spacer {
    flex: 1;
  }
</style>
