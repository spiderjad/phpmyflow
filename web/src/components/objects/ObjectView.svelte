<script lang="ts">
  // Editor for a view, procedure, function, trigger or event. The form is
  // structured; the body is free text (CodeMirror). "Review and save" shows
  // the DDL the server will run (built by Objects.php) and asks to confirm.
  import { tick, untrack } from 'svelte';
  import { api } from '../../lib/api';
  import { copyText } from '../../lib/clipboard';
  import { isBool, realType, typeLabelKey, type ColumnDef } from '../../lib/columnTypes';
  import { managedOk, openDialog } from '../../lib/dbActions.svelte';
  import { dbTools, need, needText } from '../../lib/dbTools.svelte';
  import { n, t } from '../../lib/i18n.svelte';
  import {
    blankSpec,
    newParam,
    objApi,
    payloadOf,
    specFromInfo,
    type AnySpec,
    type EventSpec,
    type ObjKind,
    type RoutineSpec,
    type TriggerSpec,
    type ViewSpec,
  } from '../../lib/objects';
  import { app, loadObjects, openObject, refreshSchema, selectTable } from '../../lib/state.svelte';
  import { toast } from '../../lib/ui.svelte';
  import Modal from '../db/Modal.svelte';
  import TypePopover from '../structure/TypePopover.svelte';
  import CodeBox from './CodeBox.svelte';
  import ExecuteDialog from './ExecuteDialog.svelte';
  import ResultTable from './ResultTable.svelte';

  let { db, kind: kindProp, name, table = '' }: { db: string; kind: ObjKind; name: string | null; table?: string } = $props();

  let spec = $state<AnySpec>(untrack(() => blankSpec(kindProp, table)));
  // The kind of the spec on screen: changes together with it, so the form never
  // renders one kind's fields with another kind's data while the next one loads.
  let kind = $state<ObjKind>(untrack(() => kindProp));
  let original = $state<string | null>(null);
  let meta = $state<Record<string, any>>({});
  let loading = $state(false);
  let error = $state('');
  let review = $state<{ sql: string } | null>(null);
  let saving = $state(false);
  let saveError = $state('');
  let execOpen = $state(false);
  let typeFor = $state<{ anchor: HTMLElement; get: () => ColumnDef; set: (d: ColumnDef) => void } | null>(null);
  let test = $state<{ columns: string[]; rows: unknown[][]; truncated: boolean } | null>(null);
  let testError = $state('');
  let loadedFor = '';

  $effect(() => {
    const key = `${db}|${kindProp}|${name}|${table}`;
    if (key === loadedFor) return;
    loadedFor = key;
    untrack(load);
  });

  let loadSeq = 0;
  async function load() {
    const [k, nm, mine] = [kindProp, name, ++loadSeq];
    error = '';
    test = null;
    review = null;
    if (!nm) {
      spec = blankSpec(k, table);
      kind = k;
      original = null;
      meta = {};
      return;
    }
    loading = true;
    try {
      const info = await objApi.info(db, k, nm);
      if (mine !== loadSeq) return;
      spec = specFromInfo(k, info);
      kind = k;
      original = nm;
      meta = info;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      if (mine === loadSeq) loading = false;
    }
  }

  const isRoutine = $derived(kind === 'PROCEDURE' || kind === 'FUNCTION');
  const v = $derived(spec as ViewSpec);
  const r = $derived(spec as RoutineSpec);
  const tr = $derived(spec as TriggerSpec);
  const ev = $derived(spec as EventSpec);
  const objects = $derived(app.objects);
  const mariadb = $derived(objects?.mariadb ?? /mariadb/i.test(app.serverVersion));
  const kindLabel = $derived(t(`objects.kind.${kind}`));
  const priv = $derived(
    kind === 'VIEW' ? ['CREATE VIEW'] : kind === 'TRIGGER' ? ['TRIGGER'] : kind === 'EVENT' ? ['EVENT'] : original ? ['ALTER ROUTINE', 'CREATE ROUTINE'] : ['CREATE ROUTINE'],
  );
  const canSave = $derived(need(priv));
  const managed = $derived(dbTools.caps?.db === db ? dbTools.caps.managedBy : null);
  const nameOk = $derived(!!spec.name.trim() && spec.name.length <= 64 && !/[/\\.]/.test(spec.name));
  const tables = $derived(app.tables.filter((x) => x.type !== 'VIEW'));

  // Extra completions: parameters; NEW.col / OLD.col in triggers.
  const extra = $derived.by(() => {
    if (isRoutine) return r.params.filter((p) => p.name).map((p) => ({ label: p.name, detail: `${p.mode} ${realType(p.type)}` }));
    if (kind === 'TRIGGER') {
      const cols = app.schema[tr.table]?.columns ?? [];
      const out: { label: string; detail?: string }[] = [];
      if (tr.event !== 'DELETE') out.push(...cols.map((c) => ({ label: `NEW.${c.name}`, detail: c.type })));
      if (tr.event !== 'INSERT') out.push(...cols.map((c) => ({ label: `OLD.${c.name}`, detail: c.type })));
      return out;
    }
    return [];
  });
  const sameTableTriggers = $derived((objects?.triggers ?? []).filter((x) => x.table === tr.table && x.name !== original));

  function typeText(d: ColumnDef) {
    return isBool(d) ? t('types.bool') : `${realType(d)} · ${t(typeLabelKey(d))}`;
  }

  async function testView() {
    testError = '';
    test = null;
    const body = v.body.trim().replace(/;\s*$/, '');
    try {
      const res = await api.query({ db, sql: `SELECT * FROM (\n${body}\n) AS pmf_test LIMIT 100` });
      if ('type' in res && res.type === 'resultset') test = { columns: res.columns.map((c) => c.name), rows: res.rows, truncated: res.truncated };
    } catch (e) {
      testError = e instanceof Error ? e.message : String(e);
    }
  }

  async function openReview() {
    saveError = '';
    try {
      const p = await objApi.preview(db, kind, payloadOf(kind, spec), original);
      review = { sql: p.sql };
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    }
  }

  async function save() {
    if (!(await managedOk(db))) return;
    saving = true;
    saveError = '';
    const newName = spec.name.trim();
    try {
      await objApi.save(db, kind, payloadOf(kind, spec), original);
      toast(t('objects.saved', { kind: kindLabel, name: newName }), 'success');
      review = null;
      await loadObjects(db);
      if (kind === 'VIEW') await refreshSchema();
      loadedFor = '';
      openObject(kind, newName, kind === 'TRIGGER' ? tr.table : undefined);
      if (original === newName) await load();
    } catch (e) {
      const err = e as { message?: string; details?: Record<string, unknown> };
      saveError = (err.message ?? String(e)) + (err.details?.restored ? ` ${t('objects.restored')}` : '');
      review = null;
    } finally {
      saving = false;
    }
  }

  async function copyCreate() {
    if (!original) return;
    try {
      const c = await objApi.code(db, kind, original);
      if (await copyText(c.sql)) toast(t('tblmenu.createCopied'), 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  async function addParam() {
    r.params.push(newParam());
    await tick();
    document.querySelector<HTMLInputElement>('.params .prow:last-child input.pname')?.focus();
  }
  const UNITS = ['MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR', 'SECOND', 'QUARTER'];
</script>

<section class="obj" aria-labelledby="obj-title" aria-busy={loading}>
  <header class="head">
    <div>
      <p class="kind">{kindLabel}{#if kind === 'TRIGGER' && tr.table} · <button class="link mono" onclick={() => selectTable(tr.table)}>{tr.table}</button>{/if}</p>
      <h1 id="obj-title" class="mono">{original ?? t('objects.new', { kind: kindLabel })}</h1>
      {#if meta.definer}<p class="dim">{t('objects.definer', { definer: meta.definer })}{#if meta.lastRun} · {t('objects.lastRun', { at: meta.lastRun })}{/if}</p>{/if}
    </div>
    <div class="v-toolbar__group">
      {#if original && isRoutine}
        <button class="v-btn-secondary v-btn--sm" onclick={() => (execOpen = true)} disabled={!need(['EXECUTE']).ok} title={needText(need(['EXECUTE']))}>▶ {t('objects.execute')}</button>
      {/if}
      {#if original}
        <button class="v-btn-ghost v-btn--sm" onclick={copyCreate}>{t('objects.copyCreate')}</button>
        <button class="v-btn-ghost v-btn--sm danger" onclick={() => openDialog({ kind: 'dropObject', db, objKind: kind, name: original! })} disabled={!need(kind === 'VIEW' ? ['DROP'] : priv).ok}>{t('objects.drop')}</button>
      {/if}
    </div>
  </header>

  {#if managed}<p class="v-banner v-banner--warning" role="note"><strong>⚠ {t('managed.title', { app: managed === 'glpi' ? 'GLPI' : 'WordPress' })}</strong> {t(`managed.${managed}`)}</p>{/if}
  {#if error}<p class="v-banner v-banner--danger" role="alert">{error}</p>{/if}

  <div class="form">
    <div class="row">
      <label class="field grow">
        <span>{t('objects.name')}</span>
        <input class="v-input mono" bind:value={spec.name} maxlength="64" autocomplete="off" spellcheck="false" aria-invalid={!!spec.name && !nameOk} />
      </label>
      {#if kind === 'VIEW'}
        <label class="field"><span>ALGORITHM</span>
          <select class="v-input" bind:value={v.algorithm}>{#each ['UNDEFINED', 'MERGE', 'TEMPTABLE'] as o}<option>{o}</option>{/each}</select>
        </label>
        <label class="field"><span>SQL SECURITY</span>
          <select class="v-input" bind:value={v.security}>{#each ['DEFINER', 'INVOKER'] as o}<option>{o}</option>{/each}</select>
        </label>
        <label class="field"><span>CHECK OPTION</span>
          <select class="v-input" bind:value={v.checkOption}><option value="NONE">{t('objects.none')}</option><option>CASCADED</option><option>LOCAL</option></select>
        </label>
      {/if}
      {#if kind === 'TRIGGER'}
        <label class="field"><span>{t('objects.table')}</span>
          <select class="v-input mono" bind:value={tr.table}>{#each tables as x}<option value={x.name}>{x.name}</option>{/each}</select>
        </label>
        <fieldset class="field"><legend>{t('objects.timing')}</legend>
          <div class="v-segmented" role="group">{#each ['BEFORE', 'AFTER'] as o}<button type="button" class="v-segmented__item" aria-pressed={tr.timing === o} onclick={() => (tr.timing = o as TriggerSpec['timing'])}>{o}</button>{/each}</div>
        </fieldset>
        <fieldset class="field"><legend>{t('objects.event')}</legend>
          <div class="v-segmented" role="group">{#each ['INSERT', 'UPDATE', 'DELETE'] as o}<button type="button" class="v-segmented__item" aria-pressed={tr.event === o} onclick={() => (tr.event = o as TriggerSpec['event'])}>{o}</button>{/each}</div>
        </fieldset>
      {/if}
    </div>

    {#if kind === 'TRIGGER' && objects?.supportsOrder && sameTableTriggers.length}
      <div class="row">
        <label class="field"><span>{t('objects.order')}</span>
          <select class="v-input" value={tr.order?.kind ?? ''} onchange={(e) => { const k = (e.currentTarget as HTMLSelectElement).value; tr.order = k ? { kind: k as 'FOLLOWS' | 'PRECEDES', other: tr.order?.other ?? sameTableTriggers[0].name } : null; }}>
            <option value="">{t('objects.orderNone')}</option><option value="FOLLOWS">FOLLOWS</option><option value="PRECEDES">PRECEDES</option>
          </select>
        </label>
        {#if tr.order}
          <label class="field"><span>{t('objects.orderOther')}</span>
            <select class="v-input mono" bind:value={tr.order.other}>{#each sameTableTriggers as x}<option value={x.name}>{x.name} ({x.timing} {x.event})</option>{/each}</select>
          </label>
        {/if}
      </div>
    {/if}

    {#if isRoutine}
      <fieldset class="params">
        <legend>{t('objects.params')}</legend>
        <div class="pgrid" role="grid" aria-label={t('objects.params')}>
          <div class="phead" role="row">
            {#if kind === 'PROCEDURE'}<span role="columnheader">{t('objects.mode')}</span>{/if}
            <span role="columnheader">{t('objects.paramName')}</span><span role="columnheader">{t('objects.type')}</span><span role="columnheader"><span class="sr-only">{t('monitor.proc.actions')}</span></span>
          </div>
          {#each r.params as p, i (p.id)}
            <div class="prow" class:proc={kind === 'PROCEDURE'} role="row">
              {#if kind === 'PROCEDURE'}
                <span role="gridcell"><select class="v-input" bind:value={p.mode} aria-label={t('objects.mode')}>{#each ['IN', 'OUT', 'INOUT'] as o}<option>{o}</option>{/each}</select></span>
              {/if}
              <span role="gridcell"><input class="v-input mono pname" bind:value={p.name} aria-label={t('objects.paramName')} placeholder="p_{i + 1}" /></span>
              <span role="gridcell"><button type="button" class="v-input typebtn" onclick={(e) => (typeFor = { anchor: e.currentTarget as HTMLElement, get: () => p.type, set: (d) => (p.type = d) })} aria-haspopup="dialog">{typeText(p.type)}</button></span>
              <span role="gridcell"><button type="button" class="v-btn-icon v-btn--sm" aria-label={t('objects.removeParam', { name: p.name || String(i + 1) })} onclick={() => r.params.splice(i, 1)}>✕</button></span>
            </div>
          {/each}
        </div>
        <button type="button" class="v-btn-ghost v-btn--sm add" onclick={addParam}>+ {t('objects.addParam')}</button>
      </fieldset>
      <div class="row">
        {#if kind === 'FUNCTION' && r.returns}
          <div class="field"><span>{t('objects.returns')}</span>
            <button type="button" class="v-input typebtn" onclick={(e) => (typeFor = { anchor: e.currentTarget as HTMLElement, get: () => r.returns!, set: (d) => (r.returns = d) })} aria-haspopup="dialog">{typeText(r.returns)}</button>
          </div>
        {/if}
        <label class="field"><span>{t('objects.dataAccess')}</span>
          <select class="v-input" bind:value={r.dataAccess}>{#each ['CONTAINS SQL', 'NO SQL', 'READS SQL DATA', 'MODIFIES SQL DATA'] as o}<option>{o}</option>{/each}</select>
        </label>
        <label class="field"><span>SQL SECURITY</span>
          <select class="v-input" bind:value={r.security}>{#each ['DEFINER', 'INVOKER'] as o}<option>{o}</option>{/each}</select>
        </label>
        <label class="inline det"><input type="checkbox" bind:checked={r.deterministic} /> DETERMINISTIC</label>
      </div>
      <div class="row">
        <label class="field grow"><span>{t('objects.comment')}</span><input class="v-input" bind:value={r.comment} maxlength="1024" /></label>
        {#if dbTools.caps && (dbTools.caps as any).setDefiner}
          <label class="field"><span>DEFINER</span><input class="v-input mono" bind:value={r.definer} placeholder="'user'@'%'" /></label>
        {/if}
      </div>
    {/if}

    {#if kind === 'EVENT'}
      {#if objects && objects.scheduler !== 'ON'}
        <div class="v-banner v-banner--warning" role="note">
          <strong>{t('objects.schedulerOff', { state: objects.scheduler })}</strong>
          {t('objects.schedulerHow')} <code>SET GLOBAL event_scheduler = ON;</code>
          <button class="v-btn-ghost v-btn--sm" onclick={async () => (await copyText('SET GLOBAL event_scheduler = ON;')) && toast(t('tblmenu.createCopied'), 'info')}>{t('objects.copy')}</button>
          <span class="dim">{t('objects.schedulerCnf')}</span>
        </div>
      {/if}
      <fieldset class="field">
        <legend>{t('objects.schedule')}</legend>
        <div class="row">
          <label class="inline"><input type="radio" name="sched" checked={ev.schedule.type === 'once'} onchange={() => (ev.schedule = { type: 'once', at: '' })} /> {t('objects.once')}</label>
          <label class="inline"><input type="radio" name="sched" checked={ev.schedule.type === 'every'} onchange={() => (ev.schedule = { type: 'every', value: 1, unit: 'DAY', starts: '', ends: '' })} /> {t('objects.every')}</label>
        </div>
        {#if ev.schedule.type === 'once'}
          <label class="field small"><span>{t('objects.at')}</span><input class="v-input" type="datetime-local" bind:value={ev.schedule.at} /></label>
        {:else}
          <div class="row">
            <label class="field small"><span>{t('objects.everyN')}</span><input class="v-input" type="number" min="1" bind:value={ev.schedule.value} /></label>
            <label class="field small"><span>{t('objects.unit')}</span><select class="v-input" bind:value={ev.schedule.unit}>{#each UNITS as u}<option value={u}>{t(`objects.unit.${u}`)}</option>{/each}</select></label>
            <label class="field small"><span>{t('objects.starts')}</span><input class="v-input" type="datetime-local" bind:value={ev.schedule.starts} /></label>
            <label class="field small"><span>{t('objects.ends')}</span><input class="v-input" type="datetime-local" bind:value={ev.schedule.ends} /></label>
          </div>
        {/if}
      </fieldset>
      <div class="row">
        <label class="inline"><input type="checkbox" bind:checked={ev.enabled} /> {t('objects.enabled')}</label>
        <label class="inline"><input type="checkbox" bind:checked={ev.preserve} /> {t('objects.preserve')}</label>
        <label class="field grow"><span>{t('objects.comment')}</span><input class="v-input" bind:value={ev.comment} maxlength="64" /></label>
      </div>
    {/if}

    <div class="field">
      <span id="body-label">{kind === 'VIEW' ? t('objects.viewBody') : t('objects.body')}</span>
      {#key `${kind}|${original}|${loading}`}
        <CodeBox bind:value={spec.body} {db} schema={app.schema} {mariadb} {extra} lint={kind === 'VIEW'} label={kind === 'VIEW' ? t('objects.viewBody') : t('objects.body')} describedby="body-help" minHeight={kind === 'VIEW' ? 160 : 220} />
      {/key}
      <p class="hint" id="body-help">{kind === 'VIEW' ? t('objects.viewHelp') : kind === 'TRIGGER' ? t('objects.triggerHelp') : t('objects.bodyHelp')}</p>
    </div>

    {#if kind === 'VIEW'}
      <div class="test">
        <button class="v-btn-secondary v-btn--sm" onclick={testView} disabled={!v.body.trim()}>{t('objects.test')}</button>
        {#if testError}<p class="v-banner v-banner--danger" role="alert">{testError}</p>{/if}
        {#if test}<ResultTable columns={test.columns} rows={test.rows} truncated={test.truncated} caption={t('objects.test')} />{/if}
      </div>
    {/if}
  </div>

  <footer class="bar">
    {#if saveError}<p class="v-banner v-banner--danger err" role="alert">{saveError}</p>{/if}
    <span class="spacer"></span>
    {#if !canSave.ok}<span class="dim" title={needText(canSave)}>{canSave.reason}</span>{/if}
    <button class="v-btn-primary" onclick={openReview} disabled={!nameOk || !spec.body.trim() || !canSave.ok || loading}>{t('objects.review')}</button>
  </footer>
</section>

{#if typeFor}
  <TypePopover anchor={typeFor.anchor} def={typeFor.get()} onchange={(d) => typeFor?.set(d)} onclose={() => (typeFor = null)} />
{/if}

{#if review}
  <Modal title={t('objects.reviewTitle', { kind: kindLabel, name: spec.name })} onclose={() => (review = null)} width={680}>
    <p class="hint">{original ? t('objects.reviewReplace') : t('objects.reviewCreate')}</p>
    <p class="hint">{t('objects.reviewBody')}</p>
    <pre class="mono ddl">{review.sql}</pre>
    {#snippet footer()}
      <button class="v-btn-secondary" onclick={() => (review = null)}>{t('common.cancel')}</button>
      <button class="v-btn-primary" onclick={save} disabled={saving}>{saving ? t('objects.saving') : t('objects.confirmSave')}</button>
    {/snippet}
  </Modal>
{/if}

{#if execOpen && original && isRoutine}
  <ExecuteDialog {db} kind={kind as 'PROCEDURE' | 'FUNCTION'} name={original} onclose={() => (execOpen = false)} />
{/if}

<style>
  .obj {
    height: 100%;
    overflow: auto;
    padding: 16px 20px 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 12px;
  }
  .kind {
    margin: 0;
    font-size: 12px;
    color: var(--sp-text-secondary);
  }
  h1 {
    margin: 2px 0 0;
    font-size: 18px;
  }
  .dim {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--sp-text-tertiary);
  }
  .danger {
    color: var(--sp-danger);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
    font-size: inherit;
  }
  .form {
    display: grid;
    gap: 12px;
    max-width: 1100px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: flex-end;
  }
  .field {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .field > span,
  .field > legend {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--sp-text-secondary);
  }
  .grow {
    flex: 1;
    min-width: 200px;
  }
  .small input,
  .small select {
    max-width: 200px;
  }
  .inline {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 13px;
  }
  .det {
    padding-bottom: 8px;
  }
  .params {
    margin: 0;
    padding: 0;
    border: 0;
  }
  .params legend {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--sp-text-secondary);
    margin-bottom: 4px;
  }
  .pgrid {
    display: grid;
    gap: 4px;
  }
  .phead,
  .prow {
    display: grid;
    grid-template-columns: minmax(160px, 1fr) minmax(200px, 1.4fr) 36px;
    gap: 6px;
    align-items: center;
  }
  .prow.proc,
  .params:has(.prow.proc) .phead {
    grid-template-columns: 100px minmax(160px, 1fr) minmax(200px, 1.4fr) 36px;
  }
  .phead {
    font-size: 11.5px;
    color: var(--sp-text-tertiary);
  }
  .typebtn {
    text-align: left;
    cursor: pointer;
    font-size: 12.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .add {
    margin-top: 4px;
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--sp-text-tertiary);
  }
  .test {
    display: grid;
    gap: 6px;
    justify-items: start;
  }
  .test :global(.rt) {
    width: 100%;
  }
  code {
    font-family: var(--sp-font-mono);
    font-size: 12px;
  }
  .bar {
    position: sticky;
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    margin-top: auto;
    padding: 10px 0 14px;
    background: var(--sp-bg);
    border-top: 1px solid var(--sp-border);
  }
  .spacer {
    flex: 1;
  }
  .err {
    margin: 0;
    flex-basis: 100%;
  }
  .ddl {
    margin: 0;
    padding: 10px 12px;
    max-height: 50vh;
    overflow: auto;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
    background: var(--sp-bg-subtle);
    font-size: 12px;
    white-space: pre-wrap;
  }
  @media (max-width: 640px) {
    .obj {
      padding: 12px 12px 0;
    }
    .phead {
      display: none;
    }
    .prow,
    .prow.proc {
      grid-template-columns: 1fr 1fr 36px;
    }
  }
</style>
