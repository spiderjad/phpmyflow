<script lang="ts">
  // New table from scratch or from a template. The server builds the CREATE
  // TABLE from the spec; then the table opens in Structure to keep editing.
  import { dbApi } from '../../lib/dbApi';
  import { closeDialog, managedOk } from '../../lib/dbActions.svelte';
  import { t } from '../../lib/i18n.svelte';
  import { app, refreshSchema, selectTable } from '../../lib/state.svelte';
  import { TEMPLATES, templateSpec, type TemplateId } from '../../lib/tableTemplates';
  import { toast } from '../../lib/ui.svelte';
  import Modal from './Modal.svelte';

  let { db }: { db: string } = $props();

  let name = $state('');
  let tpl = $state<TemplateId>('blank');
  let linkA = $state('');
  let linkB = $state('');
  let comment = $state('');
  let sql = $state('');
  let error = $state('');
  let busy = $state(false);

  const withPk = $derived(app.tables.filter((x) => x.type !== 'VIEW' && app.schema[x.name]?.columns.some((c) => c.name === 'id' && c.key === 'PRI')));
  const badName = $derived(!name.trim() || /[/\\.]/.test(name) || name.length > 64);
  const exists = $derived(app.tables.some((x) => x.name.toLowerCase() === name.trim().toLowerCase()));
  const spec = $derived({ ...templateSpec(tpl, name.trim(), { a: linkA, b: linkB }), comment });
  const preview = $derived(spec.columns.map((c) => c.name).join(', '));

  // Suggest a name for the link table: orders + products -> order_products.
  $effect(() => {
    if (tpl === 'link' && linkA && linkB && !name.trim()) name = `${linkA}_${linkB}`;
  });

  async function showSql() {
    error = '';
    try {
      sql = (await dbApi.createTable(db, { ...spec, dryRun: true })).sql;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function create() {
    const [d, s] = [db, $state.snapshot(spec)]; // props are gone once the dialog closes
    if (!(await managedOk(d))) return;
    busy = true;
    error = '';
    try {
      await dbApi.createTable(d, s);
      toast(t('newtable.created', { name: s.name }), 'success');
      closeDialog();
      await refreshSchema();
      selectTable(s.name);
      app.view = 'structure';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={t('newtable.title', { db })} onclose={closeDialog} width={620}>
  <label class="field">
    <span>{t('newtable.name')}</span>
    <input class="v-input mono" bind:value={name} maxlength="64" autocomplete="off" spellcheck="false" aria-invalid={!!name && (badName || exists)} />
    {#if exists}<span class="err">{t('tableops.exists')}</span>{/if}
  </label>
  <fieldset>
    <legend>{t('newtable.template')}</legend>
    <div class="tpls">
      {#each TEMPLATES as id}
        <label class="tpl" class:on={tpl === id}>
          <input type="radio" bind:group={tpl} value={id} />
          <strong>{t(`newtable.tpl.${id}`)}</strong>
          <span>{t(`newtable.tpl.${id}Help`)}</span>
        </label>
      {/each}
    </div>
  </fieldset>
  {#if tpl === 'link'}
    <div class="row2">
      <label class="field"><span>{t('newtable.linkA')}</span>
        <select class="v-input" bind:value={linkA}><option value="">—</option>{#each withPk as x}<option value={x.name}>{x.name}</option>{/each}</select>
      </label>
      <label class="field"><span>{t('newtable.linkB')}</span>
        <select class="v-input" bind:value={linkB}><option value="">—</option>{#each withPk as x}<option value={x.name}>{x.name}</option>{/each}</select>
      </label>
    </div>
    {#if !withPk.length}<p class="hint">{t('newtable.linkNone')}</p>{/if}
  {/if}
  <p class="hint">{t('newtable.columns')} <span class="mono">{preview}</span></p>
  <label class="field">
    <span>{t('editor.table.comment')}</span>
    <input class="v-input" bind:value={comment} maxlength="2048" />
  </label>
  <p class="hint">{t('newtable.afterCreate')}</p>
  {#if sql}<pre class="mono">{sql}</pre>{/if}
  {#if error}<p class="v-banner v-banner--danger" role="alert">{error}</p>{/if}
  {#snippet footer()}
    <button class="v-btn-ghost" onclick={showSql} disabled={badName || (tpl === 'link' && (!linkA || !linkB))}>{t('newtable.showSql')}</button>
    <span class="spacer"></span>
    <button class="v-btn-secondary" onclick={closeDialog}>{t('common.cancel')}</button>
    <button class="v-btn-primary" onclick={create} disabled={busy || badName || exists || (tpl === 'link' && (!linkA || !linkB))}>{t('newtable.create')}</button>
  {/snippet}
</Modal>

<style>
  .err {
    color: var(--sp-danger-text);
    font-size: 12px;
  }
  .tpls {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .tpl {
    position: relative;
    display: grid;
    gap: 2px;
    padding: 8px 10px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
    cursor: pointer;
    font-size: 12px;
    color: var(--sp-text-secondary);
  }
  .tpl strong {
    font-size: 13px;
    color: var(--sp-text-primary);
  }
  .tpl.on {
    border-color: var(--sp-text-primary);
    box-shadow: inset 0 0 0 1px var(--sp-text-primary);
  }
  .tpl input {
    position: absolute;
    opacity: 0;
  }
  .tpl:has(input:focus-visible) {
    outline: 2px solid var(--sp-focus);
    outline-offset: 2px;
  }
  pre {
    margin: 0;
    padding: 8px 10px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
    background: var(--sp-bg-subtle);
    font-size: 11.5px;
    white-space: pre-wrap;
  }
  .spacer {
    flex: 1;
  }
  @media (max-width: 560px) {
    .tpls {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
