<script lang="ts">
  import { untrack } from 'svelte';
  // Import a .sql or .sql.gz file into a database: chunked upload, then
  // statements run in short requests with progress (job). Before importing,
  // the start of the file is analysed (server: SqlRetarget::inspect): USE,
  // CREATE DATABASE, names qualified with a database, WordPress. When the
  // file comes from another database, it can all go into the chosen one.
  import { closeDialog, managedOk, reloadAll } from '../../lib/dbActions.svelte';
  import { dbApi, importInspect, type DumpInfo } from '../../lib/dbApi';
  import { canGunzip, runImport, source } from '../../lib/importer';
  import { n, t } from '../../lib/i18n.svelte';
  import { startJob } from '../../lib/jobs.svelte';
  import { app, openFiltered, selectDb } from '../../lib/state.svelte';
  import { dbTools } from '../../lib/dbTools.svelte';
  import FileDrop, { detectKind, type FileKind } from '../ui/FileDrop.svelte';
  import Select from '../ui/Select.svelte';
  import Modal from './Modal.svelte';

  let { db }: { db: string } = $props();

  const NEW = '\u0000new';
  let file = $state<File | null>(null);
  let kind = $state<FileKind | null>(null);
  let info = $state<DumpInfo | null>(null);
  let inspecting = $state(false);
  let inspectError = $state('');
  let target = $state(untrack(() => db));
  let continueOnError = $state(false);
  let noFkChecks = $state(true);
  let retarget = $state(true);
  // "Create new database…"
  let creating = $state(false);
  let newName = $state('');
  let newCollation = $state('utf8mb4_unicode_ci');
  let collations = $state<string[]>([]);
  let createError = $state('');
  let createBusy = $state(false);

  const userDbs = $derived(app.databases.filter((d) => !d.system));
  const targetOptions = $derived([...userDbs.map((d) => ({ value: d.name, label: d.name })), { value: NEW, label: t('import.newDb') }]);
  const gzNoSupport = $derived(kind === 'gzip' && !canGunzip());
  const managed = $derived(dbTools.caps?.db === target ? dbTools.caps.managedBy : null);
  /** Database the file was made from (header, USE, CREATE DATABASE or qualified names). */
  const sourceDb = $derived(info ? (info.database ?? info.uses[0] ?? info.createDbs[0] ?? info.qualified[0] ?? null) : null);
  const otherDb = $derived(!!sourceDb && sourceDb !== target);

  /** First 256 KB of the file (decompressed if .gz) → what it says about its source. */
  async function pick(f: File | null) {
    file = f;
    info = null;
    inspectError = '';
    kind = f ? await detectKind(f) : null;
    if (!f || kind === 'zip' || kind === 'unknown' || (kind === 'gzip' && !canGunzip())) return;
    inspecting = true;
    try {
      const reader = source(f).getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      while (size < 256 * 1024) {
        const { value, done } = await reader.read();
        if (done) break;
        parts.push(value);
        size += value.length;
      }
      void reader.cancel().catch(() => {});
      const head = new Uint8Array(Math.min(size, 256 * 1024));
      let o = 0;
      for (const p of parts) {
        const k = Math.min(p.length, head.length - o);
        head.set(p.subarray(0, k), o);
        o += k;
        if (o >= head.length) break;
      }
      info = await importInspect(head);
      retarget = true;
    } catch (e) {
      inspectError = e instanceof Error ? e.message : String(e);
    } finally {
      inspecting = false;
    }
  }

  async function chooseTarget(v: string) {
    if (v !== NEW) {
      target = v;
      creating = false;
      return;
    }
    creating = true;
    newName = '';
    createError = '';
    if (!collations.length) {
      try {
        const cs = await dbApi.charsets();
        collations = cs.charsets.find((c) => c.name === 'utf8mb4')?.collations ?? cs.charsets.flatMap((c) => c.collations);
      } catch {
        collations = ['utf8mb4_unicode_ci', 'utf8mb4_general_ci'];
      }
    }
  }

  async function createTarget() {
    createError = '';
    createBusy = true;
    try {
      await dbApi.createDb(newName.trim(), newCollation.split('_')[0], newCollation);
      await reloadAll();
      target = newName.trim();
      creating = false;
    } catch (e) {
      createError = e instanceof Error ? e.message : String(e);
    } finally {
      createBusy = false;
    }
  }

  async function go() {
    if (!file || creating) return;
    const f = file;
    const d = target;
    const wp = info?.wordpress && otherDb ? info.wordpress.prefix : null;
    const opts = { db: d, noFkChecks, continueOnError, retarget: otherDb && retarget && info ? info.sources : null };
    if (!(await managedOk(d))) return;
    closeDialog();
    const job = startJob('import', t('import.jobTitle', { file: f.name, db: d }));
    void runImport(f, opts, job, () => {
      void reloadAll();
      if (wp) {
        job.actions = [
          {
            label: t('import.viewRows', { table: `${wp}options` }),
            run: async () => {
              if (app.db !== d) await selectDb(d);
              openFiltered(`${wp}options`, { option_name: '=siteurl|home' });
            },
          },
        ];
      }
    });
  }
