<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError, monitorApi, type AiResult, type MonitorHistory, type PeakDetail } from '../../lib/api';
  import { copyText } from '../../lib/clipboard';
  import { friendlyError } from '../../lib/errors';
  import { i18n, n, t } from '../../lib/i18n.svelte';
  import { fmtBytesRate, fmtNumber } from '../../lib/monitor';
  import { app } from '../../lib/state.svelte';
  import { toast } from '../../lib/ui.svelte';
  import Chart, { type ChartSeries } from './Chart.svelte';

  const RANGES = [
    { id: '1h', s: 3600 },
    { id: '24h', s: 86400 },
    { id: '7d', s: 7 * 86400 },
    { id: '30d', s: 30 * 86400 },
    { id: '90d', s: 90 * 86400 },
  ] as const;

  let range = $state<string>('24h');
  let customFrom = $state('');
  let customTo = $state('');
  let compare = $state(false);
  let data = $state<MonitorHistory | null>(null);
  let loading = $state(false);
  let error = $state('');
  let peak = $state<PeakDetail | null>(null);
  let ai = $state<{ busy: boolean; result: AiResult | null; error: string } | null>(null);

  const loc = $derived(i18n.locale);
  const now = () => Math.floor(Date.now() / 1000);

  function bounds(): [number, number] {
    if (range === 'custom' && customFrom && customTo) return [Math.floor(new Date(customFrom).getTime() / 1000), Math.floor(new Date(customTo).getTime() / 1000)];
    const r = RANGES.find((x) => x.id === range) ?? RANGES[1];
    return [now() - r.s, now()];
  }

  async function load() {
    loading = true;
    try {
      const [from, to] = bounds();
      data = await monitorApi.history(from, to, compare);
      error = '';
    } catch (err) {
      error = err instanceof ApiError ? friendlyError(err).title : String(err);
    } finally {
      loading = false;
    }
  }
  onMount(load);

  function pick(id: string) {
    range = id;
    if (id !== 'custom') load();
  }

  const s = (m: string) => data?.series[m] ?? [];
  const c = (m: string) => data?.compare?.series[m] ?? [];
  const peaks = $derived((data?.peaks ?? []).map((p) => ({ id: p.id, ts: p.ts })));
  const prevLabel = $derived(t('monitor.history.prevWeek'));

  /** Compare series are re-sampled onto the main timestamps (nearest point). */
  function aligned(m: string): (number | null)[] {
    if (!data?.compare) return [];
    const cts = data.compare.ts;
    const cv = c(m);
    return data.ts.map((x) => {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < cts.length; i++) {
        const d = Math.abs(cts[i] - x);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best >= 0 && bestD < 7200 ? cv[best] : null;
    });
  }

  function withCompare(main: ChartSeries[], metric: string): ChartSeries[] {
    if (!compare || !data?.compare) return main;
    return [...main, { label: `${main[0].label} (${prevLabel})`, values: aligned(metric), color: main[0].color, dashed: true }];
  }

  async function openPeak(id: string) {
    ai = null;
    try {
      peak = await monitorApi.peak(id);
    } catch (err) {
      toast(err instanceof ApiError ? friendlyError(err).title : String(err), 'error');
    }
  }

  async function explainPeak() {
    if (!peak) return;
    ai = { busy: true, result: null, error: '' };
    try {
      const result = await api.ai({ db: app.db || peak.snapshot.processes.find((p) => p.db)?.db || 'information_schema', mode: 'peak', lang: i18n.locale, prompt: peak.id });
      ai = { busy: false, result, error: '' };
    } catch (err) {
      ai = { busy: false, result: null, error: err instanceof ApiError ? friendlyError(err).title : String(err) };
    }
  }

  async function copy(text: string) {
    toast((await copyText(text)) ? t('copy.cell') : t('copy.failed'), 'info', 1800);
  }

  const rate = (v: number | null) => fmtNumber(v, loc) + '/s';
  const plain = (v: number | null) => fmtNumber(v, loc, 0);
  const collector = $derived(data?.collector);
  const empty = $derived(!!data && !data.ts.length);
  const metricLabel = (m: string) => t(`monitor.metric.${m}`);
  const fmtTime = (ts: number) => new Date(ts * 1000).toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<div class="history">
  <div class="v-toolbar v-toolbar--sub bar" role="toolbar" aria-label={t('monitor.history.range')}>
    <div class="v-segmented" role="group" aria-label={t('monitor.history.range')}>
      {#each RANGES as r}
        <button class="v-segmented__item" aria-pressed={range === r.id} onclick={() => pick(r.id)}>{t(`monitor.history.r.${r.id}`)}</button>
      {/each}
      <button class="v-segmented__item" aria-pressed={range === 'custom'} onclick={() => pick('custom')}>{t('monitor.history.custom')}</button>
    </div>
    {#if range === 'custom'}
      <input class="v-input dt" type="datetime-local" bind:value={customFrom} aria-label={t('monitor.history.from')} />
      <input class="v-input dt" type="datetime-local" bind:value={customTo} aria-label={t('monitor.history.to')} />
      <button class="v-btn-secondary v-btn--sm" onclick={load} disabled={!customFrom || !customTo}>{t('monitor.history.apply')}</button>
    {/if}
    <label class="opt"><input type="checkbox" bind:checked={compare} onchange={load} /> {t('monitor.history.compare')}</label>
    <span class="v-toolbar__spacer"></span>
    {#if data}<span class="dim">{data.resolution === 'hour' ? t('monitor.history.hourly') : t('monitor.history.minutely')}</span>{/if}
    <button class="v-btn-ghost v-btn--sm" onclick={load} disabled={loading}>{t('common.refresh')}</button>
  </div>
  {#if error}<p class="v-banner v-banner--danger" role="alert">{error}</p>{/if}

  {#if empty && collector}
    <section class="v-card setup">
      <h3>{collector.lastRun ? t('monitor.history.noData') : t('monitor.history.notConfigured')}</h3>
      {#if collector.lastRun}
        <p class="small">{t('monitor.history.lastRun', { time: fmtTime(collector.lastRun) })}</p>
      {:else}
        <ol>
          <li>
            <p>{t('monitor.history.step1')}</p>
            <pre class="mono">'monitor' => ['host' => '127.0.0.1', 'port' => 3306, 'user' => 'phpmyflow_monitor', 'password' => '…'],</pre>
          </li>
          <li>
            <p>{t('monitor.history.step2')}</p>
            <div class="cmd"><code>{collector.cron}</code><button class="v-btn-secondary v-btn--sm" onclick={() => copy(collector.cron)}>{t('common.copy')}</button></div>
          </li>
          <li>
            <p>{t('monitor.history.step3')}</p>
            <pre class="mono">'monitor_pseudo_cron' => true,</pre>
          </li>
        </ol>
        <p class="small">{collector.sqlite ? t('monitor.history.sqlite') : t('monitor.history.jsonl')}</p>
      {/if}
      {#if collector.monitorServer && collector.server && collector.monitorServer !== collector.server}
        <p class="v-banner v-banner--info">{t('monitor.history.otherServer', { monitored: collector.monitorServer, current: collector.server })}</p>
      {/if}
    </section>
  {:else if data}
    {#if data.peaks.length}
      <p class="small">{t('monitor.history.peaksHelp', { count: n(data.peaks.length) })}</p>
    {/if}
    <div class="charts">
      <Chart title={t('monitor.chart.qpsTotal')} ts={data.ts} format={rate} {peaks} onpeak={openPeak}
        series={withCompare([{ label: t('monitor.metric.qps'), values: s('qps'), color: '--chart-1' }, { label: 'SELECT', values: s('select'), color: '--chart-2' }], 'qps')} />
      <Chart title={t('monitor.chart.connections')} ts={data.ts} format={plain} {peaks} onpeak={openPeak}
        series={withCompare([{ label: t('monitor.running'), values: s('threads_running'), color: '--chart-4' }, { label: t('monitor.connected'), values: s('threads_connected'), color: '--chart-1' }], 'threads_running')} />
      <Chart title={t('monitor.chart.traffic')} ts={data.ts} format={(v) => fmtBytesRate(v, loc)} {peaks} onpeak={openPeak}
        series={withCompare([{ label: t('monitor.out'), values: s('bytes_out'), color: '--chart-1' }, { label: t('monitor.in'), values: s('bytes_in'), color: '--chart-2' }], 'bytes_out')} />
      <Chart title={t('monitor.chart.tmpSorts')} ts={data.ts} format={rate} {peaks} onpeak={openPeak}
        series={withCompare([{ label: t('monitor.tmpDisk'), values: s('tmp_disk'), color: '--chart-4' }, { label: t('monitor.sorts'), values: s('sorts'), color: '--chart-3' }], 'tmp_disk')} />
      <Chart title={t('monitor.chart.locks')} ts={data.ts} format={rate} {peaks} onpeak={openPeak}
        series={withCompare([{ label: t('monitor.lockWaits'), values: s('row_lock_waits'), color: '--chart-4' }], 'row_lock_waits')} />
    </div>

    <section class="v-card block" aria-labelledby="peaks-title">
      <h3 id="peaks-title">{t('monitor.history.peaks')}</h3>
      {#if data.peaks.length}
        <ul class="peaks">
          {#each [...data.peaks].reverse() as p}
            <li>
              <button class="peak-btn" onclick={() => openPeak(p.id)}>
                <span class="dot" aria-hidden="true"></span>
                <span class="when">{fmtTime(p.ts)}</span>
                <span>{p.peaks.map((x) => `${metricLabel(x.metric)} ${fmtNumber(x.value, loc)} (> ${fmtNumber(x.threshold, loc)})`).join(' · ')}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="dim">{t('monitor.history.noPeaks')}</p>
      {/if}
    </section>
  {:else}
    <p class="dim">{t('common.loading')}</p>
  {/if}
</div>

{#if peak}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <aside class="drawer" aria-labelledby="peak-title" onkeydown={(e) => e.key === 'Escape' && (peak = null)}>
    <header>
      <h2 id="peak-title">{t('monitor.peak.title', { time: fmtTime(peak.ts) })}</h2>
      <button class="v-btn-icon v-btn--sm" onclick={() => (peak = null)} aria-label={t('common.close')}>✕</button>
    </header>
    <div class="drawer-body">
      <section>
        <h3>{t('monitor.peak.triggered')}</h3>
        <ul>{#each peak.peaks as p}<li><strong>{metricLabel(p.metric)}</strong>: {fmtNumber(p.value, loc)} <span class="dim">({t('monitor.peak.threshold', { v: fmtNumber(p.threshold, loc) })})</span></li>{/each}</ul>
      </section>
      <section>
        <h3>{t('monitor.peak.processes', { count: n(peak.snapshot.processes.length) })}</h3>
        {#if peak.snapshot.processes.length}
          <table class="grid list">
            <thead><tr><th>{t('monitor.proc.user')}</th><th>{t('monitor.proc.db')}</th><th class="num">{t('monitor.proc.time')}</th><th>{t('monitor.proc.query')}</th></tr></thead>
            <tbody>
              {#each peak.snapshot.processes.slice(0, 50) as p}
                <tr><td class="mono">{p.user}</td><td class="mono">{p.db ?? ''}</td><td class="num">{n(p.time)} s</td><td class="mono q">{p.info ?? p.state ?? ''}</td></tr>
              {/each}
            </tbody>
          </table>
        {:else}<p class="dim">{t('monitor.peak.noProcesses')}</p>{/if}
      </section>
      <section>
        <h3>{t('monitor.peak.digests')}</h3>
        {#if peak.snapshot.digests.length}
          <ol class="digests">
            {#each peak.snapshot.digests as d}
              <li><code class="mono">{d.text}</code><span class="dim"> · {n(d.count)}× · {fmtNumber(d.total, loc, 0)} ms</span></li>
            {/each}
          </ol>
        {:else}<p class="dim">{t('monitor.peak.noDigests')}</p>{/if}
      </section>
      {#if app.session?.ai}
        <section>
          <button class="v-btn-ai" onclick={explainPeak} disabled={ai?.busy}>✦ {t('monitor.peak.explain')}</button>
          <p class="small">{t('monitor.peak.explainNote')}</p>
          {#if ai?.busy}<p>{t('ai.thinking')}</p>{/if}
          {#if ai?.error}<p class="err">{ai.error}</p>{/if}
          {#if ai?.result}
            <div class="ai-box">
              <p>{ai.result.explanation}</p>
              {#if ai.result.warnings.length}<ul>{#each ai.result.warnings as w}<li>{w}</li>{/each}</ul>{/if}
              {#if ai.result.sql}<pre class="mono">{ai.result.sql}</pre>{/if}
            </div>
          {/if}
        </section>
      {/if}
    </div>
  </aside>
{/if}

<style>
  .history {
    display: grid;
    gap: 12px;
  }
  .bar {
    gap: 8px;
    flex-wrap: wrap;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
    font-size: 13px;
  }
  .dt {
    width: auto;
    padding: 3px 6px;
    font-size: 12.5px;
  }
  .opt {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    font-size: 12.5px;
  }
  .dim {
    color: var(--sp-text-tertiary);
  }
  .small {
    margin: 0;
    font-size: 12.5px;
    color: var(--sp-text-secondary);
  }
  .charts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
    gap: 12px;
  }
  @media (max-width: 520px) {
    .charts {
      grid-template-columns: 1fr;
    }
  }
  .setup,
  .block {
    padding: 14px 16px;
  }
  .setup h3,
  .block h3 {
    margin: 0 0 8px;
    font-size: 14px;
  }
  .setup ol {
    margin: 0 0 8px;
    padding-left: 20px;
    display: grid;
    gap: 8px;
  }
  .setup p {
    margin: 0 0 4px;
  }
  pre,
  .cmd code {
    margin: 0;
    padding: 6px 8px;
    border-radius: var(--sp-radius);
    background: var(--sp-bg-subtle);
    border: 1px solid var(--sp-border);
    font-family: var(--sp-font-mono);
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .cmd {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .cmd code {
    flex: 1;
  }
  .peaks {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 2px;
  }
  .peak-btn {
    display: flex;
    gap: 10px;
    align-items: center;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--sp-radius);
    background: none;
    text-align: left;
    font-size: 12.5px;
    color: var(--sp-text-primary);
    cursor: pointer;
  }
  .peak-btn:hover {
    background: var(--sp-bg-muted);
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--sp-danger);
    flex-shrink: 0;
  }
  .when {
    font-variant-numeric: tabular-nums;
    color: var(--sp-text-secondary);
    white-space: nowrap;
  }
  /* Drawer: spider-ui has none yet (docs/spider-ui-gaps.md). */
  .drawer {
    position: fixed;
    top: 48px;
    right: 0;
    bottom: 0;
    width: min(560px, 100vw);
    display: flex;
    flex-direction: column;
    background: var(--sp-bg);
    border-left: 1px solid var(--sp-border);
    box-shadow: var(--sp-shadow-lg);
    z-index: 30;
  }
  .drawer header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px 10px 16px;
    border-bottom: 1px solid var(--sp-border);
  }
  .drawer h2 {
    margin: 0;
    font-size: 14px;
  }
  .drawer-body {
    overflow: auto;
    padding: 12px 16px 24px;
    display: grid;
    gap: 16px;
  }
  .drawer h3 {
    margin: 0 0 6px;
    font-size: 13px;
  }
  .drawer ul {
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
  }
  .list {
    width: 100%;
    font-family: var(--sp-font);
    font-size: 12px;
  }
  .list :global(td.q) {
    white-space: normal;
    max-width: 260px;
  }
  .num {
    text-align: right;
  }
  .digests {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 6px;
    font-size: 12px;
  }
  .digests code {
    font-size: 11.5px;
    word-break: break-word;
  }
  .ai-box {
    display: grid;
    gap: 6px;
    margin-top: 8px;
    padding: 10px 12px;
    border-radius: var(--sp-radius);
    background: var(--ai-light);
  }
  .ai-box p {
    margin: 0;
  }
  .err {
    color: var(--sp-danger);
  }
</style>
