<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { ApiError, monitorApi, type Cell, type MissingPrivilege, type ProcessRow } from '../../lib/api';
  import { friendlyError } from '../../lib/errors';
  import { n, t } from '../../lib/i18n.svelte';
  import { mon } from '../../lib/monitorState.svelte';
  import { app } from '../../lib/state.svelte';
  import { tabs } from '../../lib/tabs.svelte';
  import { confirmAction, toast } from '../../lib/ui.svelte';
  import DataGrid from '../DataGrid.svelte';
  import MissingPrivilegeBox from './MissingPrivilege.svelte';

  let rows = $state<ProcessRow[]>([]);
  let selfId = $state(0);
  let limited = $state<MissingPrivilege | null>(null);
  let error = $state('');
  let expanded = $state<Set<number>>(new Set());
  let explain = $state<{ id: number; columns: { name: string; type: string }[]; rows: Cell[][] } | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let alive = true;

  async function load() {
    try {
      const res = await monitorApi.processlist(mon.hideLiterals);
      rows = res.rows;
      selfId = res.selfId;
      limited = res.limited;
      error = '';
    } catch (err) {
      error = err instanceof ApiError ? friendlyError(err).title : String(err);
    }
  }

  async function loop() {
    if (!alive) return;
    if (!mon.paused) await load();
    if (alive) timer = setTimeout(loop, mon.interval * 1000);
  }
  onMount(loop);
  onDestroy(() => {
    alive = false;
    if (timer) clearTimeout(timer);
  });

  const visible = $derived(rows.filter((r) => !mon.hideIdle || (r.command !== 'Sleep' && r.command !== 'Daemon')));
  const isLong = (r: ProcessRow) => r.command !== 'Sleep' && r.time >= mon.longQuerySeconds && !!r.info;

  function toggle(id: number) {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    expanded = next;
  }

  function openInTab(r: ProcessRow) {
    if (!r.info) return;
    if (!tabs.create({ sql: r.info, db: r.db ?? app.db })) {
      toast(t('tabs.limit', { max: 30 }), 'error');
      return;
    }
    app.view = 'sql';
    if (mon.hideLiterals) toast(t('monitor.proc.placeholders'), 'info', 5000);
  }

  async function runExplain(r: ProcessRow) {
    try {
      const res = await monitorApi.explain(r.id);
      explain = { id: r.id, ...res };
    } catch (err) {
      toast(err instanceof ApiError ? (err.code === 'explain_unavailable' ? t('monitor.proc.noExplain') : friendlyError(err).title) : String(err), 'error', 5000);
    }
  }

  async function kill(r: ProcessRow, queryOnly: boolean) {
    if (r.self || r.id === mon.caps?.connectionId) return;
    const ok = await confirmAction({
      title: queryOnly ? t('monitor.proc.killQueryTitle', { id: r.id }) : t('monitor.proc.killTitle', { id: r.id }),
      body: t('monitor.proc.killBody', { user: `${r.user}@${r.host}`, db: r.db ?? '—', time: n(r.time) }) + '\n\n' + (r.info ?? t('monitor.proc.noQuery')).slice(0, 400),
      confirmLabel: queryOnly ? t('monitor.proc.killQuery') : t('monitor.proc.kill'),
      danger: true,
    });
    if (!ok) return;
    try {
      await monitorApi.kill(r.id, queryOnly, selfId);
      toast(queryOnly ? t('monitor.proc.killedQuery', { id: r.id }) : t('monitor.proc.killed', { id: r.id }), 'success');
      load();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'missing_privilege') toast(t('monitor.missing.title', { privilege: String(err.details.privilege ?? '') }) + ' ' + String(err.details.grant ?? ''), 'error', 9000);
      else toast(err instanceof ApiError ? friendlyError(err).title : String(err), 'error', 6000);
    }
  }
</script>

