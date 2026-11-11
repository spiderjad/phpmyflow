<script lang="ts">
  // Triggers of this table, in the Structure tab: list, edit, add.
  import { need, needText } from '../../lib/dbTools.svelte';
  import { n, t } from '../../lib/i18n.svelte';
  import { app, openObject } from '../../lib/state.svelte';

  let { table }: { table: string } = $props();

  const list = $derived((app.objects?.triggers ?? []).filter((x) => x.table === table));
  const can = $derived(need(['TRIGGER']));
</script>

<section class="block" aria-labelledby="trg-title">
  <div class="block-head">
    <div>
      <h2 id="trg-title">{t('objects.triggersTitle')} <span class="dim">{n(list.length)}</span></h2>
      <p class="section-help">{t('objects.triggersHelp')}</p>
    </div>
    <button class="v-btn-secondary v-btn--sm" onclick={() => openObject('TRIGGER', null, table)} disabled={!can.ok} title={needText(can)}>+ {t('objects.kind.TRIGGER')}</button>
  </div>
  {#if list.length}
    <ul class="list">
      {#each list as x}
        <li>
          <button class="link mono" onclick={() => openObject('TRIGGER', x.name, table)}>{x.name}</button>
          <span class="v-badge">{x.timing} {x.event}</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty">{t('objects.noTriggers')}</p>
  {/if}
</section>

<style>
  .block {
    display: grid;
    gap: 8px;
  }
  .block-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .section-help {
    margin: 2px 0 0;
    font-size: 12.5px;
    color: var(--sp-text-secondary);
  }
  .dim {
    color: var(--sp-text-tertiary);
    font-weight: 400;
  }
  .list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 6px;
  }
  .list li {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 13px;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--sp-text-primary);
    text-decoration: underline;
    cursor: pointer;
    font-size: inherit;
  }
  .empty {
    margin: 0;
    padding: 10px 14px;
    border: 1px dashed var(--sp-border);
    border-radius: var(--sp-radius-lg);
    font-size: 13px;
    color: var(--sp-text-secondary);
  }
</style>
