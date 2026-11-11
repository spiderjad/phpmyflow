<script lang="ts">
  // Drop a view, routine, trigger or event: what else mentions it, then the
  // name typed to confirm.
  import { onMount } from 'svelte';
  import { closeDialog, managedOk } from '../../lib/dbActions.svelte';
  import { t } from '../../lib/i18n.svelte';
  import { objApi, type ObjKind } from '../../lib/objects';
  import { app, loadObjects, refreshSchema } from '../../lib/state.svelte';
  import { toast } from '../../lib/ui.svelte';
  import Modal from './Modal.svelte';

  let { db, kind, name }: { db: string; kind: ObjKind; name: string } = $props();

  let usedBy = $state<{ kind: string; name: string }[] | null>(null);
  let typed = $state('');
  let error = $state('');
  let busy = $state(false);

  onMount(async () => {
    try {
      usedBy = (await objApi.impact(db, kind, name)).usedBy;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  });

  async function go() {
    const [d, k, nm] = [db, kind, name]; // props are gone once the dialog closes
    if (!(await managedOk(d))) return;
    busy = true;
    error = '';
    try {
      await objApi.drop(d, k, nm, typed);
      toast(t('objects.dropped', { kind: t(`objects.kind.${k}`), name: nm }), 'success');
      closeDialog();
      if (app.object?.name === nm && app.object.kind === k) {
        app.object = null;
        app.view = 'overview';
      }
      if (k === 'VIEW') {
        if (app.table === nm) app.table = '';
        await refreshSchema();
      } else await loadObjects(d);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={t('objects.dropTitle', { kind: t(`objects.kind.${kind}`), name })} onclose={closeDialog}>
  <p>{t('danger.dropLead')}</p>
  {#if usedBy === null && !error}
    <p class="hint">{t('common.loading')}</p>
  {:else if usedBy?.length}
    <p class="warn">⚠ {t('objects.usedBy')}</p>
    <ul class="used">{#each usedBy as u}<li><span class="v-badge">{u.kind}</span> <span class="mono">{u.name}</span></li>{/each}</ul>
  {:else if usedBy}
    <p class="hint">{t('objects.notUsed')}</p>
  {/if}
  <label class="field">
    <span>{t('danger.typeToConfirm', { name })}</span>
    <input class="v-input mono" bind:value={typed} autocomplete="off" spellcheck="false" placeholder={name} aria-invalid={typed !== '' && typed !== name} />
  </label>
  {#if error}<p class="v-banner v-banner--danger" role="alert">{error}</p>{/if}
  {#snippet footer()}
    <button class="v-btn-secondary" onclick={closeDialog}>{t('common.cancel')}</button>
    <button class="v-btn-danger" onclick={go} disabled={busy || typed !== name}>{t('danger.dropBtn')}</button>
  {/snippet}
</Modal>

<style>
  p {
    margin: 0;
  }
  .warn {
    color: var(--sp-warning);
  }
  .used {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 4px;
    font-size: 12.5px;
  }
</style>
