<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  import { prefs, type Density } from '../lib/prefs.svelte';
  import { update } from '../lib/settings.svelte';
  // Same setting as Settings › Appearance › Density.
  const setDensity = (d: Density) => update('appearance', { density: d });

  const options: Density[] = ['compact', 'comfortable'];
</script>

<div class="v-segmented" role="group" aria-label={t('grid.density')}>
  {#each options as d}
    <button class="v-segmented__item" aria-pressed={prefs.density === d} onclick={() => setDensity(d)}>{t(`grid.${d}`)}</button>
  {/each}
</div>

<style>
  .v-segmented__item {
    height: 24px;
    font-size: 12px;
  }
</style>
