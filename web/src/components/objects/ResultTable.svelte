<script lang="ts">
  // Small read-only result table (view "Test", routine results).
  import { n, t } from '../../lib/i18n.svelte';

  let { columns, rows, truncated = false, caption }: { columns: string[]; rows: unknown[][]; truncated?: boolean; caption: string } = $props();
  const cell = (v: unknown) => (v === null || v === undefined ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v));
</script>

<div class="rt">
  <table class="grid" aria-label={caption}>
    <thead><tr>{#each columns as c}<th class="mono">{c}</th>{/each}</tr></thead>
    <tbody>
      {#each rows as r}
        <tr>{#each r as v}<td class:null={v === null} title={cell(v)}>{cell(v)}</td>{/each}</tr>
      {:else}
        <tr><td colspan={Math.max(1, columns.length)} class="empty">{t('objects.noRows')}</td></tr>
      {/each}
    </tbody>
  </table>
</div>
<p class="meta">{t('objects.rows', { count: n(rows.length) })}{truncated ? ` · ${t('objects.truncated')}` : ''}</p>

<style>
  .rt {
    max-height: 280px;
    overflow: auto;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
  }
  table {
    width: 100%;
    font-size: 12px;
  }
  th {
    position: sticky;
    top: 0;
  }
  td {
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .null {
    color: var(--sp-text-tertiary);
    font-style: italic;
  }
  .empty {
    color: var(--sp-text-tertiary);
    text-align: center;
  }
  .meta {
    margin: 4px 0 0;
    font-size: 11.5px;
    color: var(--sp-text-tertiary);
  }
</style>
