<script lang="ts" module>
  export interface SegOption<T extends string = string> {
    value: T;
    label: string;
    /** Why it can't be chosen (shown as tooltip, announced via aria-describedby). */
    disabled?: string | false | null;
    /** One line under the control while this option is selected. */
    hint?: string;
  }
</script>

<script lang="ts" generics="T extends string">
  // Segmented control with radio semantics (spider-ui has the look, not the
  // behaviour): role="radiogroup", arrow keys, disabled options stay
  // focusable so screen readers can read why.
  let { options, value, label, onchange }: { options: SegOption<T>[]; value: T; label: string; onchange: (v: T) => void } = $props();

  const uid = `seg-${Math.random().toString(36).slice(2, 8)}`;
  let root: HTMLDivElement;

  function key(e: KeyboardEvent, i: number) {
    const n = options.length;
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + n) % n;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = n - 1;
    else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!options[i].disabled) onchange(options[i].value);
      return;
    }
    if (j < 0) return;
    e.preventDefault();
    root.querySelectorAll<HTMLElement>('[role="radio"]')[j]?.focus();
    if (!options[j].disabled) onchange(options[j].value);
  }
  const current = $derived(options.find((o) => o.value === value));
</script>

<div class="seg-wrap">
  <div class="v-segmented seg" role="radiogroup" aria-label={label} bind:this={root}>
    {#each options as o, i}
      <button
        type="button"
        class="v-segmented__item"
        role="radio"
        aria-checked={o.value === value}
        aria-disabled={o.disabled ? 'true' : undefined}
        aria-describedby={o.disabled ? `${uid}-why-${i}` : undefined}
        tabindex={o.value === value ? 0 : -1}
        title={o.disabled || undefined}
        class:off={!!o.disabled}
        onclick={() => !o.disabled && onchange(o.value)}
        onkeydown={(e) => key(e, i)}
      >{o.label}</button>
      {#if o.disabled}<span class="sr-only" id="{uid}-why-{i}">{o.disabled}</span>{/if}
    {/each}
  </div>
  {#if current?.hint}<p class="hint" aria-live="polite">{current.hint}</p>{/if}
</div>

<style>
  .seg-wrap {
    display: grid;
    gap: 4px;
  }
  .seg {
    flex-wrap: wrap;
    justify-self: start;
  }
  /* spider-ui styles aria-pressed; radios use aria-checked. */
  .seg :global(.v-segmented__item[aria-checked='true']) {
    color: var(--sp-text-primary);
    background: var(--sp-bg);
    border-color: var(--sp-border);
    box-shadow: var(--sp-shadow);
  }
  .off {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--sp-text-secondary);
  }
</style>
