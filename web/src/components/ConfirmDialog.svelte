<script lang="ts">
  import { t } from '../lib/i18n.svelte';

  // Promise-based confirm built on native <dialog> (focus trap + Esc for free).
  let dialog: HTMLDialogElement;
  let title = $state('');
  let body = $state('');
  let confirmLabel = $state('');
  let danger = $state(false);
  let resolver: ((ok: boolean) => void) | null = null;

  export function ask(opts: { title: string; body: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
    title = opts.title;
    body = opts.body;
    confirmLabel = opts.confirmLabel ?? t('common.confirm');
    danger = opts.danger ?? false;
    dialog.showModal();
    return new Promise((resolve) => (resolver = resolve));
  }

  function close(ok: boolean) {
    dialog.close();
    resolver?.(ok);
    resolver = null;
  }
</script>

<dialog class="v-app v-dialog" bind:this={dialog} oncancel={() => close(false)} aria-labelledby="confirm-title">
  <header class="v-card__header"><h2 class="v-card__title" id="confirm-title">{title}</h2></header>
  <div class="v-card__body"><p>{body}</p></div>
  <footer class="v-card__footer">
    <button class="v-btn-secondary" onclick={() => close(false)}>{t('common.cancel')}</button>
    <button class={danger ? 'v-btn-danger' : 'v-btn-primary'} onclick={() => close(true)}>{confirmLabel}</button>
  </footer>
</dialog>

<style>
  p {
    margin: 0;
    color: var(--sp-text-secondary);
    white-space: pre-line;
  }
</style>
