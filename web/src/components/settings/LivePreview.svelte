<script lang="ts">
  // Mini interface for Settings › Appearance. It uses the page's own tokens,
  // so every change (theme, mode, accent, corners, density, text size) shows
  // here at once. Decorative: hidden from screen readers except its title.
  import { t } from '../../lib/i18n.svelte';
  import { settings } from '../../lib/settings.svelte';
  const rows = [
    ['1', 'Lucía Fernández', 'ES'],
    ['2', 'Marco Rossi', 'IT'],
    ['3', 'Camille Dubois', 'FR'],
    ['4', 'John Carter', 'US'],
  ];
</script>

<figure class="st-pv" aria-label={t('settings.preview')}>
  <figcaption class="st-pv-cap">{t('settings.preview')}</figcaption>
  <div class="st-pv-app" aria-hidden="true">
    <div class="st-pv-top">
      <strong>phpMyFlow</strong>
      <span class="sep">/</span>
      <span class="mono">shop</span>
      <span class="st-pv-tab on">{t('nav.data')}</span>
      <span class="st-pv-tab">{t('nav.sql')}</span>
    </div>
    <div class="st-pv-body">
      <div class="st-pv-side">
        <span class="it">customers</span>
        <span class="it on">orders</span>
        <span class="it">products</span>
      </div>
      <div class="st-pv-main">
        <div class="st-pv-bar">
          <span class="v-badge v-badge--success">OK</span>
          <span class="grow"></span>
          <span class="v-btn-secondary v-btn--sm">{t('grid.filter')}</span>
          <span class="v-btn-primary v-btn--sm">{t('insert.button')}</span>
        </div>
        <table class="st-pv-grid" class:zebra={settings.data.zebra}>
          <tbody>
            {#each rows as r, i}
              <tr class:odd={i % 2 === 1}><td class="mono">{r[0]}</td><td>{r[1]}</td><td class="mono dim">{r[2]}</td></tr>
            {/each}
          </tbody>
        </table>
        <span class="v-input st-pv-input focus">WHERE country = 'ES'</span>
      </div>
    </div>
  </div>
</figure>

<style>
  /* Live preview (Settings › Appearance). */
  .st-pv {
    margin: 0;
    display: grid;
    gap: 8px;
    align-content: start;
  }
  .st-pv-cap {
    font-size: 12px;
    font-weight: 600;
    color: var(--sp-text-secondary);
  }
  .st-pv-app {
    overflow: hidden;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
    background: var(--sp-bg);
    color: var(--sp-text-primary);
    font-size: 12.5px;
    box-shadow: var(--sp-shadow-md);
    pointer-events: none;
    user-select: none;
  }
  .st-pv-top {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--sp-border);
  }
  .sep {
    color: var(--sp-border-hover);
  }
  .st-pv-tab {
    margin-left: 6px;
    color: var(--sp-text-secondary);
  }
  .st-pv-tab.on {
    margin-left: auto;
    color: var(--sp-text-primary);
    font-weight: 500;
    box-shadow: inset 0 -2px 0 var(--sp-text-primary);
  }
  .st-pv-body {
    display: grid;
    grid-template-columns: 96px 1fr;
    min-height: 200px;
  }
  .st-pv-side {
    display: grid;
    align-content: start;
    gap: 2px;
    padding: 8px 6px;
    background: var(--sp-bg-subtle);
    border-right: 1px solid var(--sp-border);
    font-family: var(--sp-font-mono);
    font-size: 11.5px;
  }
  .it {
    padding: 3px 6px;
    border-radius: var(--sp-radius);
    color: var(--sp-text-secondary);
  }
  :global(:root[data-density='comfortable']) .it {
    padding: 6px;
  }
  .it.on {
    background: var(--sp-inverse);
    color: var(--sp-on-inverse);
  }
  .st-pv-main {
    display: grid;
    align-content: start;
    gap: 8px;
    padding: 8px;
    min-width: 0;
  }
  .st-pv-bar {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .grow {
    flex: 1;
  }
  .st-pv-grid {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .st-pv-grid td {
    padding: 4px 6px;
    border-bottom: 1px solid var(--sp-border);
    white-space: nowrap;
  }
  :global(:root[data-density='comfortable']) .st-pv-grid td {
    padding: 8px 6px;
  }
  .st-pv-grid.zebra tr.odd td {
    background: color-mix(in srgb, var(--sp-bg-muted) 55%, var(--sp-bg));
  }
  .dim {
    color: var(--sp-text-secondary);
  }
  .st-pv-input {
    display: block;
    font-family: var(--sp-font-mono);
    font-size: 11.5px;
  }
  .st-pv-input.focus {
    border-color: var(--sp-focus);
    box-shadow: 0 0 0 3px var(--sp-focus-ring);
  }
</style>
