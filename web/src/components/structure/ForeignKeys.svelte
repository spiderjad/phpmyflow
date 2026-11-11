<script lang="ts">
  import { untrack } from 'svelte';
  import { editorApi, type FkIssue, type Relation } from '../../lib/api';
  import { formatBytes } from '../../lib/bytes';
  import { parseColumnType } from '../../lib/columnTypes';
  import { fkName, fkSignature, orphanQuery, polymorphicIds, preselect, RULES, setNullBlocker, targetCandidates } from '../../lib/foreignKeys';
  import { commonPrefix } from '../../lib/fuzzy';
  import { i18n, n, t } from '../../lib/i18n.svelte';
  import { prefs } from '../../lib/prefs.svelte';
  import { app, openFiltered } from '../../lib/state.svelte';
  import { tabs } from '../../lib/tabs.svelte';
  import { clone, uid, type FkModel, type TableModel } from '../../lib/tableDraft';
  import { confirmAction, toast } from '../../lib/ui.svelte';
  import Popover from './Popover.svelte';
  import Select from '../ui/Select.svelte';

  let {
    db,
    table,
    draft,
    original,
    editable,
    edit,
    onfixcolumn,
  }: {
    db: string;
    table: string;
    draft: TableModel;
    original: TableModel;
    editable: boolean;
    edit: (fn: (d: TableModel) => void) => void;
    /** "Adjust source column": give the local column the referenced type. */
    onfixcolumn: (column: string, columnType: string, collation: string | null) => void;
  } = $props();

  const prefix = $derived(commonPrefix(app.tables.map((x) => x.name)));
  const shown = (name: string) => (prefs.hidePrefix && prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name);
  const localDef = (name: string) => draft.columns.find((c) => c.name === name) ?? null;
  const isNew = (f: FkModel) => !f.orig;
  const origFk = (f: FkModel) => original.fks.find((o) => o.orig === f.orig);
  const changed = (f: FkModel) => {
    const o = origFk(f);
    return !o || JSON.stringify([o.name, o.columns, o.refTable, o.refColumns, o.onDelete, o.onUpdate]) !== JSON.stringify([f.name, f.columns, f.refTable, f.refColumns, f.onDelete, f.onUpdate]);
  };

  // --- live validation (server ddl_checks), only for new or changed FKs ---
  // Results are keyed by the FK's signature: an answer for an older version of
  // the FK (late, out of order) is ignored, and a failed request is shown
  // instead of leaving the last answer in place. The review validates again
  // on the server whatever happens here.
  type Live = { sig: string; issues: FkIssue[] };
  let results = $state<Record<string, Live>>({});
  let checking = $state(false);
  let failed = $state('');
  let seq = 0;
  let timer: ReturnType<typeof setTimeout>;
  const defsOf = (cols: string[]) =>
    Object.fromEntries(
      draft.columns
        .filter((c) => cols.includes(c.name))
        .map((c) => [c.name, { type: c.type, length: c.length, scale: c.scale, unsigned: c.unsigned, collation: c.collation, nullable: c.nullable }]),
    );
  const sigOf = (f: FkModel) => fkSignature(f, defsOf(f.columns));
  function runChecks() {
    const pending = draft.fks.filter(changed).map((f) => ({
      id: f.id,
      sig: sigOf(f),
      columns: [...f.columns],
      origColumns: f.columns.map((c) => draft.columns.find((x) => x.name === c)?.orig ?? null),
      refTable: f.refTable,
      refColumns: [...f.refColumns],
      onDelete: f.onDelete,
      onUpdate: f.onUpdate,
    }));
    clearTimeout(timer);
    if (!pending.length) {
      results = {};
      failed = '';
      return;
    }
    const mine = ++seq;
    const defs = defsOf(pending.flatMap((p) => p.columns));
    timer = setTimeout(async () => {
      checking = true;
      try {
        const r = (await editorApi.fkChecks(db, table, pending, defs)).results;
        if (mine !== seq) return;
        results = Object.fromEntries(pending.map((p) => [p.id, { sig: p.sig, issues: r[p.id] ?? [] }]));
        failed = '';
      } catch (err) {
        if (mine !== seq) return;
        results = {};
        failed = err instanceof Error ? err.message : String(err);
      } finally {
        if (mine === seq) checking = false;
      }
    }, 400);
  }
  $effect(() => {
    void draft.fks.map((f) => [sigOf(f), f.orig, f.name]);
    untrack(runChecks);
  });

  const current = (f: FkModel) => {
    const r = results[f.id];
    return r && r.sig === sigOf(f) ? r.issues : null;
  };
  const issuesOf = (f: FkModel) => (changed(f) ? (current(f) ?? []) : []);
  const levelOf = (f: FkModel): 'ok' | 'info' | 'warn' | 'error' | 'pending' => {
    if (!changed(f)) return 'ok';
    const is = current(f);
    if (!is) return 'pending';
    if (is.some((x) => x.level === 'error')) return 'error';
    if (is.some((x) => x.code === 'orphans') && !f.fix) return 'warn';
    return is.some((x) => x.level === 'info') ? 'info' : 'ok';
  };

  // --- editing ---
  function patch(id: string, fn: (f: FkModel) => void) {
    edit((d) => {
      const f = d.fks.find((x) => x.id === id);
      if (!f) return;
      fn(f);
      if (f.autoName !== false && !f.orig) f.name = fkName(table, f.columns, prefix);
    });
  }
  const poly = $derived(polymorphicIds(app.polymorphic, table));
  function addBlank() {
    const col = draft.columns.find((c) => /_id$/i.test(c.name) && !poly.has(c.name) && !draft.fks.some((f) => f.columns.includes(c.name)));
    const id = uid('f');
    edit((d) =>
      d.fks.push({ id, orig: null, name: fkName(table, col ? [col.name] : [], prefix), autoName: true, columns: col ? [col.name] : [], refTable: '', refColumns: [], onDelete: 'RESTRICT', onUpdate: 'CASCADE', fix: null }),
    );
  }
  function fromSuggestion(r: Relation) {
    edit((d) =>
      d.fks.push({ id: uid('f'), orig: null, name: fkName(table, [r.column], prefix), autoName: true, columns: [r.column], refTable: r.to, refColumns: [r.toColumn], onDelete: 'RESTRICT', onUpdate: 'CASCADE', fix: null }),
    );
    toast(t('fk.queued', { from: r.column, to: `${r.to}.${r.toColumn}` }) + ' ' + t('editor.queued.suffix'), 'info', 4500);
  }
  let selected = $state<Set<string>>(new Set());
  let focused = $state<string | null>(null);
  function removeSelected() {
    const ids = selected.size ? [...selected] : focused ? [focused] : [];
    if (!ids.length) return;
    edit((d) => (d.fks = d.fks.filter((f) => !ids.includes(f.id))));
    selected = new Set();
  }
  async function removeAll() {
    if (!draft.fks.length) return;
    const ok = await confirmAction({ title: t('fk.removeAllTitle', { count: draft.fks.length }), body: t('fk.removeAllBody'), confirmLabel: t('fk.removeAll'), danger: true });
    if (ok) edit((d) => (d.fks = []));
  }
  function undoSection() {
    edit((d) => (d.fks = clone(original.fks)));
  }

  // --- pickers ---
  let picker = $state<{ kind: 'columns' | 'table' | 'target'; id: string; anchor: HTMLElement } | null>(null);
  let search = $state('');
  const pickerFk = $derived(picker ? draft.fks.find((f) => f.id === picker!.id) : null);
  const tableList = $derived(
    app.tables
      .filter((x) => x.type !== 'VIEW' && (!search.trim() || x.name.toLowerCase().includes(search.trim().toLowerCase())))
      .slice(0, 200),
  );
  function candidatesFor(f: FkModel) {
    const ref = app.schema[f.refTable];
    if (!ref) return [];
    const local = localDef(f.columns[0] ?? '');
    return targetCandidates(local ? { type: local.type, length: local.length, scale: local.scale, unsigned: local.unsigned, collation: local.collation } : null, ref.columns.map((c) => ({ name: c.name, type: c.type, key: c.key })));
  }
  function pickTable(f: FkModel, name: string) {
    patch(f.id, (x) => {
      x.refTable = name;
      const cands = candidatesFor({ ...x, refTable: name });
      const pre = preselect(cands);
      x.refColumns = pre ? [pre] : [];
    });
    picker = null;
  }
  function toggleColumn(f: FkModel, c: string) {
    patch(f.id, (x) => (x.columns = x.columns.includes(c) ? x.columns.filter((y) => y !== c) : [...x.columns, c]));
  }
  function toggleTarget(f: FkModel, c: string) {
    patch(f.id, (x) => (x.refColumns = x.refColumns.includes(c) ? x.refColumns.filter((y) => y !== c) : [...x.refColumns, c]));
  }

  function nullBlocker(f: FkModel) {
    return setNullBlocker(f.columns.map((c) => localDef(c) ?? { name: c, nullable: true }));
  }
  const ruleTip = (r: string) => t(`fk.rule.${r.replace(' ', '_').toLowerCase()}`);

  function viewOrphans(f: FkModel) {
    const orig = f.columns.map((c) => draft.columns.find((x) => x.name === c)?.orig ?? c);
    if (!tabs.create({ sql: orphanQuery(table, orig, f.refTable, f.refColumns), db, autorun: true })) {
      toast(t('tabs.limit', { max: 30 }), 'error');
      return;
    }
    app.view = 'sql';
  }
  function issueText(i: FkIssue): string {
    const p = Object.fromEntries(Object.entries(i.params ?? {}).map(([k, v]) => [k, typeof v === 'number' ? n(v) : String(v)]));
    return t(`fk.issue.${i.code}`, p);
  }

  // --- suggestions and incoming ---
  const declaredCols = $derived(new Set(draft.fks.flatMap((f) => f.columns)));
  const suggestions = $derived(app.relations.filter((r) => r.from === table && r.kind === 'inferred' && !declaredCols.has(r.column)));
  let showSuggestions = $state(false);
  let incoming = $state<(Relation & { count: number; more: boolean })[] | null>(null);
  $effect(() => {
    void table;
    incoming = null;
    editorApi
      .incoming(db, table)
      .then((r) => (incoming = r.incoming))
      .catch(() => (incoming = []));
  });
  const incomingFallback = $derived(app.relations.filter((r) => r.to === table && r.from !== table));
  const incomingList = $derived<(Relation & { count?: number; more?: boolean })[]>(incoming ?? incomingFallback);
  const size = (b: number | null) => formatBytes(b ?? 0, i18n.locale);
