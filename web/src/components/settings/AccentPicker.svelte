<script lang="ts">
  // Accent: the theme's own, one of the 8 system colors (they follow the
  // mode) or any color. role="radiogroup" with arrow keys. When the accent is
  // under 4.5:1 on the background, a warning says so; the text on accent
  // buttons is always switched to white or black (lib/theme.ts accentVars).
  import { tick } from 'svelte';
  import { t, n } from '../../lib/i18n.svelte';
  import { accentHex, checkAccent, COLORS, currentBg, onThemeChange, PALETTE, type ColorId } from '../../lib/theme';

  let { value, disabled = false, onchange }: { value: string | null; disabled?: boolean; onchange: (v: string | null) => void } = $props();

  // Current mode and background (they change with the theme and the OS).
  let mode = $state<'light' | 'dark'>(document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'light');
  let bg = $state(currentBg());
  $effect(() =>
    onThemeChange(() => {
      mode = document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'light';
      bg = currentBg();
    }),
  );

  const isCustom = $derived(!!value && !(COLORS as readonly string[]).includes(value));
  const choices = $derived<(string | null)[]>([null, ...COLORS, 'custom']);
  const selectedIndex = $derived(value === null ? 0 : isCustom ? choices.length - 1 : choices.indexOf(value));
  const hex = $derived(accentHex(value, mode));
  const check = $derived(hex ? checkAccent(hex, bg) : null);
  let customColor = $state('#2563eb');
  $effect(() => {
    if (isCustom && value) customColor = value;
  });
  let root: HTMLDivElement;
  let colorInput: HTMLInputElement | undefined = $state();

  function choose(c: string | null) {
    if (disabled) return;
    if (c === 'custom') {
      onchange(customColor);
      colorInput?.click();
    } else onchange(c);
  }
  async function key(e: KeyboardEvent, i: number) {
    const k = choices.length;
    const j = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % k : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + k) % k : -1;
    if (j < 0 || disabled) return;
    e.preventDefault();
    const c = choices[j];
    onchange(c === 'custom' ? customColor : c);
    await tick();
    root.querySelectorAll<HTMLElement>('[role="radio"]')[j]?.focus();
  }
  const label = (c: string | null) => (c === null ? t('settings.accentTheme') : c === 'custom' ? t('settings.accentCustom') : t(`color.${c}`));
</script>

<div class="st-accent">
  <div class="st-swatches" role="radiogroup" aria-label={t('settings.accent')} bind:this={root}>
    {#each choices as c, i}
      <button
        type="button"
        role="radio"
        class="st-sw"
        class:theme={c === null}
        class:custom={c === 'custom'}
        aria-checked={i === selectedIndex}
        aria-disabled={disabled || undefined}
        tabindex={i === selectedIndex ? 0 : -1}
        title={label(c)}
        style:--sw={c && c !== 'custom' ? PALETTE[c as ColorId][mode] : c === 'custom' ? customColor : undefined}
        onclick={() => choose(c)}
        onkeydown={(e) => key(e, i)}
      >
        {#if c === null}<span aria-hidden="true">A</span>{:else if c === 'custom'}<span aria-hidden="true">+</span>{/if}
        <span class="sr-only">{label(c)}</span>
      </button>
    {/each}
  </div>
  <label class="st-custom">
    <span class="sr-only">{t('settings.accentCustom')}</span>
    <input
      bind:this={colorInput}
      type="color"
      value={customColor}
      {disabled}
      oninput={(e) => {
        customColor = (e.currentTarget as HTMLInputElement).value;
        onchange(customColor);
      }}
    />
    <span class="mono">{isCustom ? value : ''}</span>
  </label>
</div>
{#if check}
  {#if check.ok}
    <p class="v-help st-acc-ok">{t('settings.accentOk', { ratio: n(Math.round(check.ratio * 10) / 10) })}</p>
  {:else}
    <p class="v-banner v-banner--warning st-acc-warn" role="status">
      {t('settings.accentLow', { ratio: n(Math.round(check.ratio * 10) / 10), text: check.on === '#ffffff' ? t('settings.white') : t('settings.black') })}
    </p>
  {/if}
{/if}

<style>
  /* Accent swatches (Settings › Appearance). */
  .st-accent {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .st-swatches {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .st-sw {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 2px solid var(--sp-bg);
    border-radius: 50%;
    background: var(--sw, var(--sp-bg-muted));
    box-shadow: 0 0 0 1px var(--sp-border);
    color: var(--sp-text-primary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .st-sw.theme {
    background: var(--sp-inverse);
    color: var(--sp-on-inverse);
  }
  .st-sw.custom {
    background: conic-gradient(var(--chart-1), var(--chart-2), var(--chart-3), var(--chart-4), var(--chart-1));
    color: var(--sp-on-inverse);
  }
  .st-sw[aria-checked='true'] {
    box-shadow: 0 0 0 2px var(--sp-focus);
  }
  .st-sw:focus-visible {
    outline: 2px solid var(--sp-focus);
    outline-offset: 3px;
  }
  .st-sw[aria-disabled='true'] {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .st-custom {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--sp-text-secondary);
  }
  .st-custom input {
    width: 32px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
    background: none;
    cursor: pointer;
  }
  .st-acc-ok {
    margin: 8px 0 0;
  }
  .st-acc-warn {
    margin: 8px 0 0;
  }
</style>
