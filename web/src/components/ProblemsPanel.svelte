<script lang="ts">
  import { n, t } from '../lib/i18n.svelte';
  import type { Problem } from '../lib/sqlLint';

  let {
    problems,
    ongoto,
    onfix,
  }: {
    problems: Problem[];
    ongoto: (p: Problem) => void;
    onfix: (p: Problem, fix: number) => void;
  } = $props();

  let open = $state(true);
  const errors = $derived(problems.filter((p) => p.severity === 'error').length);
  const warnings = $derived(problems.length - errors);
</script>

{#if problems.length}
  <section class="problems" aria-label={t('problems.title')}>
    <button class="head" onclick={() => (open = !open)} aria-expanded={open}>
      <span class="chev" class:open aria-hidden="true">›</span>
      <strong>{t('problems.title')}</strong>
      {#if errors}<span class="v-badge v-badge--danger">{t('problems.errors', { count: n(errors) })}</span>{/if}
      {#if warnings}<span class="v-badge v-badge--warning">{t('problems.warnings', { count: n(warnings) })}</span>{/if}
    </button>
    {#if open}
      <ul>
        {#each problems as p (p.id + ':' + p.from + ':' + p.message)}
          <li class={p.severity}>
            <button class="item" onclick={() => ongoto(p)} title={t('problems.goto')}>
              <span class="icon" aria-hidden="true">{p.severity === 'error' ? '●' : '▲'}</span>
              <span class="sr-only">{p.severity === 'error' ? t('problems.error') : t('problems.warning')}:</span>
              <span class="msg">{p.message}</span>
              <span class="pos">{t('problems.position', { line: n(p.line), col: n(p.col) })}</span>
            </button>
            {#each p.fixes as label, i}
              <button class="v-btn-secondary v-btn--sm fix" onclick={() => onfix(p, i)}>{label}</button>
            {/each}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .problems {
    border-top: 1px solid var(--sp-border);
    background: var(--sp-bg-subtle);
    font-size: 12.5px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 4px 12px;
    border: 0;
    background: none;
    color: var(--sp-text-secondary);
    text-align: left;
    cursor: pointer;
  }
  .head strong {
    font-weight: 600;
    color: var(--sp-text-primary);
  }
  .chev {
    display: inline-block;
    transition: transform var(--sp-ease);
  }
  .chev.open {
    transform: rotate(90deg);
  }
  ul {
    margin: 0;
    padding: 0 0 4px;
    list-style: none;
    max-height: 132px;
    overflow: auto;
  }
  li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-right: 12px;
  }
  li:hover {
    background: var(--sp-bg-muted);
  }
  .item {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 12px 4px 28px;
    border: 0;
    background: none;
    text-align: left;
    color: var(--sp-text-primary);
    cursor: pointer;
  }
  .icon {
    font-size: 9px;
    flex-shrink: 0;
  }
  .error .icon {
    color: var(--sp-danger);
  }
  .warning .icon {
    color: var(--sp-warning);
  }
  .msg {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pos {
    flex-shrink: 0;
    margin-left: auto;
    color: var(--sp-text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .fix {
    flex-shrink: 0;
    padding: 2px 8px;
    font-size: 11.5px;
  }
</style>
