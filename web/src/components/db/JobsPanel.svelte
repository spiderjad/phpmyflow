<script lang="ts">
  // Background jobs (export, import, copy): progress, time left, cancel,
  // resume after an error, and the import summary. Never blocks the UI.
  import { n, t } from '../../lib/i18n.svelte';
  import { cancelJob, dismissJob, eta, jobs, type Job } from '../../lib/jobs.svelte';
  import JobProgress from './JobProgress.svelte';

  let now = $state(Date.now());
  $effect(() => {
    if (!jobs.some((j) => j.status === 'running')) return;
    const h = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(h);
  });
  let open = $state<Record<number, boolean>>({});
  const left = (j: Job) => {
    const s = eta(j, now);
    return s === null ? '' : s >= 90 ? t('jobs.minLeft', { min: Math.round(s / 60) }) : t('jobs.secLeft', { sec: s });
  };
</script>

{#if jobs.length}
  <section class="jobs" aria-label={t('jobs.title')}>
    {#each jobs as j (j.id)}
      {#if j.stats}
        <JobProgress job={j} />
      {:else}
      <article class="job {j.status}">
        <header>
          <strong>{j.title}</strong>
          <span class="state">{t(`jobs.status.${j.status}`)}</span>
        </header>
        <div class="bar" role="progressbar" aria-label={j.title} aria-valuemin="0" aria-valuemax="100" aria-valuenow={j.progress === null ? undefined : Math.round(j.progress * 100)}>
          <span style:width="{(j.progress ?? 0) * 100}%" class:indeterminate={j.progress === null && j.status === 'running'}></span>
        </div>
        <p class="detail" aria-live="polite">
          {j.detail}{#if j.status === 'running' && left(j)} · {left(j)}{/if}
        </p>
        {#if j.error}<p class="err" role="alert">{j.error}</p>{/if}
        {#if j.summary && (j.status !== 'running' || j.summary.table)}
          {@const isOpen = open[j.id] ?? !!j.summary.table}
          <button class="link" onclick={() => (open[j.id] = !isOpen)} aria-expanded={isOpen}>{t('jobs.summary')}</button>
          {#if isOpen}
            <div class="summary">
              {#each j.summary.lines as l}<p>{l}</p>{/each}
              {#if j.summary.table}
                <div class="rtable">
                  <table class="grid">
                    <thead><tr>{#each j.summary.table.columns as c}<th>{c}</th>{/each}</tr></thead>
                    <tbody>
                      {#each j.summary.table.rows as r}
                        <tr class={r.status}>{#each r.cells as c, ci}<td class:mono={ci === 0}>{#if ci === 1}<span class="st" aria-hidden="true">{r.status === 'ok' ? '✓' : r.status === 'warning' ? '⚠' : r.status === 'error' ? '⛔' : '–'}</span> {/if}{c}</td>{/each}</tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
              {#if j.summary.errors.length}
                <ol class="errors">
                  {#each j.summary.errors as e}
                    <li><span class="mono">{t('jobs.line', { line: n(e.line) })}</span> {e.message}<pre class="mono">{e.statement}</pre></li>
                  {/each}
                </ol>
              {/if}
            </div>
          {/if}
        {/if}
        <footer>
          {#if j.status === 'running'}
            <button class="v-btn-ghost v-btn--sm" onclick={() => cancelJob(j)}>{t('common.cancel')}</button>
          {:else}
            {#if j.download}<button class="v-btn-primary v-btn--sm" onclick={() => j.download?.()}>{t('jobs.download')}</button>{/if}
            {#if j.resume}<button class="v-btn-secondary v-btn--sm" onclick={() => j.resume?.()}>{j.kind === 'import' ? t('jobs.continue') : t('jobs.resume')}</button>{/if}
            <button class="v-btn-ghost v-btn--sm" onclick={() => dismissJob(j)}>{t('common.close')}</button>
          {/if}
        </footer>
      </article>
      {/if}
    {/each}
  </section>
{/if}

<style>
  .jobs {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 55;
    display: grid;
    gap: 8px;
    width: min(440px, calc(100vw - 32px));
    max-height: 70vh;
    overflow: auto;
  }
  .job {
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
    background: var(--sp-bg);
    box-shadow: var(--sp-shadow-lg, 0 8px 24px rgb(0 0 0 / 0.12));
    font-size: 12.5px;
  }
  .job.error {
    border-color: var(--sp-danger);
  }
  .job.done {
    border-color: var(--sp-success);
  }
  header {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
  }
  .state {
    color: var(--sp-text-tertiary);
    white-space: nowrap;
  }
  .bar {
    height: 4px;
    border-radius: 2px;
    background: var(--sp-bg-subtle);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--sp-text-primary);
    transition: width 0.3s;
  }
  .done .bar span {
    background: var(--sp-success);
  }
  .error .bar span {
    background: var(--sp-danger);
  }
  .bar span.indeterminate {
    width: 30% !important;
    animation: slide 1.2s infinite linear;
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(350%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar span {
      transition: none;
    }
    .bar span.indeterminate {
      animation: none;
    }
  }
  p {
    margin: 0;
  }
  .detail {
    color: var(--sp-text-secondary);
  }
  .err {
    color: var(--sp-danger-text);
  }
  .link {
    justify-self: start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--sp-text-primary);
    text-decoration: underline;
    cursor: pointer;
    font-size: 12.5px;
  }
  .summary {
    display: grid;
    gap: 4px;
  }
  .rtable {
    max-height: 240px;
    overflow: auto;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
  }
  .rtable table {
    width: 100%;
    font-size: 11.5px;
  }
  .rtable td {
    vertical-align: top;
  }
  tr.error .st {
    color: var(--sp-danger-text);
  }
  tr.warning .st {
    color: var(--sp-warning);
  }
  tr.ok .st {
    color: var(--sp-success);
  }
  .errors {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 6px;
  }
  .errors pre {
    margin: 2px 0 0;
    padding: 4px 6px;
    background: var(--sp-bg-subtle);
    border-radius: var(--sp-radius);
    white-space: pre-wrap;
    word-break: break-all;
    font-size: 11px;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
</style>