</script>

<!-- A) outgoing foreign keys -->
<section class="block" aria-labelledby="fk-title">
  <div class="block-head">
    <div>
      <h2 id="fk-title">{t('fk.title')} <span class="dim">{n(draft.fks.length)}</span></h2>
      <p class="section-help">{t('fk.help')}</p>
    </div>
    {#if editable}
      <div class="v-toolbar__group actions" role="toolbar" aria-label={t('fk.title')}>
        <button class="v-btn-secondary v-btn--sm" onclick={addBlank}>+ {t('fk.add')}</button>
        <button class="v-btn-ghost v-btn--sm" onclick={removeSelected} disabled={!selected.size && !focused}>{t('fk.remove')}</button>
        <button class="v-btn-ghost v-btn--sm" onclick={removeAll} disabled={!draft.fks.length}>{t('fk.removeAll')}</button>
        <button class="v-btn-ghost v-btn--sm" onclick={undoSection} disabled={JSON.stringify(draft.fks.map((f) => [f.orig, f.name, f.columns, f.refTable, f.refColumns, f.onDelete, f.onUpdate])) === JSON.stringify(original.fks.map((f) => [f.orig, f.name, f.columns, f.refTable, f.refColumns, f.onDelete, f.onUpdate]))}>{t('fk.undoSection')}</button>
      </div>
    {/if}
  </div>

  {#if failed && draft.fks.some(changed)}
    <p class="v-banner v-banner--danger check-failed" role="alert">
      {t('fk.checkFailed', { message: failed })}
      <button class="v-btn-secondary v-btn--sm" onclick={runChecks}>{t('common.retry')}</button>
    </p>
  {/if}
  {#if draft.fks.length}
    <div class="fk-grid" role="grid" aria-label={t('fk.title')} aria-busy={checking}>
      <div class="fk-head" role="row">
        <span role="columnheader" class="c-sel"><span class="sr-only">{t('fk.select')}</span></span>
        <span role="columnheader" class="c-state"><span class="sr-only">{t('fk.state')}</span></span>
        <span role="columnheader">{t('editor.idx.name')}</span>
        <span role="columnheader">{t('fk.columns')}</span>
        <span role="columnheader">{t('fk.target')}</span>
        <span role="columnheader">{t('fk.targetColumns')}</span>
        <span role="columnheader">ON UPDATE</span>
        <span role="columnheader">ON DELETE</span>
      </div>
      {#each draft.fks as f (f.id)}
        {@const level = levelOf(f)}
        {@const issues = issuesOf(f)}
        {@const blocker = nullBlocker(f)}
        {@const refInfo = app.tables.find((x) => x.name === f.refTable)}
        <div class="fk-row" data-fk={f.orig ?? f.name} class:new={isNew(f)} class:modified={!isNew(f) && changed(f)} role="row" onfocusin={() => (focused = f.id)}>
          <span role="gridcell" class="c-sel">
            {#if editable}<input type="checkbox" checked={selected.has(f.id)} aria-label={t('fk.selectRow', { name: f.name })} onchange={() => { const s = new Set(selected); s.has(f.id) ? s.delete(f.id) : s.add(f.id); selected = s; }} />{/if}
          </span>
          <span role="gridcell" class="c-state" data-label={t('fk.state')}>
            <span class="state {level}" title={issues.map(issueText).join('\n') || t('fk.ok')} aria-describedby="fk-issues-{f.id}">
              {level === 'error' ? '⛔' : level === 'warn' ? '⚠' : level === 'pending' ? '…' : '✓'}
              <span class="sr-only">{t(`fk.level.${level}`)}</span>
            </span>
          </span>
          <span role="gridcell" data-label={t('editor.idx.name')}>
            {#if editable}
              <input class="cell-input mono" value={f.name} maxlength="64" aria-label={t('editor.idx.name')} onchange={(e) => patch(f.id, (x) => { x.name = (e.currentTarget as HTMLInputElement).value.trim().slice(0, 64); x.autoName = false; })} />
            {:else}<span class="mono">{f.name}</span>{/if}
          </span>
          <span role="gridcell" data-label={t('fk.columns')}>
            <button class="chips-btn" disabled={!editable} onclick={(e) => (picker = { kind: 'columns', id: f.id, anchor: e.currentTarget as HTMLElement })} aria-haspopup="dialog">
              {#each f.columns as c}<span class="chip mono">{c}</span>{:else}<span class="ph">{t('fk.pickColumns')}</span>{/each}
            </button>
          </span>
          <span role="gridcell" data-label={t('fk.target')}>
            <button class="chips-btn" disabled={!editable} onclick={(e) => ((search = ''), (picker = { kind: 'table', id: f.id, anchor: e.currentTarget as HTMLElement }))} aria-haspopup="dialog" title={f.refTable}>
              {#if f.refTable}<span class="mono">{shown(f.refTable)}</span>{#if refInfo && refInfo.engine !== 'InnoDB'} <span class="v-badge v-badge--warning">{refInfo.engine}</span>{/if}{:else}<span class="ph">{t('fk.pickTable')}</span>{/if}
            </button>
          </span>
          <span role="gridcell" data-label={t('fk.targetColumns')}>
            <button class="chips-btn" disabled={!editable || !f.refTable} onclick={(e) => (picker = { kind: 'target', id: f.id, anchor: e.currentTarget as HTMLElement })} aria-haspopup="dialog">
              {#each f.refColumns as c}<span class="chip mono">{c}</span>{:else}<span class="ph">{t('fk.pickColumns')}</span>{/each}
            </button>
          </span>
          {#each ['onUpdate', 'onDelete'] as const as which}
            <span role="gridcell" data-label={which === 'onUpdate' ? 'ON UPDATE' : 'ON DELETE'}>
              {#if editable}
                <Select
                  compact
                  value={f[which]}
                  label={which === 'onUpdate' ? 'ON UPDATE' : 'ON DELETE'}
                  options={RULES.map((r) => ({
                    value: r,
                    label: r,
                    hint: ruleTip(r),
                    disabled: r === 'SET NULL' && blocker ? t('fk.setNullBlocked', { column: blocker }) : r === 'SET DEFAULT' ? t('fk.setDefaultBlocked') : null,
                  }))}
                  onchange={(v) => patch(f.id, (x) => (x[which] = v))}
                />
              {:else}<span class="mono small">{f[which]}</span>{/if}
            </span>
          {/each}
        </div>
        {#if f.columns.some((c) => poly.has(c))}
          <p class="v-banner v-banner--warning poly-note">{t('fk.polymorphicColumn', { column: f.columns.filter((c) => poly.has(c)).join(', ') })}</p>
        {/if}
        {#if issues.length}
          <ul class="issues" id="fk-issues-{f.id}">
            {#each issues as i}
              <li class={i.level}>
                <span aria-hidden="true">{i.level === 'error' ? '⛔' : i.level === 'warn' ? '⚠' : 'ℹ'}</span>
                <span>{issueText(i)}</span>
                {#if i.fix && editable}
                  <button class="v-btn-secondary v-btn--sm" onclick={() => onfixcolumn(i.fix!.column, i.fix!.columnType, i.fix!.collation)}>{t('fk.fixColumn', { column: i.fix.column, type: i.fix.columnType })}</button>
                {/if}
                {#if i.code === 'orphans'}
                  <span class="orphan-actions">
                    <button class="v-btn-ghost v-btn--sm" onclick={() => viewOrphans(f)}>{t('fk.viewRows')}</button>
                    {#if editable}
                      <button class="v-btn-ghost v-btn--sm" aria-pressed={f.fix === 'nullify'} disabled={!i.params?.nullable} title={!i.params?.nullable ? t('fk.nullifyBlocked') : ''} onclick={() => patch(f.id, (x) => (x.fix = x.fix === 'nullify' ? null : 'nullify'))}>{t('fk.nullify')}</button>
                      <button class="v-btn-ghost v-btn--sm danger" aria-pressed={f.fix === 'nocheck'} onclick={() => patch(f.id, (x) => (x.fix = x.fix === 'nocheck' ? null : 'nocheck'))}>{t('fk.noCheck')}</button>
                    {/if}
                  </span>
                  {#if f.fix === 'nocheck'}<p class="v-banner v-banner--danger nocheck" role="alert">{t('fk.noCheckWarn')}</p>{/if}
                  {#if f.fix === 'nullify'}<p class="v-banner v-banner--warning nocheck">{t('fk.nullifyNote', { count: String(i.params?.count ?? '') })}</p>{/if}
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <span id="fk-issues-{f.id}" hidden></span>
        {/if}
      {/each}
    </div>
  {:else}
    <div class="empty">
      <p>{t('fk.empty')}</p>
      {#if editable}
        <button class="v-btn-secondary v-btn--sm" onclick={addBlank}>+ {t('fk.add')}</button>
        {#if suggestions.length}<button class="v-btn-ghost v-btn--sm" onclick={() => (showSuggestions = true)}>{t('fk.seeSuggestions', { count: n(suggestions.length) })}</button>{/if}
      {/if}
    </div>
  {/if}

  <!-- C) inferred suggestions -->
  {#if suggestions.length}
    <details class="suggest" bind:open={showSuggestions}>
      <summary>{t('fk.suggested', { count: n(suggestions.length) })}</summary>
      <ul>
        {#each suggestions as r}
          <li>
            <span class="line dashed" aria-hidden="true"></span>
            <span class="mono">{r.column} → {shown(r.to)}.{r.toColumn}</span>
            <span class="v-badge">{t('relations.kind.inferred')}</span>
            {#if editable}<button class="v-btn-ghost v-btn--sm" onclick={() => fromSuggestion(r)}>{t('fk.createFromSuggestion')}</button>{/if}
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</section>

<!-- B) referenced by -->
<section class="block" aria-labelledby="fkin-title">
  <div class="block-head">
    <div>
      <h2 id="fkin-title">{t('fk.incoming')} <span class="dim">{n(incomingList.length)}</span></h2>
      <p class="section-help">{t('fk.incomingHelp')}</p>
    </div>
  </div>
  {#if incomingList.length}
    <ul class="incoming">
      {#each incomingList as r}
        <li>
          <span class="line" class:dashed={r.kind === 'inferred'} aria-hidden="true"></span>
          <span class="mono"><button class="link" onclick={() => (app.table = r.from)}>{shown(r.from)}</button>.{r.column} → {r.toColumn}</span>
          {#if r.kind === 'inferred'}<span class="v-badge">{t('relations.kind.inferred')}</span>{/if}
          {#if r.kind === 'declared'}<span class="dim small">FK</span>{/if}
          <span class="spacer"></span>
          {#if r.count !== undefined}
            <button class="count" onclick={() => openFiltered(r.from, { [r.column]: '!NULL' })} title={t('fk.openFiltered', { table: r.from })}>
              {t('fk.rowsPointing', { count: n(r.count) + (r.more ? '+' : '') })}
            </button>
          {:else}
            <span class="dim small">{t('common.loading')}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty-line">{t('fk.noIncoming')}</p>
  {/if}
</section>

{#if picker && pickerFk}
  {@const f = pickerFk}
  <Popover anchor={picker.anchor} label={picker.kind === 'table' ? t('fk.target') : t('fk.columns')} onclose={() => (picker = null)} width={picker.kind === 'table' ? 360 : 300}>
    {#if picker.kind === 'columns'}
      <p class="pop-help">{t('fk.columnsHelp')}</p>
      <div class="opts">
        {#each draft.columns as c, ci}
          <button class="opt" aria-pressed={f.columns.includes(c.name)} onclick={() => toggleColumn(f, c.name)} data-autofocus={ci === 0 ? true : undefined}>
            <span class="ord">{f.columns.includes(c.name) ? f.columns.indexOf(c.name) + 1 : ''}</span>
            <span class="mono">{c.name}</span><span class="dim small mono">{parseColumnType(c.type).type}{c.unsigned ? ' unsigned' : ''}</span>
          </button>
        {/each}
      </div>
    {:else if picker.kind === 'table'}
      <input class="v-input search" placeholder={t('fk.searchTable')} bind:value={search} data-autofocus aria-label={t('fk.searchTable')} />
      <div class="opts tables" role="listbox" aria-label={t('fk.target')}>
        {#each tableList as tb}
          <button class="opt" role="option" aria-selected={f.refTable === tb.name} onclick={() => pickTable(f, tb.name)} title={tb.name}>
            <span class="mono name">{shown(tb.name)}</span>
            <span class="dim small">{size(tb.bytes)}</span>
            {#if tb.engine !== 'InnoDB'}<span class="v-badge v-badge--warning" title={t('fk.notInnodb')}>{tb.engine}</span>{:else}<span class="dim small">InnoDB</span>{/if}
          </button>
        {/each}
      </div>
    {:else}
      {@const cands = candidatesFor(f)}
      <p class="pop-help">{t('fk.targetHelp')}</p>
      <div class="opts">
        {#each cands as c, ci}
          <button class="opt" aria-pressed={f.refColumns.includes(c.name)} disabled={!c.compatible} title={c.reason ? t('fk.incompatible', { reason: c.reason }) : ''} onclick={() => toggleTarget(f, c.name)} data-autofocus={ci === 0 ? true : undefined}>
            <span class="ord">{f.refColumns.includes(c.name) ? f.refColumns.indexOf(c.name) + 1 : ''}</span>
            <span class="mono">{c.name}</span>
            <span class="v-badge">{c.key === 'PRI' ? 'PK' : c.key === 'UNI' ? 'UNIQUE' : 'INDEX'}</span>
            <span class="dim small mono">{c.type}</span>
            {#if c.reason}<span class="why">{c.reason}</span>{/if}
          </button>
        {:else}
          <p class="dim small">{t('fk.noCandidates')}</p>
        {/each}
      </div>
    {/if}
  </Popover>
{/if}

<style>
  .check-failed {
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
  }
  .poly-note {
    margin: 0 10px 8px;
    font-size: 12.5px;
  }
  .block {
    display: grid;
    gap: 8px;
  }
  .block-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .section-help {
    margin: 2px 0 0;
    font-size: 12.5px;
    color: var(--sp-text-secondary);
    max-width: 760px;
  }
  .actions {
    flex-wrap: wrap;
    gap: 4px;
  }
  .dim {
    color: var(--sp-text-tertiary);
    font-weight: 400;
  }
  .small {
    font-size: 11.5px;
  }
  .fk-grid {
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
  }
  .fk-head,
  .fk-row {
    display: grid;
    grid-template-columns: 26px 26px minmax(160px, 1.3fr) minmax(120px, 1fr) minmax(150px, 1.1fr) minmax(110px, 0.9fr) 128px 128px;
    gap: 8px;
    align-items: center;
    padding: 0 10px;
    min-height: 40px;
  }
  .fk-head {
    min-height: 32px;
    background: var(--sp-bg-subtle);
    border-bottom: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg) var(--sp-radius-lg) 0 0;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--sp-text-secondary);
  }
  .fk-row {
    border-bottom: 1px solid var(--sp-border);
    box-shadow: inset 3px 0 0 transparent;
  }
  .fk-row.new {
    box-shadow: inset 3px 0 0 var(--sp-success);
  }
  .fk-row.modified {
    box-shadow: inset 3px 0 0 var(--sp-warning);
  }
  .state {
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
    font-size: 12px;
  }
  .state.ok,
  .state.info {
    color: var(--sp-success);
  }
  .state.warn {
    color: var(--sp-warning);
  }
  .state.error {
    color: var(--sp-danger-text);
  }
  .state.pending {
    color: var(--sp-text-tertiary);
  }
  .cell-input {
    width: 100%;
    height: 28px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: var(--sp-radius);
    background: none;
    font-size: 12.5px;
  }
  .cell-input:hover {
    border-color: var(--sp-border-hover);
  }
  .cell-input:focus {
    outline: none;
    border-color: var(--sp-focus);
    background: var(--sp-bg);
  }
  .chips-btn {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    width: 100%;
    min-height: 28px;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: var(--sp-radius);
    background: none;
    text-align: left;
    font-size: 12.5px;
    cursor: pointer;
    overflow: hidden;
  }
  .chips-btn:hover:not(:disabled) {
    border-color: var(--sp-border-hover);
  }
  .chips-btn:disabled {
    cursor: default;
  }
  .chip {
    padding: 1px 8px;
    border: 1px solid var(--sp-border);
    border-radius: 999px;
    background: var(--sp-bg-subtle);
    font-size: 11.5px;
  }
  .ph {
    color: var(--sp-text-tertiary);
    font-style: italic;
  }
  .rule {
    padding: 3px 6px;
    font-size: 12px;
  }
  .issues {
    margin: 0;
    padding: 6px 12px 8px 64px;
    list-style: none;
    display: grid;
    gap: 6px;
    border-bottom: 1px solid var(--sp-border);
    background: var(--sp-bg-subtle);
    font-size: 12.5px;
  }
  .issues li {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .issues li.error {
    color: var(--sp-danger-text);
  }
  .issues li.warn {
    color: var(--sp-warning);
  }
  .issues li.info {
    color: var(--sp-text-secondary);
  }
  .orphan-actions {
    display: inline-flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .danger {
    color: var(--sp-danger);
  }
  [aria-pressed='true'].v-btn-ghost {
    background: var(--sp-bg-muted);
    border-color: var(--sp-border-hover);
  }
  .nocheck {
    flex-basis: 100%;
    margin: 0;
  }
  .empty {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    padding: 12px 14px;
    border: 1px dashed var(--sp-border);
    border-radius: var(--sp-radius-lg);
    font-size: 13px;
  }
  .empty p {
    margin: 0;
    color: var(--sp-text-secondary);
  }
  .empty-line {
    margin: 0;
    color: var(--sp-text-secondary);
    font-size: 13px;
  }
  .suggest {
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
    padding: 0 12px;
  }
  .suggest summary {
    padding: 8px 0;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .suggest ul,
  .incoming {
    margin: 0 0 8px;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 6px;
  }
  .suggest li,
  .incoming li {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 12.5px;
  }
  .line {
    width: 22px;
    border-top: 1.5px solid var(--sp-text-secondary);
    flex-shrink: 0;
  }
  .line.dashed {
    border-top-style: dashed;
  }
  .spacer {
    flex: 1;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--sp-text-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
    font: inherit;
  }
  .count {
    padding: 1px 8px;
    border: 1px solid var(--sp-border);
    border-radius: 999px;
    background: var(--sp-bg);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .count:hover {
    border-color: var(--sp-border-hover);
  }
  .pop-help {
    margin: 0 0 8px;
    font-size: 12px;
    color: var(--sp-text-secondary);
  }
  .search {
    padding: 6px 10px;
    font-size: 13px;
    margin-bottom: 6px;
  }
  .opts {
    display: grid;
    gap: 2px;
    max-height: 300px;
    overflow: auto;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: var(--sp-radius);
    background: none;
    text-align: left;
    font-size: 12.5px;
    cursor: pointer;
  }
  .opt:hover:not(:disabled) {
    background: var(--sp-bg-muted);
  }
  .opt[aria-pressed='true'],
  .opt[aria-selected='true'] {
    border-color: var(--sp-border-hover);
    background: var(--sp-bg-subtle);
  }
  .opt:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .opt .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ord {
    width: 14px;
    font-size: 10.5px;
    font-weight: 700;
  }
  .why {
    margin-left: auto;
    font-size: 11px;
    color: var(--sp-warning);
  }
  @media (max-width: 720px) {
    .fk-grid {
      border: 0;
      display: grid;
      gap: 8px;
    }
    .fk-head {
      display: none;
    }
    .fk-row {
      grid-template-columns: 1fr 1fr;
      gap: 6px 10px;
      padding: 10px 12px;
      border: 1px solid var(--sp-border);
      border-radius: var(--sp-radius-lg);
    }
    .fk-row > [role='gridcell'][data-label]::before {
      content: attr(data-label);
      display: block;
      font-size: 11px;
      color: var(--sp-text-tertiary);
    }
    .issues {
      padding-left: 12px;
      border: 0;
      border-radius: var(--sp-radius);
    }
  }
</style>
