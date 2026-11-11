<script lang="ts" module>
  export interface ChartSeries {
    label: string;
    values: (number | null)[];
    /** CSS variable with the color, e.g. "--chart-1". */
    color: string;
    dashed?: boolean;
  }
</script>

<script lang="ts">
  import { onThemeChange } from '../../lib/theme';
  import { onDestroy, untrack } from 'svelte';
  import { i18n, t } from '../../lib/i18n.svelte';
  import type { Level } from '../../lib/monitor';

  let {
    title,
    ts,
    series,
    format,
    stacked = false,
    height = 180,
    level = 'ok',
    levelMessage = '',
    peaks = [],
    onpeak,
  }: {
    title: string;
    /** Unix seconds. */
    ts: number[];
    series: ChartSeries[];
    format: (v: number | null) => string;
    stacked?: boolean;
    height?: number;
    level?: Level;
    levelMessage?: string;
    peaks?: { id: string; ts: number }[];
    onpeak?: (id: string) => void;
  } = $props();

  let host: HTMLDivElement | undefined = $state();
  let plot: any = null;
  let UPlot: any = null;
  let asTable = $state(false);
  let failed = $state(false);
  /** Real (unstacked) values, read by the legend formatter. */
  let rawData: (number | null)[][] = [];

  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

  /** Cumulative sums for a stacked chart (bottom series first). */
  function stack(values: (number | null)[][]): (number | null)[][] {
    const out: (number | null)[][] = [];
    values.forEach((v, i) => {
      out.push(v.map((x, k) => (x === null ? null : x + (i ? (out[i - 1][k] ?? 0) : 0))));
    });
    return out;
  }

  function build() {
    if (!host || !UPlot) return;
    plot?.destroy();
    rawData = series.map((s) => s.values);
    const drawn = stacked ? stack(rawData) : rawData;
    const textColor = css('--sp-text-secondary');
    const grid = css('--chart-grid');
    const opts = {
      width: host.clientWidth || 600,
      height,
      padding: [8, 8, 0, 0],
      legend: { show: true, live: true },
      cursor: { drag: { x: true, y: false }, points: { size: 6 } },
      scales: { x: { time: true } },
      axes: [
        { stroke: textColor, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid }, font: '11px ' + css('--sp-font') },
        { stroke: textColor, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid }, size: 74, font: '11px ' + css('--sp-font'), values: (_: unknown, vals: number[]) => vals.map((v) => format(v)) },
      ],
      series: [
        { label: t('chart.time'), value: (_: unknown, v: number | null) => (v == null ? '—' : new Date(v * 1000).toLocaleString(i18n.locale, { dateStyle: 'short', timeStyle: 'medium' })) },
        ...series.map((s, i) => ({
          label: s.label,
          stroke: css(s.color),
          width: 1.5,
          dash: s.dashed ? [5, 4] : undefined,
          fill: stacked ? css(s.color) + '33' : undefined,
          points: { show: false },
          // Legend shows the real value, not the stacked sum.
          value: (_: unknown, __: number | null, ___: number, idx: number | null) => (idx == null ? '—' : format(rawData[i]?.[idx] ?? null)),
        })),
      ],
      bands: stacked ? series.slice(1).map((_, i) => ({ series: [i + 2, i + 1] as [number, number] })) : undefined,
      hooks: {
        draw: [
          (u: any) => {
            if (!peaks.length) return;
            const ctx = u.ctx as CanvasRenderingContext2D;
            ctx.save();
            ctx.fillStyle = css('--sp-danger');
            ctx.strokeStyle = css('--sp-bg');
            ctx.lineWidth = 2;
            for (const p of peaks) {
              const x = u.valToPos(p.ts, 'x', true);
              if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) continue;
              ctx.beginPath();
              ctx.arc(x, u.bbox.top + 6 * devicePixelRatio, 5 * devicePixelRatio, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
            ctx.restore();
          },
        ],
      },
    };
    try {
      plot = new UPlot(opts, [ts, ...drawn], host);
      plot.over.addEventListener('click', (e: MouseEvent) => {
        if (!onpeak || !peaks.length) return;
        const left = e.offsetX;
        const hit = peaks.find((p) => Math.abs(plot.valToPos(p.ts, 'x') - left) < 8 && e.offsetY < 24);
        if (hit) onpeak(hit.id);
      });
      failed = false;
    } catch {
      failed = true;
    }
  }

  // Load uPlot once, then (re)build when data or theme changes.
  $effect(() => {
    void ts;
    void series;
    void peaks;
    void height;
    untrack(() => {
      if (UPlot) {
        if (plot && plot.series.length === series.length + 1) {
          rawData = series.map((s) => s.values);
          plot.setData([ts, ...(stacked ? stack(rawData) : rawData)]);
        } else build();
        return;
      }
      import('../../lib/uplot')
        .then((m) => {
          UPlot = m.default;
          build();
        })
        .catch(() => (failed = true));
    });
  });

  $effect(() => {
    if (!host) return;
    const ro = new ResizeObserver(() => plot?.setSize({ width: host!.clientWidth, height }));
    ro.observe(host);
    // Colors are read from the tokens: rebuild when the theme or mode changes.
    const stop = onThemeChange(() => build());
    return () => {
      ro.disconnect();
      stop();
    };
  });

  onDestroy(() => plot?.destroy());

  // Text summary (screen readers and quick reading).
  const summary = $derived.by(() => {
    return series.map((s) => {
      const v = s.values.filter((x): x is number => x !== null && !Number.isNaN(x));
      if (!v.length) return `${s.label}: —`;
      const last = v[v.length - 1];
      const max = Math.max(...v);
      const avg = v.reduce((a, b) => a + b, 0) / v.length;
      return t('chart.summary', { label: s.label, last: format(last), avg: format(avg), max: format(max) });
    });
  });
  const tableRows = $derived(ts.map((x, i) => ({ t: x, v: series.map((s) => s.values[i]) })).slice(-60).reverse());
