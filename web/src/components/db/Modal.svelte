<script lang="ts">
  // Native <dialog> (focus trap, Esc) used by every database dialog.
  import { onMount, type Snippet } from 'svelte';
  import { t } from '../../lib/i18n.svelte';

  let {
    title,
    width = 520,
    onclose,
    children,
    footer,
  }: { title: string; width?: number; onclose: () => void; children: Snippet; footer?: Snippet } = $props();

  let el: HTMLDialogElement;
  const id = `dlg-${Math.random().toString(36).slice(2, 8)}`;
  onMount(() => {
    el.showModal();
    return () => el.open && el.close();
  });
</script>

<dialog class="v-app v-dialog db-dialog" bind:this={el} oncancel={(e) => (e.preventDefault(), onclose())} aria-labelledby={id} style:--w="{width}px">
  <header class="v-card__header">
    <h2 class="v-card__title" {id}>{title}</h2>
    <button class="v-btn-icon v-btn--sm" onclick={onclose} aria-label={t('common.close')}>✕</button>
  </header>
  <div class="v-card__body body">{@render children()}</div>
  {#if footer}<footer class="v-card__footer">{@render footer()}</footer>{/if}
</dialog>

<style>
  .db-dialog {
    width: min(var(--w), calc(100vw - 24px));
    max-height: calc(100vh - 32px);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .body {
    display: grid;
    gap: 12px;
    max-height: calc(100vh - 180px);
    overflow: auto;
    font-size: 13.5px;
  }
  .body :global(.field) {
    display: grid;
    gap: 4px;
  }
  .body :global(.field > span) {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--sp-text-secondary);
  }
  .body :global(.hint) {
    margin: 0;
    font-size: 12px;
    color: var(--sp-text-tertiary);
  }
  .body :global(.row2) {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .body :global(.checks) {
    display: grid;
    gap: 6px;
  }
  .body :global(.checks label),
  .body :global(label.inline) {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .body :global(fieldset) {
    margin: 0;
    padding: 0;
    border: 0;
    display: grid;
    gap: 6px;
  }
  .body :global(legend) {
    margin-bottom: 4px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--sp-text-secondary);
  }
  @media (max-width: 520px) {
    .body :global(.row2) {
      grid-template-columns: 1fr;
    }
  }
</style>
