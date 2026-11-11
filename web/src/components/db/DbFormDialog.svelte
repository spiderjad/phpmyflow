<script lang="ts">
  // Create a database, or change its charset/collation. Renaming does not
  // exist in MySQL: the edit form explains it and offers "Copy to a new database".
  import { onMount } from 'svelte';
  import { dbApi, type Charsets } from '../../lib/dbApi';
  import { closeDialog, managedOk, openDialog, reloadAll } from '../../lib/dbActions.svelte';
  import { t } from '../../lib/i18n.svelte';
  import { app, selectDb } from '../../lib/state.svelte';
  import { toast } from '../../lib/ui.svelte';
  import CollationPicker from './CollationPicker.svelte';
  import Modal from './Modal.svelte';

  let { db = null }: { db?: string | null } = $props();
  const editing = $derived(db !== null);

  let data = $state<Charsets | null>(null);
  let name = $state('');
  let charset = $state('utf8mb4');
  let collation = $state('');
  let error = $state('');
  let busy = $state(false);
  const nameError = $derived(!name.trim() ? '' : /[/\\.]/.test(name) || name.length > 64 || name !== name.trimEnd() ? t('dbform.badName') : app.databases.some((d) => d.name.toLowerCase() === name.trim().toLowerCase()) ? t('dbform.exists') : '');

  onMount(async () => {
    try {
      data = await dbApi.charsets();
      if (editing) {
        const ov = await dbApi.overview(db!);
        charset = ov.charset ?? data.serverCharset;
        collation = ov.collation ?? '';
      } else {
        charset = data.charsets.some((c) => c.name === 'utf8mb4') ? 'utf8mb4' : data.serverCharset;
        const cs = data.charsets.find((c) => c.name === charset);
        collation = cs?.collations.includes('utf8mb4_unicode_ci') ? 'utf8mb4_unicode_ci' : (cs?.default ?? '');
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  });

  async function save() {
    error = '';
    busy = true;
    const d = db; // props are gone once the dialog closes
    try {
      if (d !== null) {
        if (!(await managedOk(d))) return;
        await dbApi.alterDb(d, charset, collation);
        toast(t('dbform.saved'), 'success');
        closeDialog();
        await reloadAll();
      } else {
        const n = name.trim();
        await dbApi.createDb(n, charset, collation);
        toast(t('dbform.created', { name: n }), 'success');
        closeDialog();
        await reloadAll();
        await selectDb(n);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={editing ? t('dbform.editTitle', { db: db ?? '' }) : t('dbform.createTitle')} onclose={closeDialog}>
  {#if editing}
    <p class="hint">{t('dbform.noRename')} <button class="link" onclick={() => openDialog({ kind: 'copyDb', db: db! })}>{t('dbmenu.copyDb')}</button></p>
    <p class="hint">{t('dbform.editNote')}</p>
  {:else}
    <label class="field">
      <span>{t('dbform.name')}</span>
      <input class="v-input mono" bind:value={name} maxlength="64" autocomplete="off" spellcheck="false" aria-invalid={!!nameError} aria-describedby="dbname-err" />
      {#if nameError}<span class="err" id="dbname-err">{nameError}</span>{/if}
    </label>
  {/if}
  {#if data}
    <CollationPicker {data} bind:charset bind:collation />
  {:else if !error}
    <p class="hint">{t('common.loading')}</p>
  {/if}
  {#if error}<p class="v-banner v-banner--danger" role="alert">{error}</p>{/if}
  {#snippet footer()}
    <button class="v-btn-secondary" onclick={closeDialog}>{t('common.cancel')}</button>
    <button class="v-btn-primary" onclick={save} disabled={busy || !data || !collation || (!editing && (!name.trim() || !!nameError))}>{editing ? t('dbform.save') : t('dbform.create')}</button>
  {/snippet}
</Modal>

<style>
  .err {
    color: var(--sp-danger-text);
    font-size: 12px;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--sp-text-primary);
    text-decoration: underline;
    cursor: pointer;
    font-size: inherit;
  }
</style>