</script>

<figure class="chart v-card" class:warn={level === 'warn'} class:crit={level === 'crit'}>
  <figcaption>
    <span class="title">{title}</span>
    {#if level !== 'ok'}
      <span class="flag" title={levelMessage}>
        <span aria-hidden="true">{level === 'crit' ? '⛔' : '⚠'}</span>
        <span class="flag-text">{levelMessage}</span>
      </span>
    {/if}
    <button class="v-btn-ghost v-btn--sm toggle" aria-pressed={asTable} onclick={() => (asTable = !asTable)}>{asTable ? t('chart.asChart') : t('chart.asTable')}</button>
  </figcaption>
  <p class="sr-only">{summary.join('. ')}</p>
  {#if asTable}
    <div class="table-wrap">
      <table class="grid">
        <thead><tr><th>{t('chart.time')}</th>{#each series as s}<th class="num">{s.label}</th>{/each}</tr></thead>
        <tbody>
          {#each tableRows as row}
            <tr><td>{new Date(row.t * 1000).toLocaleString(i18n.locale)}</td>{#each row.v as v}<td class="num">{format(v ?? null)}</td>{/each}</tr>
          {/each}
        </tbody>
      </table>
      {#if !tableRows.length}<p class="empty">{t('chart.noData')}</p>{/if}
    </div>
  {:else}
    <div class="plot" bind:this={host} style:min-height="{height + 30}px" aria-hidden="true"></div>
    {#if failed}<p class="empty">{t('chart.failed')}</p>{/if}
    {#if !ts.length}<p class="empty overlay">{t('chart.noData')}</p>{/if}
  {/if}
  <p class="summary">{summary.join(' · ')}</p>
</figure>

<style>
  .chart {
    position: relative;
    margin: 0;
    padding: 10px 12px 8px;
    min-width: 0;
  }
  .chart.warn {
    border-color: var(--sp-warning-border);
    box-shadow: inset 3px 0 0 var(--sp-warning);
  }
  .chart.crit {
    border-color: var(--sp-danger-border);
    box-shadow: inset 3px 0 0 var(--sp-danger);
  }
  figcaption {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    font-size: 13px;
    font-weight: 600;
  }
  .flag {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    font-size: 12px;
    font-weight: 500;
    min-width: 0;
  }
  .warn .flag {
    color: var(--sp-warning);
  }
  .crit .flag {
    color: var(--sp-danger-text);
  }
  .flag-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .toggle {
    margin-left: auto;
    font-weight: 400;
  }
  .plot {
    width: 100%;
  }
  .plot :global(.u-legend) {
    font-size: 11.5px;
    color: var(--sp-text-secondary);
    text-align: left;
    margin-top: 2px;
  }
  .plot :global(.u-legend .u-marker) {
    border-radius: 2px;
  }
  .plot :global(.u-select) {
    background: color-mix(in srgb, var(--sp-focus) 10%, transparent);
  }
  .summary {
    margin: 2px 0 0;
    font-size: 11.5px;
    color: var(--sp-text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .table-wrap {
    max-height: 240px;
    overflow: auto;
  }
  .table-wrap :global(td.num),
  .table-wrap :global(th.num) {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .empty {
    margin: 0;
    padding: 12px;
    color: var(--sp-text-tertiary);
    font-size: 12.5px;
  }
  .overlay {
    position: absolute;
    inset: 40px 0 auto;
    text-align: center;
  }
</style>
