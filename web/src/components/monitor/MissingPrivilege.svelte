<script lang="ts">
  import { copyText } from '../../lib/clipboard';
  import { t } from '../../lib/i18n.svelte';
  import { toast } from '../../lib/ui.svelte';

  let { privilege, grant, what }: { privilege: string; grant: string; what: string } = $props();

  async function copy() {
    toast((await copyText(grant)) ? t('copy.cell') : t('copy.failed'), 'info', 1800);
  }
</script>

<div class="v-banner v-banner--warning missing" role="status">
  <p><strong>{t('monitor.missing.title', { privilege })}</strong> {what}</p>
  <p class="how">{t('monitor.missing.how')}</p>
  <div class="grant">
    <code>{grant}</code>
    <button class="v-btn-secondary v-btn--sm" onclick={copy}>{t('common.copy')}</button>
  </div>
</div>

<style>
  .missing p {
    margin: 0 0 6px;
  }
  .how {
    font-size: 12.5px;
  }
  .grant {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  code {
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    border-radius: var(--sp-radius);
    background: var(--sp-bg);
    color: var(--sp-text-primary);
    font-family: var(--sp-font-mono);
    font-size: 12px;
    overflow-x: auto;
    white-space: nowrap;
  }
</style>
