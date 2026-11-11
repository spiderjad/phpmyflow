<script lang="ts">
  // Small switch (spider-ui has none yet: docs/spider-ui-gaps.md).
  let { checked, label, disabled = false, onchange }: { checked: boolean; label: string; disabled?: boolean; onchange?: (v: boolean) => void } = $props();
</script>

<button
  type="button"
  class="switch"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  title={label}
  {disabled}
  onclick={() => onchange?.(!checked)}
><span class="knob" aria-hidden="true"></span></button>

<style>
  .switch {
    position: relative;
    width: 30px;
    height: 18px;
    padding: 0;
    border: 1px solid var(--sp-border-hover);
    border-radius: 999px;
    background: var(--sp-bg-muted);
    cursor: pointer;
    transition: background var(--sp-ease), border-color var(--sp-ease);
    flex-shrink: 0;
  }
  .switch[aria-checked='true'] {
    background: var(--sp-inverse);
    border-color: var(--sp-inverse);
  }
  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--sp-bg);
    box-shadow: var(--sp-shadow);
    transition: transform var(--sp-ease);
  }
  .switch[aria-checked='true'] .knob {
    transform: translateX(12px);
  }
  .switch:focus-visible {
    outline: 2px solid var(--sp-focus);
    outline-offset: 2px;
  }
  .switch:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  @media (prefers-reduced-motion: reduce) {
    .switch,
    .knob {
      transition: none;
    }
  }
</style>
