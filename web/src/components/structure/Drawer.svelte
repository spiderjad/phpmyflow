<script lang="ts">
  // Side drawer with focus trap and Escape (spider-ui has none yet).
  import type { Snippet } from 'svelte';
  import { focusTrap } from '../../lib/focusTrap';
  import { t } from '../../lib/i18n.svelte';

  let { title, onclose, width = 480, children, footer }: { title: string; onclose: () => void; width?: number; children: Snippet; footer?: Snippet } = $props();
  const id = `drawer-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div class="backdrop" onclick={onclose} role="presentation"></div>
<div class="drawer v-app" role="dialog" aria-modal="true" aria-labelledby={id} style:width="min({width}px, 100vw)" use:focusTrap={onclose}>
  <header>
    <h2 {id}>{title}</h2>
    <button class="v-btn-icon v-btn--sm" onclick={onclose} aria-label={t('common.close')}>✕</button>
  </header>
  <div class="body">{@render children()}</div>
  {#if footer}<footer>{@render footer()}</footer>{/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: var(--sp-backdrop);
    animation: fade 150ms ease-out;
  }
  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 61;
    display: flex;
    flex-direction: column;
    background: var(--sp-bg);
    border-left: 1px solid var(--sp-border);
    box-shadow: var(--sp-shadow-lg);
    animation: slide 150ms ease-out;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 12px 12px 18px;
    border-bottom: 1px solid var(--sp-border);
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .body {
    flex: 1;
    overflow: auto;
    padding: 14px 18px 20px;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--sp-border);
    background: var(--sp-bg-subtle);
  }
  @keyframes slide {
    from {
      transform: translateX(16px);
      opacity: 0;
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .drawer,
    .backdrop {
      animation: none;
    }
  }
</style>
