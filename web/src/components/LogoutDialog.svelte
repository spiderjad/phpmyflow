<script lang="ts">
  // "Sign out?": the current connection (user@host, environment label in its
  // color), and only the warnings that apply — SQL tabs with changes not run
  // (kept for next time), structure changes not applied (lost), an export
  // running (cancelled). "Forget this connection in recent ones". The sign
  // out button is red only when something would be lost. Focus starts on Cancel.
  import { app } from '../lib/state.svelte';
  import { jobs } from '../lib/jobs.svelte';
  import { tabs } from '../lib/tabs.svelte';
  import { n, t } from '../lib/i18n.svelte';
  import { PALETTE, type ColorId } from '../lib/theme';
  import type { Env } from '../lib/connections';

  let { env = null, color = null, onconfirm }: { env?: Env | null; color?: ColorId | null; onconfirm: (forget: boolean) => void } = $props();

  let dlg: HTMLDialogElement | undefined = $state();
  let cancel: HTMLButtonElement | undefined = $state();
  let forget = $state(false);

  export function open() {
    forget = false;
    dlg?.showModal();
    cancel?.focus();
  }

  const auth = $derived(app.session?.auth);
  const dirtyTabs = $derived(tabs.list.filter((x) => tabs.isDirty(x)).length);
  const structure = $derived(app.pendingStructure);
  const exporting = $derived(jobs.filter((j) => j.kind === 'export' && j.status === 'running').length);
  const losing = $derived(!!structure || exporting > 0);
</script>

<dialog bind:this={dlg} class="v-app v-dialog lo" aria-labelledby="lo-title">
  <header class="v-card__header">
    <h2 class="v-card__title" id="lo-title">{t('logout.title')}</h2>
  </header>
  <div class="v-card__body lo-body">
    {#if auth}
      <p class="lo-conn">
        <span class="mono">{auth.user}@{auth.host}{auth.port !== 3306 ? `:${auth.port}` : ''}</span>
        {#if env}<span class="lo-env" style:--env-l={PALETTE[color ?? 'blue'].light} style:--env-d={PALETTE[color ?? 'blue'].dark}>{t(`env.${env}`)}</span>{/if}
      </p>
    {/if}
    {#if dirtyTabs || structure || exporting}
      <ul class="lo-warn">
        {#if dirtyTabs}
          <li>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M5.5 4.5 2.5 8l3 3.5M10.5 4.5l3 3.5-3 3.5M9 3.5l-2 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <span>{t('logout.tabs', { count: n(dirtyTabs) })}</span>
          </li>
        {/if}
        {#if structure}
          <li class="lose">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 2.5 14 13H2zM8 6.5v3M8 11.2v.1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <span>{t('logout.structure', { table: structure.table, count: n(structure.count) })}</span>
          </li>
        {/if}
        {#if exporting}
          <li class="lose">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 2.5v8M5 7.5l3 3 3-3M3 12.5h10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <span>{t('logout.export', { count: n(exporting) })}</span>
          </li>
        {/if}
      </ul>
    {/if}
    <label class="lo-forget"><input type="checkbox" bind:checked={forget} /> {t('logout.forget')}</label>
  </div>
  <footer class="v-card__footer">
    <button class="v-btn-secondary" bind:this={cancel} onclick={() => dlg?.close()}>{t('common.cancel')}</button>
    <button
      class={losing ? 'v-btn-danger' : 'v-btn-primary'}
      onclick={() => {
        dlg?.close();
        onconfirm(forget);
      }}>{t('logout.confirm')}</button
    >
  </footer>
</dialog>

<style>
  /* Sign out modal (components/LogoutDialog.svelte). */
  .lo {
    width: min(460px, calc(100vw - 32px));
  }
  .lo-body {
    display: grid;
    gap: 12px;
  }
  .lo-conn {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin: 0;
  }
  .lo-env {
    padding: 1px 8px;
    border: 1px solid currentColor;
    border-radius: 999px;
    color: var(--env-l);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  :global(:root[data-mode='dark']) .lo-env {
    color: var(--env-d);
  }
  .lo-warn {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 10px 12px;
    border: 1px solid var(--sp-warning-border);
    border-radius: var(--sp-radius);
    background: var(--sp-warning-light);
    list-style: none;
    font-size: 13px;
  }
  .lo-warn li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .lo-warn svg {
    flex: none;
    margin-top: 1px;
    color: var(--sp-text-secondary);
  }
  .lo-warn li.lose svg {
    color: var(--sp-warning);
  }
  .lo-forget {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
</style>
