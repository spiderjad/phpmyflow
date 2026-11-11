<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError, monitorApi, type AiResult, type Cell, type DigestRow, type TopQueries } from '../../lib/api';
  import { friendlyError } from '../../lib/errors';
  import { i18n, n, t } from '../../lib/i18n.svelte';
  import { fmtCompact, fmtMs } from '../../lib/monitor';
  import { mon } from '../../lib/monitorState.svelte';
  import { tableRefs } from '../../lib/sqlRules';
  import { app } from '../../lib/state.svelte';
  import { tabs } from '../../lib/tabs.svelte';
  import { confirmAction, toast } from '../../lib/ui.svelte';
  import DataGrid from '../DataGrid.svelte';
  import MissingPrivilegeBox from './MissingPrivilege.svelte';

  const SORTS = ['total', 'avg', 'count', 'examined', 'ratio', 'noindex', 'tmpdisk'] as const;
  let sort = $state<(typeof SORTS)[number]>('total');
  let data = $state<TopQueries | null>(null);
  let loading = $state(false);
  let error = $state('');
  let expanded = $state<Set<string>>(new Set());
  let explain = $state<{ digest: string; columns: { name: string; type: string }[]; rows: Cell[][] } | null>(null);
  let ai = $state<{ digest: string; busy: boolean; result: AiResult | null; error: string } | null>(null);

  async function load() {
    loading = true;
    try {
      data = await monitorApi.topQueries(sort);
      error = '';
    } catch (err) {
      error = err instanceof ApiError ? friendlyError(err).title : String(err);
    } finally {
      loading = false;
    }
  }
  onMount(load);

  const loc = $derived(i18n.locale);
  const tablesOf = (text: string) => {
    try {
      return [...new Set(tableRefs(text).map((r) => r.table))].slice(0, 4);
    } catch {
      return [];
    }
  };
  const ratio = (d: DigestRow) => (d.sent ? d.examined / d.sent : d.examined);

  function toggle(d: string) {
    const next = new Set(expanded);
    next.has(d) ? next.delete(d) : next.add(d);
    expanded = next;
  }

  function openInTab(d: DigestRow) {
    if (!tabs.create({ sql: d.text, db: d.db ?? app.db })) {
      toast(t('tabs.limit', { max: 30 }), 'error');
      return;
    }
    app.view = 'sql';
    toast(t('monitor.proc.placeholders'), 'info', 5000);
  }

  async function runExplain(d: DigestRow) {
    try {
      const res = await monitorApi.digest(d.digest);
      if (!res.explain) {
        toast(t('monitor.top.noSample'), 'info', 6000);
        return;
      }
      explain = { digest: d.digest, ...res.explain };
    } catch (err) {
      toast(err instanceof ApiError ? friendlyError(err).title : String(err), 'error', 5000);
    }
  }

  async function optimize(d: DigestRow) {
    ai = { digest: d.digest, busy: true, result: null, error: '' };
    try {
      const result = await api.ai({ db: d.db ?? app.db, mode: 'optimize_digest', lang: i18n.locale, prompt: d.digest });
      if (ai?.digest === d.digest) ai = { ...ai, busy: false, result };
    } catch (err) {
      if (ai?.digest === d.digest) ai = { ...ai, busy: false, error: err instanceof ApiError ? friendlyError(err).title : String(err) };
    }
  }

  async function reset() {
    const ok = await confirmAction({ title: t('monitor.top.resetTitle'), body: t('monitor.top.resetBody'), confirmLabel: t('monitor.top.reset'), danger: true });
    if (!ok) return;
    try {
      await monitorApi.resetDigests();
      toast(t('monitor.top.resetDone'), 'success');
      load();
    } catch (err) {
      toast(err instanceof ApiError ? friendlyError(err).title : String(err), 'error', 6000);
    }
  }

  const flavor = $derived(mon.caps?.flavor ?? 'mysql');
</script>

