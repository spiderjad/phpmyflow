<script lang="ts">
  // Anchored popover with focus trap and Escape (spider-ui has none yet).
  import type { Snippet } from 'svelte';
  import { focusTrap } from '../../lib/focusTrap';

  let { anchor, label, onclose, width = 300, children }: { anchor: HTMLElement; label: string; onclose: () => void; width?: number; children: Snippet } = $props();

  let el: HTMLDivElement | undefined = $state();
  let pos = $state({ x: 0, y: 0 });

  $effect(() => {
    const r = anchor.getBoundingClientRect();
    const h = el?.offsetHeight ?? 320;
    const below = r.bottom + 6 + h < window.innerHeight;
    pos = {
      x: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      y: below ? r.bottom + 6 : Math.max(8, r.top - h - 6),
    };
  });

  function outside(e: PointerEvent) {
    const t = e.target as Node;
    if (el && !el.contains(t) && !anchor.contains(t)) onclose();
  }
</script>

<svelte:window onpointerdown={outside} onresize={onclose} />

<div class="pop v-app" role="dialog" aria-label={label} bind:this={el} style:left="{pos.x}px" style:top="{pos.y}px" style:width="{width}px" use:focusTrap={onclose}>
  {@render children()}
</div>

<style>
  .pop {
    position: fixed;
    z-index: 70;
    max-height: min(480px, calc(100vh - 16px));
    overflow: auto;
    padding: 10px;
    background: var(--sp-bg);
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
    box-shadow: var(--sp-shadow-md);
    animation: pop-in 150ms ease-out;
  }
  @keyframes pop-in {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pop {
      animation: none;
    }
  }
</style>
