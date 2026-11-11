<script lang="ts">
  import { editorApi } from '../../lib/api';
  import { n, t } from '../../lib/i18n.svelte';
  import { realType } from '../../lib/columnTypes';
  import { uid, type CheckModel, type TableInfo, type TableModel } from '../../lib/tableDraft';
  import CheckExpr from './CheckExpr.svelte';

  let {
    db,
    table,
    draft,
    original,
    editable,
    edit,
    support,
  }: {
    db: string;
    table: string;
    draft: TableModel;
    original: TableModel;
    editable: boolean;
    edit: (fn: (d: TableModel) => void) => void;
    support: TableInfo['checkSupport'];
  } = $props();

  const enabled = $derived(editable && support.supported);
  const changed = (c: CheckModel) => {
    const o = original.checks.find((x) => x.orig === c.orig);
    return !o || o.expr !== c.expr || o.name !== c.name;
  };

  // Live: how many current rows break each new or changed expression.
  let live = $state<Record<string, { ok: boolean; count?: number; more?: boolean; message?: string }>>({});
  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const pending = draft.checks.filter((c) => changed(c) && c.expr.trim()).map((c) => ({ id: c.id, expr: c.expr }));
    clearTimeout(timer);
    if (!pending.length) {
      live = {};
      return;
    }
    timer = setTimeout(async () => {
      try {
        live = (await editorApi.fkChecks(db, table, [], {}, pending)).checks;
      } catch {
        /* checked again in the review */
      }
    }, 500);
  });

  function patch(id: string, fn: (c: CheckModel) => void) {
    edit((d) => {
      const c = d.checks.find((x) => x.id === id);
      if (c) fn(c);
    });
  }
  function add() {
    let i = draft.checks.length + 1;
    while (draft.checks.some((c) => c.name === `chk_${table}_${i}`)) i++;
    edit((d) => d.checks.push({ id: uid('k'), orig: null, name: `chk_${table}_${i}`.slice(0, 64), expr: '' }));
  }
  const cols = $derived(draft.columns.map((c) => ({ name: c.name, type: realType(c) })));
</script>