<div class="top">
  {#if error}<p class="v-banner v-banner--danger" role="alert">{error}</p>{/if}

  {#if data && !data.available}
    {#if data.reason === 'missing_privilege' && data.missing}
      <MissingPrivilegeBox privilege={data.missing.privilege} grant={data.missing.grant} what={t('monitor.top.needsPs')} />
    {:else}
      <div class="v-banner v-banner--info">
        <p><strong>{t('monitor.ps.off')}</strong> {flavor === 'mariadb' ? t('monitor.ps.offMariadb') : t('monitor.ps.offMysql')}</p>
        <pre class="mono">[mysqld]
performance_schema = ON</pre>
        <p class="small">{t('monitor.ps.restart')}</p>
      </div>
    {/if}
    <section class="v-card slow">
      <h3>{t('monitor.slow.title')}</h3>
      <dl>
        <div><dt>{t('monitor.slow.status')}</dt><dd>{data.slowLog.enabled ? '✓ ' + t('monitor.slow.on') : '✕ ' + t('monitor.slow.off')}</dd></div>
        <div><dt>{t('monitor.slow.threshold')}</dt><dd>{fmtMs(data.slowLog.longQueryTime * 1000, loc)}</dd></div>
        <div><dt>{t('monitor.slow.file')}</dt><dd class="mono">{data.slowLog.file || '—'} ({data.slowLog.output})</dd></div>
      </dl>
      {#if !data.slowLog.enabled}
        <p class="small">{t('monitor.slow.how')}</p>
        <pre class="mono">SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 1;</pre>
      {/if}
    </section>
  {:else if data}
    <div class="v-toolbar v-toolbar--sub bar" role="toolbar" aria-label={t('monitor.top.sortBy')}>
      <label class="opt">
        {t('monitor.top.sortBy')}
        <select class="v-input sel" bind:value={sort} onchange={load}>
          {#each SORTS as s}<option value={s}>{t(`monitor.top.sort.${s}`)}</option>{/each}
        </select>
      </label>
      <button class="v-btn-ghost v-btn--sm" onclick={load} disabled={loading}>{t('common.refresh')}</button>
      <span class="v-toolbar__spacer"></span>
      {#if data.canReset && !mon.caps?.readOnly}
        <button class="v-btn-ghost v-btn--sm danger" onclick={reset}>{t('monitor.top.reset')}</button>
      {/if}
    </div>

    <div class="table-wrap">
      <table class="grid list">
        <thead>
          <tr>
            <th class="q">{t('monitor.top.query')}</th>
            <th class="num">{t('monitor.top.count')}</th>
            <th class="num">{t('monitor.top.avg')}</th>
            <th class="num">p95</th>
            <th class="num">{t('monitor.top.max')}</th>
            <th class="num">{t('monitor.top.total')}</th>
            <th class="num" title={t('monitor.top.ratioTip')}>{t('monitor.top.ratio')}</th>
            <th class="num">{t('monitor.top.noIndex')}</th>
            <th class="num">{t('monitor.top.tmpDisk')}</th>
            <th><span class="sr-only">{t('monitor.proc.actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {#each data.rows ?? [] as d (d.digest)}
            {@const tbls = tablesOf(d.text)}
            <tr>
              <td class="q">
                <button class="sql mono" class:open={expanded.has(d.digest)} onclick={() => toggle(d.digest)} aria-expanded={expanded.has(d.digest)}>{d.text}</button>
                <span class="meta">
                  {#if d.db}<span class="v-badge mono">{d.db}</span>{/if}
                  {#each tbls as tb}<span class="v-badge mono">{tb}</span>{/each}
                </span>
              </td>
              <td class="num">{fmtCompact(d.count, loc)}</td>
              <td class="num">{fmtMs(d.avg, loc)}</td>
              <td class="num">{d.p95 === null ? '—' : fmtMs(d.p95, loc)}</td>
              <td class="num">{fmtMs(d.max, loc)}</td>
              <td class="num strong">{fmtMs(d.total, loc)}</td>
              <td class="num" class:bad={ratio(d) > 100}>{fmtCompact(ratio(d), loc)}</td>
              <td class="num" class:bad={d.noIndex + d.noGoodIndex > 0}>{fmtCompact(d.noIndex + d.noGoodIndex, loc)}</td>
              <td class="num" class:bad={d.tmpDisk > 0}>{fmtCompact(d.tmpDisk, loc)}</td>
              <td class="actions">
                <button class="v-btn-ghost v-btn--sm" onclick={() => openInTab(d)}>{t('monitor.openSql')}</button>
                <button class="v-btn-ghost v-btn--sm" onclick={() => runExplain(d)}>EXPLAIN</button>
                {#if app.session?.ai}<button class="v-btn-ai v-btn--sm" onclick={() => optimize(d)}>✦ {t('monitor.top.optimize')}</button>{/if}
              </td>
            </tr>
            {#if ai?.digest === d.digest}
              <tr class="ai-row">
                <td colspan="10">
                  <div class="ai-box">
                    {#if ai.busy}<p>{t('ai.thinking')}</p>{/if}
                    {#if ai.error}<p class="err">{ai.error}</p>{/if}
                    {#if ai.result}
                      {#if ai.result.explanation}<p>{ai.result.explanation}</p>{/if}
                      {#if ai.result.warnings.length}<ul>{#each ai.result.warnings as w}<li>{w}</li>{/each}</ul>{/if}
                      {#if ai.result.sql}<pre class="mono">{ai.result.sql}</pre>{/if}
                      <p class="small">{t('ai.neverRuns')}</p>
                    {/if}
                    <button class="v-btn-ghost v-btn--sm" onclick={() => (ai = null)}>{t('common.close')}</button>
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
      {#if !(data.rows ?? []).length}<p class="empty">{t('monitor.top.empty')}</p>{/if}
    </div>

    {#if explain}
      <section class="v-card explain" aria-label="EXPLAIN">
        <header>
          <strong>EXPLAIN</strong>
          <button class="v-btn-icon v-btn--sm" onclick={() => (explain = null)} aria-label={t('common.close')}>✕</button>
        </header>
        <div class="explain-grid"><DataGrid columns={explain.columns} rows={explain.rows} label="EXPLAIN" /></div>
      </section>
    {/if}
    <p class="note">{t('monitor.top.note', { count: n((data.rows ?? []).length) })}</p>
  {:else}
    <p class="empty">{t('common.loading')}</p>
  {/if}
</div>

<style>
  .top {
    display: grid;
    gap: 10px;
  }
  .bar {
    gap: 10px;
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
  .sel {
    width: auto;
    padding: 3px 8px;
    font-size: 12.5px;
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
  .strong {
    font-weight: 600;
  }
  .bad {
    color: var(--sp-warning);
    font-weight: 600;
  }
  .q {
    min-width: 320px;
    width: 42%;
  }
  .sql {
    display: block;
    width: 100%;
    max-width: 620px;
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
    max-width: none;
  }
  .meta {
    display: inline-flex;
    gap: 4px;
    flex-wrap: wrap;
    margin-top: 3px;
  }
  .actions {
    white-space: nowrap;
    text-align: right;
  }
  .danger {
    color: var(--sp-danger);
  }
  .ai-row td {
    white-space: normal;
    background: var(--ai-light);
  }
  .ai-box {
    display: grid;
    gap: 6px;
    padding: 6px 2px;
  }
  .ai-box p,
  .ai-box ul {
    margin: 0;
  }
  .ai-box pre,
  pre {
    margin: 0;
    padding: 8px 10px;
    border-radius: var(--sp-radius);
    background: var(--sp-bg);
    border: 1px solid var(--sp-border);
    font-size: 12px;
    white-space: pre-wrap;
  }
  .err {
    color: var(--sp-danger);
  }
  .small,
  .note {
    margin: 0;
    font-size: 12px;
    color: var(--sp-text-secondary);
  }
  .slow {
    padding: 12px 14px;
  }
  .slow h3 {
    margin: 0 0 8px;
    font-size: 13px;
  }
  .slow dl {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 28px;
    margin: 0 0 8px;
  }
  .slow dt {
    font-size: 12px;
    color: var(--sp-text-secondary);
  }
  .slow dd {
    margin: 0;
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
  .empty {
    padding: 16px;
    color: var(--sp-text-tertiary);
    text-align: center;
  }
  .v-banner p {
    margin: 0 0 6px;
  }
</style>
