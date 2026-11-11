<script lang="ts">
  // Drop a database, or empty / drop tables: the impact first (rows, size,
  // tables that point here), then the name typed to confirm.
  import { onMount } from 'svelte';
  import { formatBytes } from '../../lib/bytes';
  import { dbApi, type DbImpact, type TableImpact } from '../../lib/dbApi';
  import { afterDrop, closeDialog } from '../../lib/dbActions.svelte';
  import { dbTools } from '../../lib/dbTools.svelte';
  import { i18n, n, t } from '../../lib/i18n.svelte';
  import { toast } from '../../lib/ui.svelte';
  import Modal from './Modal.svelte';

  let { kind, db, tables = [] }: { kind: 'dropDb' | 'truncate' | 'drop'; db: string; tables?: string[] } = $props();

  let dbImpact = $state<DbImpact | null>(null);
  let impact = $state<TableImpact[] | null>(null);
  let typed = $state('');
  let ignoreFks = $state(false);
  let error = $state('');
  let busy = $state(false);

  const target = $derived(kind === 'dropDb' ? db : tables.length === 1 ? tables[0] : db);
  const referenced = $derived((impact ?? []).filter((x) => x.referencedBy.length));
  const managed = $derived(dbTools.caps?.db === db ? dbTools.caps.managedBy : null);
  const size = (b: number) => formatBytes(b, i18n.locale);
  const title = $derived(kind === 'dropDb' ? t('danger.dropDbTitle', { db }) : tables.length === 1 ? t(`danger.${kind}OneTitle`, { table: tables[0] }) : t(`danger.${kind}ManyTitle`, { count: n(tables.length) }));

  onMount(async () => {
    try {
      if (kind === 'dropDb') dbImpact = await dbApi.dbImpact(db);
      else impact = (await dbApi.tablesImpact(db, tables)).tables;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  });

  async function go() {
    // Props are gone once the dialog closes: keep what the rest needs.
    const [k, d, list] = [kind, db, [...tables]];
    busy = true;
    error = '';
    try {
      if (k === 'dropDb') {
        await dbApi.dropDb(d, typed);
        toast(t('danger.dbDropped', { db: d }), 'success');
        closeDialog();
        await afterDrop(d, null);
      } else {
        const r = k === 'drop' ? await dbApi.drop(d, list, typed, ignoreFks) : await dbApi.truncate(d, list, typed, ignoreFks);
        toast(t(k === 'drop' ? 'danger.dropped' : 'danger.emptied', { count: n(r.done.length) }), 'success');
        closeDialog();
        await afterDrop(d, k === 'drop' ? list : []);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<Modal {title} onclose={closeDialog} width={560}>
  {#if managed}
    <p class="v-banner v-banner--warning" role="note"><strong>⚠ {t('managed.title', { app: managed === 'glpi' ? 'GLPI' : 'WordPress' })}</strong> {t(`managed.${managed}`)}</p>
  {/if}
  <p class="lead">{t(kind === 'truncate' ? 'danger.truncateLead' : 'danger.dropLead')}</p>

  {#if kind === 'dropDb'}
    {#if dbImpact}
      <ul class="impact">
        <li>{t('danger.dbTables', { tables: n(dbImpact.tables), views: n(dbImpact.views), routines: n(dbImpact.routines) })}</li>
        <li>{t('danger.dbRows', { rows: n(dbImpact.rows), size: size(dbImpact.bytes) })}</li>
        {#if dbImpact.referencedFrom.length}
          <li class="warn">⚠ {t('danger.dbReferenced', { list: dbImpact.referencedFrom.map((r) => `${r.db}.${r.table}`).join(', ') })}</li>
        {/if}
      </ul>
    {:else if !error}<p class="hint">{t('common.loading')}</p>{/if}
  {:else if impact}
    <table class="grid list">
      <thead><tr><th>{t('overview.col.name')}</th><th class="num">{t('overview.col.rows')}</th><th class="num">{t('overview.col.size')}</th><th>{t('danger.referencedBy')}</th></tr></thead>
      <tbody>
        {#each impact as x}
          <tr>
            <td class="mono">{x.table}</td>
            <td class="num">{x.exact ? '' : '~'}{n(x.rows)}</td>
            <td class="num">{size(x.bytes)}</td>
            <td>{#if x.referencedBy.length}<span class="warn">⚠ {x.referencedBy.map((r) => (r.db === db ? r.table : `${r.db}.${r.table}`)).join(', ')}</span>{:else}<span class="dim">—</span>{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if referenced.length}
      <label class="inline warn-box">
        <input type="checkbox" bind:checked={ignoreFks} />
        <span>{t('danger.ignoreFks')}</span>
      </label>
    {/if}
  {:else if !error}<p class="hint">{t('common.loading')}</p>{/if}

  <label class="field">
    <span>{t('danger.typeToConfirm', { name: target })}</span>
    <input class="v-input mono" bind:value={typed} autocomplete="off" spellcheck="false" placeholder={target} aria-invalid={typed !== '' && typed !== target} />
  </label>
  {#if error}<p class="v-banner v-banner--danger" role="alert">{error}</p>{/if}
  {#snippet footer()}
    <button class="v-btn-secondary" onclick={closeDialog}>{t('common.cancel')}</button>
    <button class="v-btn-danger" onclick={go} disabled={busy || typed !== target || (referenced.length > 0 && !ignoreFks)}>
      {kind === 'truncate' ? t('danger.truncateBtn') : kind === 'drop' ? t('danger.dropBtn') : t('danger.dropDbBtn')}
    </button>
  {/snippet}
</Modal>

<style>
  .lead {
    margin: 0;
  }
  .impact {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 4px;
  }
  .warn {
    color: var(--sp-warning);
  }
  .warn-box {
    padding: 8px 10px;
    border: 1px solid var(--sp-warning);
    border-radius: var(--sp-radius);
    font-size: 12.5px;
  }
  .dim {
    color: var(--sp-text-tertiary);
  }
  .list {
    font-size: 12.5px;
  }
  .num {
    text-align: right;
  }
</style>
