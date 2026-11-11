<script lang="ts">
  import type { Cell, RefCount } from '../lib/api';
  import { isMonoColumn, type GridColumn } from '../lib/grid';
  import { n, t } from '../lib/i18n.svelte';
  import { MASK } from '../lib/sensitive';

  let {
    columns,
    row,
    index,
    display,
    onclose,
    related,
    onopenrelated,
    secret = () => false,
  }: {
    columns: GridColumn[];
    row: Cell[];
    index: number;
    display: (v: Cell, j: number) => string;
    onclose: () => void;
    /** Rows in other tables that point to this one. */
    related?: () => Promise<RefCount[]>;
    onopenrelated?: (ref: RefCount) => void;
    /** Sensitive value still hidden in the grid: hidden here too until revealed. */
    secret?: (j: number) => boolean;
  } = $props();
  let shown = $state<Set<number>>(new Set());
  $effect(() => {
    void row;
    shown = new Set();
  });

  let refs = $state<RefCount[] | null>(null);
  let refsError = $state(false);
  $effect(() => {
    void row;
    refs = null;
    refsError = false;
    if (!related) return;
    related()
      .then((list) => (refs = list))
      .catch(() => (refsError = true));
  });

  let heading: HTMLHeadingElement | undefined = $state();
  $effect(() => {
    heading?.focus();
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onclose();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside class="detail" aria-labelledby="row-detail-title" onkeydown={onKey}>
  <header>
    <h2 id="row-detail-title" tabindex="-1" bind:this={heading}>{t('grid.detail', { n: n(index) })}</h2>
    <button class="v-btn-icon v-btn--sm" onclick={onclose} aria-label={t('common.close')}>✕</button>
  </header>
  {#if related}
    <section class="related" aria-label={t('detail.related')}>
      <h3>{t('detail.related')}</h3>
      {#if refsError}
        <p class="dim">{t('detail.relatedError')}</p>
      {:else if refs === null}
        <p class="dim">{t('common.loading')}</p>
      {:else if !refs.length}
        <p class="dim">{t('detail.noRelated')}</p>
      {:else}
        <ul>
          {#each refs as ref}
            <li>
              <button class="ref" disabled={!ref.count || !onopenrelated} onclick={() => onopenrelated?.(ref)}>
                <span class="ref-name">{ref.table}<span class="dim">.{ref.column}</span></span>
                {#if ref.kind === 'inferred'}<span class="v-badge">{t('relations.kind.inferred')}</span>{/if}
                <span class="ref-count">{n(ref.count)}{ref.more ? '+' : ''}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
  <dl>
    {#each columns as c, j}
      {@const v = row[j]}
      <div class="item">
        <dt>
          <span class="name">{c.name}</span>
          <span class="type">{c.fullType ?? c.type}</span>
        </dt>
        {#if v !== null && v !== '' && secret(j) && !shown.has(j)}
          <dd class="secret" aria-label={t('grid.hiddenValue')}>
            <span aria-hidden="true">{MASK}</span>
            <button class="v-btn-ghost v-btn--sm" onclick={() => (shown = new Set([...shown, j]))}>{t('grid.revealValue')}</button>
          </dd>
        {:else}
          <dd class:mono={isMonoColumn(c)} class:null={v === null || typeof v === 'object'}>
            {display(v, j)}
            {#if v !== null && typeof v !== 'object' && display(v, j) !== String(v)}
              <span class="raw">{String(v)}</span>
            {/if}
          </dd>
        {/if}
      </div>
    {/each}
  </dl>
</aside>

<style>
  .detail {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(420px, 92%);
    display: flex;
    flex-direction: column;
    background: var(--sp-bg);
    border-left: 1px solid var(--sp-border);
    box-shadow: var(--sp-shadow-md);
    z-index: 10;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 8px 8px 16px;
    border-bottom: 1px solid var(--sp-border);
  }
  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  h2:focus {
    outline: none;
  }
  dl {
    margin: 0;
    overflow: auto;
    padding: 4px 0 16px;
  }
  .related {
    padding: 8px 16px 10px;
    border-bottom: 1px solid var(--sp-border);
  }
  .related h3 {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--sp-text-secondary);
  }
  .related ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 2px;
    max-height: 180px;
    overflow: auto;
  }
  .ref {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 4px 6px;
    border: 0;
    border-radius: var(--sp-radius);
    background: none;
    text-align: left;
    font-size: 12.5px;
    color: var(--sp-text-primary);
    cursor: pointer;
  }
  .ref:hover:not(:disabled) {
    background: var(--sp-bg-muted);
  }
  .ref:disabled {
    cursor: default;
    color: var(--sp-text-tertiary);
  }
  .ref-name {
    font-family: var(--sp-font-mono);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ref-count {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .dim {
    color: var(--sp-text-tertiary);
  }
  p.dim {
    margin: 0;
    font-size: 12.5px;
  }
  .item {
    padding: 8px 16px;
    border-bottom: 1px solid var(--sp-border);
  }
  dt {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin-bottom: 2px;
  }
  .name {
    font-size: 12px;
    font-weight: 600;
    color: var(--sp-text-secondary);
  }
  .type {
    font-size: 11px;
    color: var(--sp-text-tertiary);
  }
  dd {
    margin: 0;
    font-size: 13px;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--sp-text-primary);
  }
  .mono {
    font-family: var(--sp-font-mono);
    font-size: 12.5px;
  }
  .null {
    color: var(--sp-text-tertiary);
    font-style: italic;
  }
  .raw {
    display: block;
    font-family: var(--sp-font-mono);
    font-size: 11.5px;
    color: var(--sp-text-tertiary);
  }
  dd.secret {
    display: flex;
    align-items: center;
    gap: 8px;
    letter-spacing: 0.1em;
    color: var(--sp-text-secondary);
  }
</style>
