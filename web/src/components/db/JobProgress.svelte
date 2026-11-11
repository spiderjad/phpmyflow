<script lang="ts">
  // Progress panel of an export / import job: real percentage, current table,
  // rows, MB, speed, elapsed and remaining time, a log of what was done,
  // "Looks stopped" after 20 s without progress (retry this step / resume /
  // cancel), the reason and "Resume from <table>" when it fails, and the
  // summary with "Download" when it ends. Minimizes to a bar at the bottom.
  import { mb, duration } from '../../lib/exporter';
  import { n, t } from '../../lib/i18n.svelte';
  import { cancelJob, dismissJob, STALL_MS, type Job } from '../../lib/jobs.svelte';

  let { job }: { job: Job } = $props();

  const s = $derived(job.stats);
  const pct = $derived(Math.round((job.progress ?? 0) * 100));
  const remaining = $derived.by(() => {
    if (job.status !== 'running' || !s || !job.progress || job.progress < 0.02 || job.progress >= 1) return null;
    return (s.elapsed / job.progress) * (1 - job.progress);
  });
  const isExport = $derived(job.kind === 'export');
  let logEl: HTMLOListElement | undefined = $state();
  $effect(() => {
    void job.log.length;
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  });
</script>

{#if job.minimized}
  <div class="jp-bar {job.status}" role="group" aria-label={job.title}>
    <button class="jp-bar-open" onclick={() => (job.minimized = false)} aria-label={t('jobs.expand', { title: job.title })}>
      <span class="jp-bar-title">{job.title}</span>
      <span class="jp-bar-track" aria-hidden="true"><span style:width="{pct}%"></span></span>
      <span class="jp-bar-pct">{job.stalled ? t('jobs.stalledShort') : job.status === 'running' ? `${pct} %` : t(`jobs.status.${job.status}`)}</span>
    </button>
  </div>
{:else}
  <article class="job jp {job.status}" class:stalled={job.stalled} aria-label={job.title}>
    <header class="jp-head">
      <strong>{job.title}</strong>
      <span class="v-badge {job.status === 'done' ? 'v-badge--success' : job.status === 'error' ? 'v-badge--danger' : job.stalled ? 'v-badge--warning' : ''}">
        {job.stalled ? t('jobs.stalledShort') : t(`jobs.status.${job.status}`)}
      </span>
      <button class="v-btn-icon v-btn--sm" onclick={() => (job.minimized = true)} aria-label={t('jobs.minimize')} title={t('jobs.minimize')}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 12h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
      </button>
    </header>

    <div class="jp-progress">
      <div class="bar" role="progressbar" aria-label={job.title} aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct} aria-valuetext="{pct} %">
        <span style:width="{pct}%"></span>
      </div>
      <span class="jp-pct">{pct} %</span>
    </div>

    {#if s}
      <dl class="jp-stats">
        {#if s.table && job.status !== 'done'}<div class="wide"><dt>{t('jobs.st.table')}</dt><dd class="mono">{s.table}</dd></div>{/if}
        {#if isExport}
          <div><dt>{t('jobs.st.tables')}</dt><dd>{n(s.tablesDone)} / {n(s.tablesTotal)}</dd></div>
          <div><dt>{t('jobs.st.rows')}</dt><dd>{n(s.rows)}</dd></div>
          <div><dt>{t('jobs.st.size')}</dt><dd>{mb(s.bytes)} MB</dd></div>
        {:else}
          <div><dt>{s.phase === 'upload' ? t('jobs.st.uploaded') : t('jobs.st.processed')}</dt><dd>{mb(s.bytes)}{s.bytesTotal ? ` / ${mb(s.bytesTotal)}` : ''} MB</dd></div>
          <div><dt>{t('jobs.st.statements')}</dt><dd>{n(s.rows)}</dd></div>
          <div><dt>{t('jobs.st.tablesCreated')}</dt><dd>{n(s.tablesDone)}</dd></div>
        {/if}
        {#if job.status === 'running'}<div><dt>{t('jobs.st.speed')}</dt><dd>{mb(s.speed)} MB/s</dd></div>{/if}
        <div><dt>{t('jobs.st.elapsed')}</dt><dd>{duration(s.elapsed)}</dd></div>
        {#if remaining !== null}<div><dt>{t('jobs.st.remaining')}</dt><dd>{duration(remaining)}</dd></div>{/if}
      </dl>
    {/if}

    {#if job.status === 'running' && job.stalled}
      <div class="v-banner v-banner--warning jp-msg" role="alert">
        <p><strong>{t('jobs.stalled', { sec: Math.round(STALL_MS / 1000) })}</strong></p>
        {#if s?.table}<p>{t('jobs.lastTable', { table: s.table })}</p>{/if}
        <div class="jp-acts">
          <button class="v-btn-primary v-btn--sm" onclick={() => job.retryStep?.()}>{t('jobs.retryStep')}</button>
          <button class="v-btn-secondary v-btn--sm" onclick={() => job.retryStep?.()} title={t('jobs.resumeHelp')}>{t('jobs.resume')}</button>
          <button class="v-btn-ghost v-btn--sm" onclick={() => cancelJob(job)}>{t('common.cancel')}</button>
        </div>
      </div>
    {/if}

    {#if job.status === 'error'}
      <div class="v-banner v-banner--danger jp-msg" role="alert">
        <p><strong>{job.error}</strong></p>
        {#each job.summary?.lines ?? [] as l}<p>{l}</p>{/each}
      </div>
    {/if}

    {#if job.status === 'done' && job.summary}
      <ul class="jp-sum">
        {#each job.summary.lines as l}<li>{l}</li>{/each}
      </ul>
      {#if job.summary.errors.length}
        <details class="jp-errors">
          <summary>{t('jobs.errorsN', { count: n(job.summary.errors.length) })}</summary>
          <ol>
            {#each job.summary.errors as e}<li><span class="mono">{t('jobs.line', { line: n(e.line) })}</span> {e.message}<pre class="mono">{e.statement}</pre></li>{/each}
          </ol>
        </details>
      {/if}
    {/if}

    {#if job.log.length}
      <details class="jp-log">
        <summary>{t('jobs.log', { count: n(job.log.length) })}</summary>
        <ol bind:this={logEl}>
          {#each job.log as l}<li class={l.kind}><span aria-hidden="true">{l.kind === 'ok' ? '✓' : l.kind === 'error' ? '⛔' : l.kind === 'warn' ? '⚠' : '·'}</span> {l.text}</li>{/each}
        </ol>
      </details>
    {/if}

    <footer class="jp-foot">
      {#if job.status === 'running'}
        {#if !job.stalled}<button class="v-btn-ghost v-btn--sm" onclick={() => cancelJob(job)}>{t('common.cancel')}</button>{/if}
      {:else}
        {#if job.download}<button class="v-btn-primary v-btn--sm" onclick={() => job.download?.()}>{t('jobs.download')}</button>{/if}
        {#if job.status === 'done'}
          {#each job.actions as act}<button class="v-btn-secondary v-btn--sm" onclick={() => void act.run()}>{act.label}</button>{/each}
        {/if}
        {#if job.resume}
          <button class="v-btn-primary v-btn--sm" onclick={() => job.resume?.()}>
            {job.resumeFrom ? t('jobs.resumeFrom', { table: job.resumeFrom }) : t('jobs.resume')}
          </button>
        {/if}
        <button class="v-btn-ghost v-btn--sm" onclick={() => dismissJob(job)}>{t('common.close')}</button>
      {/if}
    </footer>
  </article>
{/if}

<style>
  /* Export / import progress panel (components/db/JobsPanel.svelte). */
  .jp {
    display: grid;
    gap: 10px;
    padding: 14px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
    background: var(--sp-bg);
    box-shadow: var(--sp-shadow-lg);
    font-size: 12.5px;
  }
  .jp.error {
    border-color: var(--sp-danger);
  }
  .jp.done {
    border-color: var(--sp-success);
  }
  .jp.stalled {
    border-color: var(--sp-warning);
  }
  .jp-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .jp-head strong {
    flex: 1;
    min-width: 0;
    font-size: 13.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .jp-progress {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .bar {
    flex: 1;
    height: 8px;
    border-radius: 4px;
    background: var(--sp-bg-muted);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--sp-inverse);
    transition: width 0.3s;
  }
  .done .bar span {
    background: var(--sp-success);
  }
  .error .bar span {
    background: var(--sp-danger);
  }
  .stalled .bar span {
    background: var(--sp-warning);
  }
  .jp-pct {
    min-width: 42px;
    text-align: right;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .jp-stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px 12px;
    margin: 0;
  }
  .jp-stats div {
    min-width: 0;
  }
  .jp-stats .wide {
    grid-column: 1 / -1;
  }
  .jp-stats dt {
    font-size: 11px;
    color: var(--sp-text-secondary);
  }
  .jp-stats dd {
    margin: 0;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .jp-msg {
    display: grid;
    gap: 4px;
    margin: 0;
  }
  .jp-msg p {
    margin: 0;
  }
  .jp-acts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }
  .jp-sum {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .jp-log summary,
  .jp-errors summary {
    cursor: pointer;
    color: var(--sp-text-secondary);
    width: fit-content;
  }
  .jp-log summary:focus-visible,
  .jp-errors summary:focus-visible {
    outline: 2px solid var(--sp-focus);
    outline-offset: 2px;
  }
  .jp-log ol,
  .jp-errors ol {
    max-height: 160px;
    overflow: auto;
    margin: 6px 0 0;
    padding: 6px 8px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
    list-style: none;
    display: grid;
    gap: 2px;
    font-size: 12px;
  }
  .jp-log li.error {
    color: var(--sp-danger-text);
  }
  .jp-log li.warn {
    color: var(--sp-warning);
  }
  .jp-log li.ok span {
    color: var(--sp-success);
  }
  .jp-errors pre {
    margin: 2px 0 0;
    padding: 4px 6px;
    background: var(--sp-bg-subtle);
    border-radius: var(--sp-radius);
    white-space: pre-wrap;
    word-break: break-all;
    font-size: 11px;
  }
  .jp-foot {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 6px;
  }
  /* Minimized: a thin bar at the bottom; the app stays usable. */
  .jp-bar {
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
    background: var(--sp-bg);
    box-shadow: var(--sp-shadow-md);
  }
  .jp-bar.error {
    border-color: var(--sp-danger);
  }
  .jp-bar.done {
    border-color: var(--sp-success);
  }
  .jp-bar-open {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 10px;
    border: 0;
    background: none;
    color: var(--sp-text-primary);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .jp-bar-open:focus-visible {
    outline: 2px solid var(--sp-focus);
    outline-offset: -2px;
  }
  .jp-bar-title {
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .jp-bar-track {
    width: 120px;
    height: 4px;
    border-radius: 2px;
    background: var(--sp-bg-muted);
    overflow: hidden;
  }
  .jp-bar-track span {
    display: block;
    height: 100%;
    background: var(--sp-inverse);
  }
  .jp-bar-pct {
    min-width: 44px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  @media (prefers-reduced-motion: reduce) {
    .bar span {
      transition: none;
    }
  }
  @media (max-width: 480px) {
    .jp-stats {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