<div class="procs">
  <div class="v-toolbar v-toolbar--sub bar" role="toolbar" aria-label={t('monitor.proc.options')}>
    <label class="opt"><input type="checkbox" bind:checked={mon.hideIdle} /> {t('monitor.proc.hideIdle')}</label>
    <label class="opt"><input type="checkbox" bind:checked={mon.hideLiterals} onchange={load} /> {t('monitor.hideLiterals')}</label>
    <label class="opt">
      {t('monitor.proc.longAfter')}
      <input class="v-input num" type="number" min="1" max="3600" bind:value={mon.longQuerySeconds} aria-label={t('monitor.proc.longAfter')} /> s
    </label>
    <span class="v-toolbar__spacer"></span>
    <span class="dim" aria-live="polite">{t('monitor.proc.count', { count: n(visible.length), total: n(rows.length) })}</span>
  </div>

  {#if limited}
    <MissingPrivilegeBox privilege={limited.privilege} grant={limited.grant} what={t('monitor.proc.limited')} />
  {/if}
  {#if error}<p class="v-banner v-banner--danger" role="alert">{error}</p>{/if}

  <div class="table-wrap">
    <table class="grid list">
      <thead>
        <tr>
          <th class="num">ID</th>
          <th>{t('monitor.proc.user')}</th>
          <th>{t('monitor.proc.host')}</th>
          <th>{t('monitor.proc.db')}</th>
          <th>{t('monitor.proc.command')}</th>
          <th class="num">{t('monitor.proc.time')}</th>
          <th>{t('monitor.proc.state')}</th>
          <th class="q">{t('monitor.proc.query')}</th>
          <th><span class="sr-only">{t('monitor.proc.actions')}</span></th>
        </tr>
      </thead>
      <tbody>
        {#each visible as r (r.id)}
          {@const long = isLong(r)}
          <tr class:long class:self={r.self}>
            <td class="num mono">{r.id}</td>
            <td class="mono">{r.user}</td>
            <td class="mono dim">{r.host}</td>
            <td class="mono">{r.db ?? ''}</td>
            <td>{r.command}</td>
            <td class="num">
              {#if long}<span class="v-badge v-badge--warning" title={t('monitor.proc.longTip', { s: mon.longQuerySeconds })}>⚠ {n(r.time)} s</span>{:else}{n(r.time)} s{/if}
            </td>
            <td class="dim">{r.state ?? ''}</td>
            <td class="q">
              {#if r.info}
                <button class="sql mono" class:open={expanded.has(r.id)} onclick={() => toggle(r.id)} aria-expanded={expanded.has(r.id)} title={t('monitor.proc.expand')}>{r.info}</button>
              {/if}
              {#if r.self}<span class="v-badge">{t('monitor.proc.self')}</span>{/if}
            </td>
            <td class="actions">
              {#if r.info}
                <button class="v-btn-ghost v-btn--sm" onclick={() => openInTab(r)}>{t('monitor.openSql')}</button>
                <button class="v-btn-ghost v-btn--sm" onclick={() => runExplain(r)} disabled={r.command === 'Sleep'}>EXPLAIN</button>
              {/if}
              {#if !r.self && !mon.caps?.readOnly}
                <button class="v-btn-ghost v-btn--sm danger" onclick={() => kill(r, true)} disabled={!r.info}>{t('monitor.proc.killQuery')}</button>
                <button class="v-btn-ghost v-btn--sm danger" onclick={() => kill(r, false)}>{t('monitor.proc.kill')}</button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if !visible.length}<p class="empty">{t('monitor.proc.empty')}</p>{/if}
  </div>

  {#if explain}
    <section class="v-card explain" aria-label="EXPLAIN">
      <header>
        <strong>EXPLAIN · {t('monitor.proc.thread', { id: explain.id })}</strong>
        <button class="v-btn-icon v-btn--sm" onclick={() => (explain = null)} aria-label={t('common.close')}>✕</button>
      </header>
      <div class="explain-grid"><DataGrid columns={explain.columns} rows={explain.rows} label="EXPLAIN" /></div>
    </section>
  {/if}
  <p class="dim note">{t('monitor.proc.note')}</p>
</div>

<style>
  .procs {
    display: grid;
    gap: 10px;
  }
  .bar {
    gap: 14px;
    flex-wrap: wrap;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
    font-size: 13px;
  }
  .opt {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
  }
  .num.v-input {
    width: 64px;
    padding: 3px 6px;
    font-size: 12.5px;
  }
  .dim {
    color: var(--sp-text-tertiary);
  }
  .table-wrap {
    overflow: auto;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
  }
  .list {
    font-family: var(--sp-font);
    font-size: 12.5px;
    width: 100%;
  }
  .list :global(td),
  .list :global(th) {
    max-width: none;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .q {
    width: 40%;
    min-width: 260px;
  }
  tr.long td {
    background: var(--sp-warning-light);
  }
  tr.self td {
    color: var(--sp-text-tertiary);
  }
  .sql {
    display: block;
    width: 100%;
    max-width: 560px;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    color: inherit;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .sql.open {
    white-space: pre-wrap;
    overflow: visible;
    max-width: none;
  }
  .actions {
    white-space: nowrap;
    text-align: right;
  }
  .danger {
    color: var(--sp-danger);
  }
  .empty {
    padding: 16px;
    color: var(--sp-text-tertiary);
    text-align: center;
  }
  .explain header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--sp-border);
  }
  .explain-grid {
    display: flex;
    height: 200px;
  }
  .note {
    margin: 0;
    font-size: 12px;
  }
</style>
