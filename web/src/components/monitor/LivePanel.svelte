<script lang="ts">
  import { formatBytes } from '../../lib/bytes';
  import { i18n, t } from '../../lib/i18n.svelte';
  import { fmtBytesRate, fmtNumber, fmtPct, fmtUptime, type Level } from '../../lib/monitor';
  import { buffer, INTERVALS, mon, setInterval_ } from '../../lib/monitorState.svelte';
  import Chart from './Chart.svelte';

  const loc = $derived(i18n.locale);
  const r = $derived(mon.rates);
  const st = $derived(mon.last?.status ?? {});
  const vars = $derived(mon.last?.variables ?? {});
  const maxConn = $derived(Number(vars.max_connections ?? 0));

  // Charts read the ring buffer; `mon.tick` triggers the refresh.
  const data = $derived.by(() => {
    void mon.tick;
    const s = (m: Parameters<typeof buffer.series>[0]) => buffer.series(m);
    return {
      ts: [...buffer.ts],
      select: s('select'),
      insert: s('insert'),
      update: s('update'),
      delete: s('delete'),
      other: s('other'),
      running: s('threads_running'),
      connected: s('threads_connected'),
      bin: s('bytes_in'),
      bout: s('bytes_out'),
      tmpDisk: s('tmp_disk'),
      sorts: s('sorts'),
      locks: s('row_lock_waits'),
    };
  });

  const rate = (v: number | null) => fmtNumber(v, loc) + '/s';
  const plain = (v: number | null) => fmtNumber(v, loc, 0);

  interface Card {
    label: string;
    value: string;
    sub?: string;
    level: Level;
    message: string;
  }
  const cards = $derived.by((): Card[] => {
    const lv = mon.levels;
    const connected = Number(st.Threads_connected ?? 0);
    return [
      { label: t('monitor.card.qps'), value: r ? fmtNumber(r.qps, loc) : '—', sub: t('monitor.perSecond'), level: 'ok', message: '' },
      {
        label: t('monitor.card.connections'),
        value: fmtNumber(connected, loc, 0),
        sub: t('monitor.card.connectionsSub', { used: fmtNumber(Number(st.Max_used_connections ?? 0), loc, 0), max: fmtNumber(maxConn, loc, 0) }),
        level: lv.connections_pct ?? 'ok',
        message: t('monitor.level.connections', { pct: fmtPct(maxConn ? connected / maxConn : 0, loc, 0) }),
      },
      { label: t('monitor.card.running'), value: fmtNumber(Number(st.Threads_running ?? 0), loc, 0), level: lv.threads_running ?? 'ok', message: t('monitor.level.running') },
      { label: t('monitor.card.slow'), value: r ? fmtNumber(r.slow_per_min, loc) : '—', sub: t('monitor.perMinute'), level: lv.slow_per_min ?? 'ok', message: t('monitor.level.slow') },
      { label: t('monitor.card.bufferPool'), value: r ? fmtPct(r.bp_hit, loc, 2) : '—', sub: t('monitor.card.bufferPoolSub'), level: lv.bp_hit ?? 'ok', message: t('monitor.level.bufferPool') },
      { label: t('monitor.card.uptime'), value: fmtUptime(Number(st.Uptime ?? 0), { d: t('monitor.unit.d'), h: t('monitor.unit.h'), min: t('monitor.unit.min') }), level: 'ok', message: '' },
    ];
  });

  const sys = $derived(mon.last?.system);
</script>

