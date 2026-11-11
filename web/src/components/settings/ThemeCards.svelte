<script lang="ts">
  // Theme picker: role="radiogroup" of cards, arrow keys move and select.
  // Each card shows a thumbnail of the theme in light and dark: the theme's
  // tokens are applied to the thumbnail with data-preview-theme +
  // data-mode-scope (styles/themes/*.css), so nothing here has a color.
  import { tick } from 'svelte';
  import { t } from '../../lib/i18n.svelte';
  import { THEMES, type ThemeId } from '../../lib/theme';

  let { value, disabled = false, onchange }: { value: ThemeId; disabled?: boolean; onchange: (v: ThemeId) => void } = $props();
  let root: HTMLDivElement;

  async function key(e: KeyboardEvent, i: number) {
    const n = THEMES.length;
    const j =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    onchange(THEMES[j]);
    await tick();
    root.querySelectorAll<HTMLElement>('[role="radio"]')[j]?.focus();
  }
</script>

<div class="st-themes" role="radiogroup" aria-label={t('settings.theme')} bind:this={root}>
  {#each THEMES as th, i}
    <button
      type="button"
      role="radio"
      class="st-theme"
      aria-checked={value === th}
      aria-disabled={disabled || undefined}
      tabindex={value === th ? 0 : -1}
      onclick={() => !disabled && onchange(th)}
      onkeydown={(e) => !disabled && key(e, i)}
    >
      <span class="st-thumbs" aria-hidden="true">
        {#each ['light', 'dark'] as m}
          <span class="st-thumb" data-preview-theme={th} data-mode-scope={m}>
            <span class="tb"><span class="dot"></span><span class="ln w40"></span></span>
            <span class="body">
              <span class="side"><span class="ln w70"></span><span class="ln w50 on"></span><span class="ln w60"></span></span>
              <span class="grid">
                <span class="row"><span class="ln w30"></span><span class="ln w50"></span></span>
                <span class="row"><span class="ln w40"></span><span class="ln w30"></span></span>
                <span class="row"><span class="ln w30"></span><span class="ln w40"></span></span>
                <span class="btn"></span>
              </span>
            </span>
          </span>
        {/each}
      </span>
      <span class="st-theme-name">{t(`theme.name.${th}`)}</span>
      <span class="st-theme-desc">{t(`theme.desc.${th}`)}</span>
    </button>
  {/each}
</div>

<style>
  /* Theme cards (Settings › Appearance). */
  .st-themes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 10px;
  }
  .st-theme {
    display: grid;
    gap: 4px;
    padding: 8px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
    background: var(--sp-bg);
    color: var(--sp-text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .st-theme:hover {
    border-color: var(--sp-border-hover);
  }
  .st-theme[aria-checked='true'] {
    border-color: var(--sp-focus);
    box-shadow: 0 0 0 1px var(--sp-focus);
  }
  .st-theme[aria-disabled='true'] {
    cursor: not-allowed;
    opacity: 0.6;
  }
  .st-theme:focus-visible {
    outline: 2px solid var(--sp-focus);
    outline-offset: 2px;
  }
  .st-theme-name {
    font-size: 13px;
    font-weight: 600;
  }
  .st-theme-desc {
    font-size: 12px;
    color: var(--sp-text-secondary);
  }
  .st-thumbs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    margin-bottom: 4px;
  }
  /* The thumbnail: everything below reads the scoped tokens. */
  .st-thumb {
    display: grid;
    grid-template-rows: 10px 1fr;
    height: 66px;
    overflow: hidden;
    border: 1px solid var(--sp-border);
    border-radius: 6px;
    background: var(--sp-bg);
  }
  .tb {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 0 4px;
    border-bottom: 1px solid var(--sp-border);
  }
  .dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--sp-text-primary);
  }
  .body {
    display: grid;
    grid-template-columns: 30% 1fr;
  }
  .side {
    display: grid;
    align-content: start;
    gap: 3px;
    padding: 4px 3px;
    background: var(--sp-bg-subtle);
    border-right: 1px solid var(--sp-border);
  }
  .grid {
    position: relative;
    display: grid;
    align-content: start;
  }
  .row {
    display: flex;
    gap: 3px;
    padding: 3px;
    border-bottom: 1px solid var(--sp-border);
  }
  .ln {
    display: block;
    height: 3px;
    border-radius: 2px;
    background: var(--sp-text-secondary);
    opacity: 0.7;
  }
  .ln.on {
    background: var(--sp-text-primary);
    opacity: 1;
  }
  .w30 { width: 30%; }
  .w40 { width: 40%; }
  .w50 { width: 50%; }
  .w60 { width: 60%; }
  .w70 { width: 70%; }
  .btn {
    position: absolute;
    right: 4px;
    bottom: 4px;
    width: 18px;
    height: 7px;
    border-radius: 2px;
    background: var(--sp-inverse);
  }
</style>
