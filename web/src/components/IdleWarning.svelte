<script lang="ts">
  // A minute before the session expires for inactivity: a modal with a
  // countdown, "Stay signed in" (renews the session on the server) and "Sign
  // out". Screen readers hear the time left every 15 s, not every second.
  import { keepalive } from '../lib/api';
  import { idle } from '../lib/idle.svelte';
  import { t } from '../lib/i18n.svelte';

  let { onlogout }: { onlogout: () => void } = $props();

  const WARN = 60;
  let dlg: HTMLDialogElement | undefined = $state();
  let stay: HTMLButtonElement | undefined = $state();
  let now = $state(Date.now());
  let announced = $state('');
  let busy = $state(false);

  $effect(() => {
    const h = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(h);
  });

  const left = $derived(Math.max(0, Math.ceil(idle.seconds - (now - idle.lastAt) / 1000)));
  const warn = $derived(left <= WARN);
  const clock = $derived(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);

  $effect(() => {
    if (!dlg) return;
    if (warn && !dlg.open) {
      dlg.showModal();
      stay?.focus();
    } else if (!warn && dlg.open) dlg.close();
  });
  // Announce at 60, 45, 30 and 15 s (and when it opens).
  $effect(() => {
    if (!warn) {
      announced = '';
      return;
    }
    if (left % 15 === 0 || !announced) announced = t('idle.title', { time: clock });
  });
  $effect(() => {
    if (warn && left === 0) {
      dlg?.close();
      onlogout();
    }
  });

  async function renew() {
    busy = true;
    try {
      const r = await keepalive();
      idle.seconds = r.idleSeconds;
    } catch {
      // Session already gone: the app goes back to the login on its own.
    } finally {
      busy = false;
    }
  }
</script>

<dialog bind:this={dlg} class="v-app v-dialog idle" aria-labelledby="idle-title" aria-describedby="idle-body" oncancel={(e) => { e.preventDefault(); void renew(); }}>
  <header class="v-card__header">
    <h2 class="v-card__title" id="idle-title">{t('idle.heading')}</h2>
  </header>
  <div class="v-card__body" id="idle-body">
    <p class="idle-time" aria-hidden="true">{t('idle.title', { time: clock })}</p>
    <p class="sr-only" aria-live="polite">{announced}</p>
    <p class="v-help">{t('idle.body')}</p>
  </div>
  <footer class="v-card__footer">
    <button class="v-btn-secondary" onclick={() => { dlg?.close(); onlogout(); }}>{t('logout.confirm')}</button>
    <button class="v-btn-primary" bind:this={stay} onclick={renew} disabled={busy}>{t('idle.stay')}</button>
  </footer>
</dialog>

<style>
  /* Inactivity warning (components/IdleWarning.svelte). */
  .idle {
    width: min(420px, calc(100vw - 32px));
  }
  .idle-time {
    margin: 0 0 6px;
    font-size: 15px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
</style>
