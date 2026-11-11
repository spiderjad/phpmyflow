<script lang="ts">
  // Rename a table, copy a table (same or another database), or copy the
  // whole database to a new one (the way to "rename" a database in MySQL).
  import { onMount, untrack } from 'svelte';
  import { runCopyDatabase, runCopyTable } from '../../lib/copier';
  import { dbApi, type Charsets } from '../../lib/dbApi';
  import { closeDialog, managedOk, reloadAll } from '../../lib/dbActions.svelte';
  import { t } from '../../lib/i18n.svelte';
  import { startJob } from '../../lib/jobs.svelte';
  import { app, refreshSchema, selectTable } from '../../lib/state.svelte';
  import { toast } from '../../lib/ui.svelte';
  import CollationPicker from './CollationPicker.svelte';
  import Modal from './Modal.svelte';

  let { kind, db, table = '' }: { kind: 'renameTable' | 'copyTable' | 'copyDb'; db: string; table?: string } = $props();

  let name = $state(untrack(() => (kind === 'renameTable' ? table : kind === 'copyTable' ? `${table}_copy` : `${db}_copy`)));
  let targetDb = $state(untrack(() => db));
  let mode = $state<'structure' | 'data'>('data');
  let indexes = $state(true);
  let fks = $state(false);
  let error = $state('');
  let busy = $state(false);
  let charsets = $state<Charsets | null>(null);
  let charset = $state('utf8mb4');
  let collation = $state('');

  const userDbs = $derived(app.databases.filter((d) => !d.system));
  const badName = $derived(!name.trim() || /[/\\.]/.test(name) || name.length > 64 || name !== name.trimEnd());
  const exists = $derived(
    kind === 'copyDb'
      ? app.databases.some((d) => d.name.toLowerCase() === name.trim().toLowerCase())
      : targetDb === app.db && app.tables.some((x) => x.name.toLowerCase() === name.trim().toLowerCase() && !(kind === 'renameTable' && x.name === table)),
  );

  onMount(async () => {
    if (kind !== 'copyDb') return;
    try {
      charsets = await dbApi.charsets();
      const ov = await dbApi.overview(db);
      charset = ov.charset ?? charsets.serverCharset;
      collation = ov.collation ?? '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  });

  async function go() {
    error = '';
    // Props are gone once the dialog closes: keep what the rest needs.
    const [k, src, tbl, target] = [kind, db, table, targetDb];
    const [withData, withIdx, withFks, cs, coll] = [mode === 'data', indexes, fks, charset, collation];
    const n = name.trim();
    if (k !== 'copyDb' && !(await managedOk(k === 'copyTable' ? target : src))) return;
    if (k === 'renameTable') {
      busy = true;
      try {
        await dbApi.renameTable(src, tbl, n);
        toast(t('tableops.renamed', { from: tbl, to: n }), 'success');
        closeDialog();
        await refreshSchema();
        if (app.table === tbl) selectTable(n);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        busy = false;
      }
      return;
    }
    closeDialog();
    if (k === 'copyTable') {
      const job = startJob('copy', t('copy.jobTitle', { from: tbl, to: `${target}.${n}` }));
      void runCopyTable({ db: src, table: tbl, targetDb: target, newName: n, data: withData, indexes: withIdx, fks: withFks }, job, () => void (target === app.db ? refreshSchema() : undefined));
    } else {
      const job = startJob('copy', t('copy.dbJobTitle', { from: src, to: n }));
      void runCopyDatabase(src, n, cs, coll, job, () => void reloadAll());
    }
  }
</script>

<Modal title={kind === 'renameTable' ? t('tableops.renameTitle', { table }) : kind === 'copyTable' ? t('tableops.copyTitle', { table }) : t('tableops.copyDbTitle', { db })} onclose={closeDialog}>
  {#if kind === 'copyDb'}<p class="hint">{t('tableops.copyDbHelp')}</p>{/if}
  {#if kind === 'copyTable'}
    <label class="field">
      <span>{t('tableops.targetDb')}</span>
      <select class="v-input" bind:value={targetDb}>
        {#each userDbs as d}<option value={d.name}>{d.name}</option>{/each}
      </select>
    </label>
  {/if}
  <label class="field">
    <span>{kind === 'copyDb' ? t('tableops.newDbName') : t('tableops.newName')}</span>
    <input class="v-input mono" bind:value={name} maxlength="64" autocomplete="off" spellcheck="false" aria-invalid={badName || exists} />
    {#if exists}<span class="err">{kind === 'copyDb' ? t('dbform.exists') : t('tableops.exists')}</span>{/if}
  </label>
  {#if kind === 'copyTable'}
    <fieldset>
      <legend>{t('tableops.what')}</legend>
      <label class="inline"><input type="radio" bind:group={mode} value="structure" /> {t('tableops.structureOnly')}</label>
      <label class="inline"><input type="radio" bind:group={mode} value="data" /> {t('tableops.structureData')}</label>
    </fieldset>
    <div class="checks">
      <label><input type="checkbox" bind:checked={indexes} /> {t('tableops.withIndexes')}</label>
      <label><input type="checkbox" bind:checked={fks} /> {t('tableops.withFks')}</label>
    </div>
    {#if mode === 'data'}<p class="hint">{t('tableops.batches')}</p>{/if}
  {/if}
  {#if kind === 'copyDb' && charsets}
    <CollationPicker data={charsets} bind:charset bind:collation />
  {/if}
  {#if error}<p class="v-banner v-banner--danger" role="alert">{error}</p>{/if}
  {#snippet footer()}
    <button class="v-btn-secondary" onclick={closeDialog}>{t('common.cancel')}</button>
    <button class="v-btn-primary" onclick={go} disabled={busy || badName || exists || (kind === 'renameTable' && name.trim() === table) || (kind === 'copyDb' && !collation)}>
      {kind === 'renameTable' ? t('tableops.rename') : t('tableops.copy')}
    </button>
  {/snippet}
</Modal>

<style>
  .err {
    color: var(--sp-danger-text);
    font-size: 12px;
  }
</style>
