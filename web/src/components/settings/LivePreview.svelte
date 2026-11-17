<script lang="ts">
  // Mini interface for Settings › Appearance. It uses the page's own tokens,
  // so every change (theme, mode, accent, corners, density, text size) shows
  // here at once. Decorative: hidden from screen readers except its title.
  import { t } from '../../lib/i18n.svelte';
  import { settings } from '../../lib/settings.svelte';
  const rows = [
    ['1', 'Lucía Fernández'],
    ['2', 'Marco Rossi'],
    ['3', 'Camille Dubois'],
    ['4', 'John Carter'],
  ];
</script>

<figure class="st-pv" aria-label={t('settings.preview')}>
  <figcaption class="st-pv-cap">{t('settings.preview')}</figcaption>
  <!-- The real frame in small: sidebar with its current row, top bar with the active tab,
       grid header, striped rows, a selected row, a relation chip, buttons and a focused field. -->
  <div class="st-pv-app" aria-hidden="true">
    <div class="st-pv-side">
      <span class="db"><span class="mk">S</span>shop</span>
      <span class="it">customers</span>
      <span class="it on">orders</span>
      <span class="it">products</span>
    </div>
    <div class="st-pv-right">
      <div class="st-pv-top">
        <strong class="mono">orders</strong>
        <span class="st-pv-tab on">{t('nav.data')}</span>
        <span class="st-pv-tab">{t('nav.sql')}</span>
      </div>
      <div class="st-pv-main">
        <div class="st-pv-bar">
          <span class="v-badge v-badge--success">OK</span>
          <span class="grow"></span>
          <span class="v-btn-primary v-btn--sm">{t('insert.button')}</span>
        </div>
        <table class="st-pv-grid" class:zebra={settings.data.zebra}>
          <thead><tr><th>id <span class="pk">PK</span></th><th>customer</th></tr></thead>
          <tbody>
            {#each rows as r, i}
              <tr class:odd={i % 2 === 1} class:sel={i === 2}><td class="mono">{r[0]}</td><td><span class="chip"><span class="ci">{r[1][0]}</span>{r[1]}</span></td></tr>
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
    display: grid;
    grid-template-columns: 84px 1fr;
    overflow: hidden;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
    background: var(--surface-1);
    color: var(--sp-text-primary);
    font-size: 12.5px;
    box-shadow: var(--sp-shadow-md);
    pointer-events: none;
    user-select: none;
  }
  .st-pv-side {
    display: grid;
    align-content: start;
    gap: 2px;
    padding: 8px 6px;
    background: var(--sidebar-image, none), var(--sidebar-bg);
    border-right: 1px solid var(--sidebar-border);
    color: var(--sidebar-text-muted);
    font-size: 11.5px;
  }
  .db {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 4px;
    color: var(--sidebar-text);
    font-weight: 600;
  }
  .mk {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    background: var(--sidebar-accent);
    color: var(--sidebar-on-accent);
    font-size: 10px;
  }
  .it {
    padding: 3px 6px;
    border-radius: var(--sp-radius);
  }
  :global(:root[data-density='comfortable']) .it {
    padding: 6px;
  }
  .it.on {
    background: var(--sidebar-active-bg);
    color: var(--sidebar-active-text);
    box-shadow: inset 3px 0 0 var(--sidebar-active-indicator);
    font-weight: 500;
  }
  .st-pv-right {
    display: grid;
    grid-template-rows: auto 1fr;
    min-width: 0;
    overflow: hidden;
  }
  .st-pv-top {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 10px;
    background: var(--topbar-bg);
    border-bottom: 1px solid var(--topbar-border);
    color: var(--topbar-text);
  }
  .st-pv-tab {
    display: inline-flex;
    align-items: center;
    height: 100%;
    margin-left: 6px;
    color: var(--topbar-text-muted);
  }
  .st-pv-tab.on {
    margin-left: auto;
    color: var(--topbar-text);
    font-weight: 500;
    box-shadow: inset 0 -2px 0 var(--tab-active-indicator);
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
  .st-pv-grid th {
    padding: 4px 6px;
    border-bottom: 1px solid var(--sp-border);
    background: var(--grid-header-bg);
    color: var(--grid-header-text);
    font-weight: 600;
    text-align: left;
    white-space: nowrap;
  }
  .pk {
    margin-left: 3px;
    color: var(--badge-pk);
    font-size: 9.5px;
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
    background: var(--grid-row-alt);
  }
  .st-pv-grid tr.sel td {
    background: var(--grid-row-selected);
  }
  .st-pv-grid tr.sel td:first-child {
    box-shadow: inset 2px 0 0 var(--grid-cell-focus);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px 1px 2px;
    border: 1px solid var(--chip-border);
    border-radius: 999px;
    background: var(--chip-bg);
    color: var(--chip-text);
    font-size: 11px;
  }
  .ci {
    display: grid;
    place-items: center;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--chip-text) 14%, var(--chip-bg));
    font-size: 8px;
    font-weight: 700;
    line-height: 1;
  }
  .st-pv-input {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--sp-font-mono);
    font-size: 11.5px;
  }
  .st-pv-input.focus {
    border-color: var(--sp-focus);
    box-shadow: 0 0 0 3px var(--sp-focus-ring);
  }
</style>