</script>

<Modal title={t('import.title')} onclose={closeDialog} width={560}>
  {#if managed}
    <p class="v-banner v-banner--warning" role="note"><strong>⚠ {t('managed.title', { app: managed === 'glpi' ? 'GLPI' : 'WordPress' })}</strong> {t(`managed.${managed}`)}</p>
  {/if}

  <FileDrop
    {file}
    {kind}
    accept=".sql,.gz,.sql.gz,application/sql,application/gzip"
    label={t('import.file')}
    hint={t('import.fileHint')}
    invalid={kind === 'zip' || kind === 'unknown' || gzNoSupport}
    onfile={(f) => void pick(f)}
  />
  {#if kind === 'zip'}<p class="v-error" role="alert">{t('import.zipNotSupported')}</p>{/if}
  {#if kind === 'unknown'}<p class="v-error" role="alert">{t('import.notSql')}</p>{/if}
  {#if gzNoSupport}<p class="v-error" role="alert">{t('import.noGunzip')}</p>{/if}
  {#if inspecting}<p class="v-help" role="status">{t('import.inspecting')}</p>{/if}
  {#if inspectError}<p class="v-help">{t('import.inspectFailed')}</p>{/if}

  <div class="field">
    <span class="lbl" id="imp-target-lbl">{t('import.target')}</span>
    <Select id="imp-target" value={creating ? NEW : target} options={targetOptions} label={t('import.target')} onchange={(v) => void chooseTarget(v)} />
    {#if !(otherDb && retarget)}<span class="hint">{t('import.targetHelp')}</span>{/if}
  </div>

  {#if creating}
    <div class="newdb" role="group" aria-label={t('import.newDb')}>
      <label class="field grow">
        <span>{t('import.newDbName')}</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input class="v-input mono" bind:value={newName} autofocus spellcheck="false" aria-invalid={createError ? 'true' : undefined} />
      </label>
      <div class="field">
        <span>{t('overview.col.collation')}</span>
        <Select value={newCollation} options={collations.map((c) => ({ value: c, label: c }))} label={t('overview.col.collation')} onchange={(v) => (newCollation = v)} />
      </div>
      <div class="newdb-acts">
        <button class="v-btn-primary v-btn--sm" onclick={createTarget} disabled={!newName.trim() || createBusy}>{t('import.createDb')}</button>
        <button class="v-btn-ghost v-btn--sm" onclick={() => (creating = false)}>{t('common.cancel')}</button>
      </div>
      {#if createError}<p class="v-error" role="alert">{createError}</p>{/if}
    </div>
  {/if}

  {#if info && otherDb}
    <div class="v-banner v-banner--warning other" role="status">
      <p><strong>{t('import.otherDb', { from: sourceDb ?? '', to: target })}</strong></p>
      <label class="inline"><input type="checkbox" bind:checked={retarget} /> {t('import.retarget')}</label>
      {#if !retarget && (info.uses.length || info.createDbs.length)}<p>{t('import.retargetOff', { db: sourceDb ?? '' })}</p>{/if}
    </div>
    {#if info.wordpress}
      <p class="v-banner v-banner--info" role="note">{t('import.wpNote', { table: `${info.wordpress.prefix}options` })}</p>
    {/if}
  {:else if info && info.statements > 0}
    <p class="v-help" role="status">{t('import.inspectOk', { count: n(info.statements) })}</p>
  {/if}

  <fieldset>
    <legend>{t('import.onError')}</legend>
    <label class="inline"><input type="radio" bind:group={continueOnError} value={false} /> {t('import.stopFirst')}</label>
    <label class="inline"><input type="radio" bind:group={continueOnError} value={true} /> {t('import.continueLog')}</label>
  </fieldset>
  <label class="inline"><input type="checkbox" bind:checked={noFkChecks} /> {t('import.noFkChecks')}</label>
  <p class="hint">{t('import.howItWorks')}</p>
  {#snippet footer()}
    <button class="v-btn-secondary" onclick={closeDialog}>{t('common.cancel')}</button>
    <button class="v-btn-primary" onclick={go} disabled={!file || gzNoSupport || kind === 'zip' || kind === 'unknown' || inspecting || creating}>{t('import.go')}</button>
  {/snippet}
</Modal>

<style>
  /* Import modal (components/db/ImportDialog.svelte). */
  .lbl {
    font-size: 13px;
    font-weight: 500;
  }
  .newdb {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
    background: var(--sp-bg-subtle);
  }
  .newdb .grow {
    min-width: 0;
  }
  .newdb-acts {
    grid-column: 1 / -1;
    display: flex;
    gap: 6px;
  }
  .newdb .v-error {
    grid-column: 1 / -1;
    margin: 0;
  }
  .other {
    display: grid;
    gap: 6px;
  }
  .other p {
    margin: 0;
  }
  @media (max-width: 520px) {
    .newdb {
      grid-template-columns: 1fr;
    }
  }
</style>
