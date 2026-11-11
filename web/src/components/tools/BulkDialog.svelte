<script lang="ts">
  // Bulk table editor: engine, charset/collation (optionally converting the
  // data), comment, or move to another database, for several tables. Review
  // shows every statement and a time estimate; applies as a job.
  import { onMount, untrack } from 'svelte';
  import { editorApi } from '../../lib/api';
  import { dbApi, type Charsets } from '../../lib/dbApi';
  import { closeDialog, managedOk, reloadAll } from '../../lib/dbActions.svelte';
  import { n, t } from '../../lib/i18n.svelte';
  import { startJob } from '../../lib/jobs.svelte';
  import { app, refreshSchema } from '../../lib/state.svelte';
  import { runBulk, sizeText } from '../../lib/toolJobs';
  import { toolsApi, type BulkChanges } from '../../lib/toolsApi';
  import Modal from '../db/Modal.svelte';
  import Select from '../ui/Select.svelte';

  let { db, tables = [] }: { db: string; tables?: string[] } = $props();

  const all = $derived(app.db === db ? app.tables.filter((x) => x.type !== 'VIEW') : []);
  let picked = $state<Set<string>>(untrack(() => new Set(tables)));
  let engines = $state<string[]>([]);
  let charsets = $state<Charsets | null>(null);
  let doEngine = $state(false);
  let engine = $state('InnoDB');
  let doColl = $state(false);
  let collation = $state('utf8mb4_unicode_ci');
  let convert = $state(true);
  let doComment = $state(false);
  let comment = $state('');
  let doMove = $state(false);
  let moveTo = $state('');
  let plan = $state<Awaited<ReturnType<typeof toolsApi.bulkPlan>> | null>(null);
  let error = $state('');

  onMount(async () => {
    try {
      charsets = await dbApi.charsets();
      const info = await editorApi.info(db, all[0]?.name ?? '');
      engines = info.engines;
    } catch {
      engines = ['InnoDB', 'MyISAM', 'Aria', 'MEMORY', 'ARCHIVE'];
    }
  });

  const collations = $derived((charsets?.charsets ?? []).flatMap((c) => c.collations.map((x) => ({ value: x, label: x }))));
  const otherDbs = $derived(app.databases.filter((d) => !d.system && d.name !== db));
  const changes = $derived<BulkChanges>({
    engine: doEngine ? engine : null,
    collation: doColl ? collation : null,
    convert: doColl && convert,
    comment: doComment ? comment : null,
    moveTo: doMove ? moveTo || null : null,
  });
  const nothing = $derived(!doEngine && !doColl && !doComment && !(doMove && moveTo));
  const totalSeconds = $derived(plan ? plan.tables.reduce((s, x) => s + x.seconds, 0) : 0);

  async function review() {
    error = '';
    try {
      plan = await toolsApi.bulkPlan(db, [...picked], changes);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  async function apply() {
    const [d, list, ch] = [db, plan!.tables.map((x) => x.table), $state.snapshot(changes)];
    if (!(await managedOk(d))) return;
    closeDialog();
    const job = startJob('bulk', t('bulk.jobTitle', { count: n(list.length) }));
    void runBulk(d, list, ch, job, () => void (ch.moveTo ? reloadAll() : refreshSchema()));
  }
</script>

<Modal title={t('bulk.title', { db })} onclose={closeDialog} width={680}>
  {#if !plan}
    <div class="field">
      <span>{t('maint.tables', { count: n(picked.size) })}</span>
      <div class="list" role="group" aria-label={t('maint.tables', { count: n(picked.size) })}>
        {#each all as x (x.name)}
          <label class="inline"><input type="checkbox" aria-label={x.name} checked={picked.has(x.name)} onchange={() => { const s = new Set(picked); s.has(x.name) ? s.delete(x.name) : s.add(x.name); picked = s; }} /> <span class="mono">{x.name}</span> <span class="dim">{x.engine} · {sizeText(Number(x.bytes ?? 0))}</span></label>
        {/each}
      </div>
    </div>
    <fieldset>
      <legend>{t('bulk.what')}</legend>
      <div class="opt">
        <label class="inline"><input type="checkbox" bind:checked={doEngine} /> {t('bulk.engine')}</label>
        {#if doEngine}<Select value={engine} label={t('bulk.engine')} options={engines.map((e) => ({ value: e, label: e }))} onchange={(v) => (engine = v)} />{/if}
      </div>
      <div class="opt">
        <label class="inline"><input type="checkbox" bind:checked={doColl} /> {t('bulk.collation')}</label>
        {#if doColl}
          <Select value={collation} label={t('bulk.collation')} mono options={collations} onchange={(v) => (collation = v)} />
          <label class="inline sub"><input type="checkbox" bind:checked={convert} /> {t('bulk.convert')}</label>
          <p class="hint">{convert ? t('bulk.convertHelp') : t('bulk.defaultHelp')}</p>
        {/if}
      </div>
      <div class="opt">
        <label class="inline"><input type="checkbox" bind:checked={doComment} /> {t('bulk.comment')}</label>
        {#if doComment}<input class="v-input" bind:value={comment} maxlength="2048" aria-label={t('bulk.comment')} />{/if}
      </div>
      <div class="opt">
        <label class="inline"><input type="checkbox" bind:checked={doMove} /> {t('bulk.move')}</label>
        {#if doMove}<Select value={moveTo} label={t('bulk.move')} options={[{ value: '', label: '—' }, ...otherDbs.map((d) => ({ value: d.name, label: d.name }))]} onchange={(v) => (moveTo = v)} />{/if}
      </div>
    </fieldset>
  {:else}
    <p class="hint">{plan.rebuild ? t('bulk.rebuildNote', { time: totalSeconds < 60 ? `${totalSeconds} s` : `${Math.ceil(totalSeconds / 60)} min` }) : t('bulk.fastNote')}</p>
    <ol class="stmts">
      {#each plan.tables as x}
        <li>
          <span class="mono">{x.table}</span> <span class="dim">{sizeText(x.bytes)}{x.seconds ? ` · ~${x.seconds} s` : ''}</span>
          {#each x.statements as s}<pre class="mono">{s};</pre>{/each}
        </li>
      {/each}
    </ol>
  {/if}
  {#if error}<p class="v-banner v-banner--danger" role="alert">{error}</p>{/if}
  {#snippet footer()}
    {#if plan}
      <button class="v-btn-secondary" onclick={() => (plan = null)}>{t('bulk.back')}</button>
      <button class="v-btn-primary" onclick={apply}>{t('bulk.apply', { count: n(plan.tables.length) })}</button>
    {:else}
      <button class="v-btn-secondary" onclick={closeDialog}>{t('common.cancel')}</button>
      <button class="v-btn-primary" onclick={review} disabled={!picked.size || nothing}>{t('bulk.review')}</button>
    {/if}
  {/snippet}
</Modal>

<style>
  .field {
    display: grid;
    gap: 6px;
  }
  .field > span {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--sp-text-secondary);
  }
  .list {
    max-height: 170px;
    overflow: auto;
    display: grid;
    gap: 2px;
    padding: 6px 8px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
    font-size: 12.5px;
  }
  .opt {
    display: grid;
    gap: 6px;
    padding: 6px 0;
    border-bottom: 1px solid var(--sp-border);
  }
  .opt :global(.sel) {
    max-width: 320px;
  }
  .sub {
    margin-left: 22px;
  }
  .dim {
    color: var(--sp-text-tertiary);
    font-size: 11.5px;
  }
  .stmts {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 8px;
    font-size: 12.5px;
  }
  pre {
    margin: 4px 0 0;
    padding: 6px 8px;
    background: var(--sp-bg-subtle);
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
    font-size: 11.5px;
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