<section class="block" aria-labelledby="chk-title">
  <div class="block-head">
    <div>
      <h2 id="chk-title">{t('chk.title')} <span class="dim">{n(draft.checks.length)}</span></h2>
      <p class="section-help">{support.supported ? t('chk.help') : t('chk.unsupported', { flavor: support.flavor === 'mariadb' ? 'MariaDB' : 'MySQL', version: support.version, min: support.min })}</p>
    </div>
    {#if enabled}<button class="v-btn-secondary v-btn--sm" onclick={add}>+ {t('chk.add')}</button>{/if}
  </div>

  {#if draft.checks.length}
    <div class="chk-grid" role="grid" aria-label={t('chk.title')}>
      <div class="chk-head" role="row">
        <span role="columnheader">{t('editor.idx.name')}</span>
        <span role="columnheader">{t('chk.expression')}</span>
        <span role="columnheader">{t('chk.rows')}</span>
        <span role="columnheader"><span class="sr-only">{t('monitor.proc.actions')}</span></span>
      </div>
      {#each draft.checks as c (c.id)}
        {@const r = live[c.id]}
        <div class="chk-row" class:new={!c.orig} class:modified={!!c.orig && changed(c)} role="row">
          <span role="gridcell" data-label={t('editor.idx.name')}>
            {#if enabled}
              <input class="cell-input mono" value={c.name} maxlength="64" aria-label={t('editor.idx.name')} onchange={(e) => patch(c.id, (x) => (x.name = (e.currentTarget as HTMLInputElement).value.trim().slice(0, 64)))} />
            {:else}<span class="mono">{c.name}</span>{/if}
          </span>
          <span role="gridcell" data-label={t('chk.expression')}>
            {#if enabled}
              <CheckExpr value={c.expr} columns={cols} mariadb={support.flavor === 'mariadb'} label={t('chk.expressionFor', { name: c.name })} placeholder="price >= 0 AND status IN ('a','b')" invalid={!!r && !r.ok} describedby="chk-msg-{c.id}" onchange={(v) => patch(c.id, (x) => (x.expr = v))} />
            {:else}<code class="mono">{c.expr}</code>{/if}
          </span>
          <span role="gridcell" class="msg" id="chk-msg-{c.id}" data-label={t('chk.rows')} aria-live="polite">
            {#if !changed(c)}<span class="dim">—</span>
            {:else if !c.expr.trim()}<span class="dim">{t('chk.writeExpr')}</span>
            {:else if !r}<span class="dim">{t('fk.level.pending')}</span>
            {:else if !r.ok}<span class="err">⛔ {t('chk.invalid')}{r.message ? ': ' + r.message : ''}</span>
            {:else if r.count}<span class="warn">⚠ {t('chk.violations', { count: n(r.count) + (r.more ? '+' : '') })}</span>
            {:else}<span class="ok">✓ {t('chk.allOk')}</span>{/if}
          </span>
          <span role="gridcell" class="act">
            {#if enabled}<button class="v-btn-icon v-btn--sm danger" onclick={() => edit((d) => (d.checks = d.checks.filter((x) => x.id !== c.id)))} aria-label={t('chk.delete', { name: c.name })} title={t('chk.delete', { name: c.name })}>✕</button>{/if}
          </span>
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty" class:disabled={!support.supported}>
      <p>{support.supported ? t('chk.empty') : t('chk.emptyUnsupported')}</p>
      {#if enabled}<button class="v-btn-secondary v-btn--sm" onclick={add}>+ {t('chk.add')}</button>{/if}
    </div>
  {/if}
</section>

<style>
  .block {
    display: grid;
    gap: 8px;
  }
  .block-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
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
  .dim {
    color: var(--sp-text-tertiary);
    font-weight: 400;
  }
  .chk-grid {
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
  }
  .chk-head,
  .chk-row {
    display: grid;
    grid-template-columns: minmax(150px, 0.8fr) minmax(240px, 2fr) minmax(160px, 1fr) 40px;
    gap: 8px;
    align-items: center;
    min-height: 40px;
    padding: 0 10px;
  }
  .chk-head {
    min-height: 32px;
    background: var(--sp-bg-subtle);
    border-bottom: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg) var(--sp-radius-lg) 0 0;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--sp-text-secondary);
  }
  .chk-row {
    border-bottom: 1px solid var(--sp-border);
  }
  .chk-row:last-child {
    border-bottom: 0;
  }
  .chk-row.new {
    box-shadow: inset 3px 0 0 var(--sp-success);
  }
  .chk-row.modified {
    box-shadow: inset 3px 0 0 var(--sp-warning);
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
  }
  code {
    font-size: 12px;
  }
  .msg {
    font-size: 12px;
  }
  .ok {
    color: var(--sp-success);
  }
  .warn {
    color: var(--sp-warning);
  }
  .err {
    color: var(--sp-danger-text);
  }
  .act {
    text-align: right;
  }
  .danger {
    color: var(--sp-danger);
  }
  .empty {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 12px 14px;
    border: 1px dashed var(--sp-border);
    border-radius: var(--sp-radius-lg);
    font-size: 13px;
  }
  .empty p {
    margin: 0;
    color: var(--sp-text-secondary);
  }
  .empty.disabled {
    opacity: 0.7;
  }
  @media (max-width: 720px) {
    .chk-grid {
      border: 0;
      display: grid;
      gap: 8px;
    }
    .chk-head {
      display: none;
    }
    .chk-row {
      grid-template-columns: 1fr;
      padding: 10px 12px;
      border: 1px solid var(--sp-border);
      border-radius: var(--sp-radius-lg);
    }
    .chk-row > [role='gridcell'][data-label]::before {
      content: attr(data-label);
      display: block;
      font-size: 11px;
      color: var(--sp-text-tertiary);
    }
  }
</style>
