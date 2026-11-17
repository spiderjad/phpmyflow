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
          <!-- A miniature of the real frame: sidebar with its current row, top bar with the
               active tab, grid header, striped and selected rows, a relation chip, the accent. -->
          <span class="st-thumb" data-preview-theme={th} data-mode-scope={m}>
            <span class="side"><span class="mk"></span><span class="sl w70"></span><span class="sl on"></span><span class="sl w50"></span><span class="sl w60"></span></span>
            <span class="main">
              <span class="tb"><span class="ln w30"></span><span class="tab"></span></span>
              <span class="gh"><span class="ln w30"></span><span class="ln w40"></span></span>
              <span class="row"><span class="ln w30"></span><span class="chip"></span></span>
              <span class="row alt"><span class="ln w40"></span><span class="chip"></span></span>
              <span class="row sel"><span class="ln w30"></span><span class="chip"></span></span>
              <span class="btn"></span>
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
  /* The thumbnail: everything below reads the scoped tokens (the theme's role tokens). */
  .st-thumb {
    display: grid;
    grid-template-columns: 30% 1fr;
    height: 70px;
    overflow: hidden;
    border: 1px solid var(--sp-border);
    border-radius: 6px;
    background: var(--surface-1);
  }
  .side {
    display: grid;
    align-content: start;
    gap: 3px;
    padding: 4px 3px;
    background: var(--sidebar-image, none), var(--sidebar-bg);
    border-right: 1px solid var(--sidebar-border);
  }
  .mk {
    width: 7px;
    height: 7px;
    margin-bottom: 1px;
    border-radius: 2px;
    background: var(--sidebar-accent);
  }
  .sl {
    display: block;
    height: 3px;
    border-radius: 2px;
    background: var(--sidebar-text-muted);
  }
  .sl.on {
    height: 7px;
    background: var(--sidebar-active-bg);
    box-shadow: inset 2px 0 0 var(--sidebar-active-indicator);
  }
  .main {
    position: relative;
    display: grid;
    grid-template-rows: 11px 9px repeat(3, 1fr);
    min-width: 0;
  }
  .tb {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 4px;
    background: var(--topbar-bg);
    border-bottom: 1px solid var(--topbar-border);
  }
  .tb .ln {
    background: var(--topbar-text);
  }
  .tab {
    width: 12px;
    height: 100%;
    margin-left: auto;
    box-shadow: inset 0 -2px 0 var(--tab-active-indicator);
  }
  .gh {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 0 3px;
    background: var(--grid-header-bg);
    border-bottom: 1px solid var(--sp-border);
  }
  .gh .ln {
    background: var(--grid-header-text);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 0 3px;
    background: var(--surface-1);
    border-bottom: 1px solid var(--sp-border);
  }
  .row.alt {
    background: var(--grid-row-alt);
  }
  .row.sel {
    background: var(--grid-row-selected);
  }
  .ln {
    display: block;
    height: 3px;
    border-radius: 2px;
    background: var(--sp-text-secondary);
  }
  .chip {
    width: 14px;
    height: 5px;
    border-radius: 3px;
    background: var(--chip-bg);
    box-shadow: inset 0 0 0 1px var(--chip-border);
  }
  .w30 { width: 30%; }
  .w40 { width: 40%; }
  .w50 { width: 50%; }
  .w60 { width: 60%; }
  .w70 { width: 70%; }
  .btn {
    position: absolute;
    right: 4px;
    bottom: 3px;
    width: 16px;
    height: 6px;
    border-radius: 2px;
    background: var(--sp-inverse);
  }
</style>