<div class="live">
  <div class="v-toolbar v-toolbar--sub bar" role="toolbar" aria-label={t('monitor.refresh')}>
    <span class="lbl">{t('monitor.refresh')}</span>
    <div class="v-segmented" role="group" aria-label={t('monitor.refresh')}>
      {#each INTERVALS as s}
        <button class="v-segmented__item" aria-pressed={mon.interval === s} onclick={() => setInterval_(s)}>{s} s</button>
      {/each}
    </div>
    <button class="v-btn-ghost v-btn--sm" aria-pressed={mon.paused} onclick={() => (mon.paused = !mon.paused)}>
      {mon.paused ? '▶ ' + t('monitor.resume') : '❚❚ ' + t('monitor.pause')}
    </button>
    <span class="v-toolbar__spacer"></span>
    {#if mon.last}<span class="dim">{t('monitor.queryTime', { ms: fmtNumber(mon.last.ms, loc) })}</span>{/if}
  </div>

  {#if mon.slowNotice}
    <p class="v-banner v-banner--warning notice" role="status">{t('monitor.slowNotice', { ms: fmtNumber(mon.slowNotice.ms, loc, 0), s: mon.slowNotice.interval })}</p>
  {/if}
  {#if mon.error}
    <p class="v-banner v-banner--danger notice" role="alert">{mon.error}</p>
  {/if}

  <div class="cards">
    {#each cards as c}
      <div class="v-card card {c.level}" title={c.level !== 'ok' ? c.message : undefined}>
        <span class="c-label">{c.label}</span>
        <span class="c-value">{c.value}</span>
        {#if c.sub}<span class="c-sub">{c.sub}</span>{/if}
        {#if c.level !== 'ok'}
          <span class="c-flag"><span aria-hidden="true">{c.level === 'crit' ? '⛔' : '⚠'}</span> {c.message}</span>
        {/if}
      </div>
    {/each}
  </div>

  <div class="charts">
    <Chart
      title={t('monitor.chart.qps')}
      ts={data.ts}
      stacked
      format={rate}
      series={[
        { label: 'SELECT', values: data.select, color: '--chart-1' },
        { label: 'INSERT', values: data.insert, color: '--chart-2' },
        { label: 'UPDATE', values: data.update, color: '--chart-3' },
        { label: 'DELETE', values: data.delete, color: '--chart-4' },
        { label: t('monitor.other'), values: data.other, color: '--chart-5' },
      ]}
    />
    <Chart
      title={t('monitor.chart.connections')}
      ts={data.ts}
      format={plain}
      level={mon.levels.connections_pct === 'ok' ? (mon.levels.threads_running ?? 'ok') : (mon.levels.connections_pct ?? 'ok')}
      levelMessage={mon.levels.connections_pct !== 'ok' ? t('monitor.level.connections', { pct: fmtPct(maxConn ? Number(st.Threads_connected ?? 0) / maxConn : 0, loc, 0) }) : t('monitor.level.running')}
      series={[
        { label: t('monitor.connected'), values: data.connected, color: '--chart-1' },
        { label: t('monitor.running'), values: data.running, color: '--chart-4' },
      ]}
    />
    <Chart
      title={t('monitor.chart.traffic')}
      ts={data.ts}
      format={(v) => fmtBytesRate(v, loc)}
      series={[
        { label: t('monitor.in'), values: data.bin, color: '--chart-2' },
        { label: t('monitor.out'), values: data.bout, color: '--chart-1' },
      ]}
    />
    <Chart
      title={t('monitor.chart.tmpSorts')}
      ts={data.ts}
      format={rate}
      level={mon.levels.tmp_disk ?? 'ok'}
      levelMessage={t('monitor.level.tmpDisk')}
      series={[
        { label: t('monitor.tmpDisk'), values: data.tmpDisk, color: '--chart-4' },
        { label: t('monitor.sorts'), values: data.sorts, color: '--chart-3' },
      ]}
    />
    <Chart
      title={t('monitor.chart.locks')}
      ts={data.ts}
      format={rate}
      level={mon.levels.row_lock_waits ?? 'ok'}
      levelMessage={t('monitor.level.locks')}
      series={[{ label: t('monitor.lockWaits'), values: data.locks, color: '--chart-4' }]}
    />
  </div>

  {#if sys && (sys.load || sys.memTotal || sys.diskTotal)}
    <section class="v-card sys" aria-labelledby="sys-title">
      <h3 id="sys-title">{t('monitor.web.title')}</h3>
      <p class="dim">{sys.sameHost ? t('monitor.web.same') : t('monitor.web.other')}</p>
      <dl>
        {#if sys.load}<div><dt>{t('monitor.web.load')}</dt><dd>{sys.load.map((x) => fmtNumber(x, loc, 2)).join(' · ')}</dd></div>{/if}
        {#if sys.memTotal && sys.memAvailable}<div><dt>{t('monitor.web.memory')}</dt><dd>{formatBytes(sys.memTotal - sys.memAvailable, loc)} / {formatBytes(sys.memTotal, loc)}</dd></div>{/if}
        {#if sys.diskTotal && sys.diskFree !== undefined}<div><dt>{t('monitor.web.disk')}</dt><dd>{t('monitor.web.diskFree', { free: formatBytes(sys.diskFree, loc), total: formatBytes(sys.diskTotal, loc) })}</dd></div>{/if}
      </dl>
    </section>
  {/if}
</div>

<style>
  .live {
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
  .lbl,
  .dim {
    color: var(--sp-text-secondary);
    font-size: 12.5px;
  }
  .notice {
    margin: 0;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 10px;
  }
  /* Metric card: spider-ui has none yet (docs/spider-ui-gaps.md). */
  .card {
    display: grid;
    gap: 2px;
    padding: 12px 14px;
  }
  .card.warn {
    border-color: var(--sp-warning-border);
    box-shadow: inset 3px 0 0 var(--sp-warning);
  }
  .card.crit {
    border-color: var(--sp-danger-border);
    box-shadow: inset 3px 0 0 var(--sp-danger);
  }
  .c-label {
    font-size: 12px;
    color: var(--sp-text-secondary);
  }
  .c-value {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.01em;
    font-variant-numeric: tabular-nums;
  }
  .c-sub {
    font-size: 11.5px;
    color: var(--sp-text-tertiary);
  }
  .c-flag {
    font-size: 11.5px;
    margin-top: 2px;
  }
  .warn .c-flag {
    color: var(--sp-warning);
  }
  .crit .c-flag {
    color: var(--sp-danger-text);
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
  .sys {
    padding: 12px 14px;
  }
  .sys h3 {
    margin: 0;
    font-size: 13px;
  }
  .sys p {
    margin: 2px 0 8px;
  }
  .sys dl {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 28px;
    margin: 0;
  }
  .sys dt {
    font-size: 12px;
    color: var(--sp-text-secondary);
  }
  .sys dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
</style>
