<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { ApiError, monitorApi } from '../../lib/api';
  import { friendlyError } from '../../lib/errors';
  import { t } from '../../lib/i18n.svelte';
  import { mon, startMonitor, stopMonitor } from '../../lib/monitorState.svelte';
  import HistoryPanel from './HistoryPanel.svelte';
  import LivePanel from './LivePanel.svelte';
  import MissingPrivilegeBox from './MissingPrivilege.svelte';
  import ProcessPanel from './ProcessPanel.svelte';
  import StoragePanel from './StoragePanel.svelte';
  import TopQueriesPanel from './TopQueriesPanel.svelte';

  type Sub = 'live' | 'processes' | 'queries' | 'storage' | 'history';
  const subs: Sub[] = ['live', 'processes', 'queries', 'storage', 'history'];
  const SUB_KEY = 'pmf_monitor_tab';
  let sub = $state<Sub>(read());
  let error = $state('');

  function read(): Sub {
    try {
      const v = localStorage.getItem(SUB_KEY) as Sub | null;
      return v && subs.includes(v) ? v : 'live';
    } catch {
      return 'live';
    }
  }
  function choose(s: Sub) {
    sub = s;
    try {
      localStorage.setItem(SUB_KEY, s);
    } catch {
      /* ignore */
    }
  }
  function tabKey(e: KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = subs[(i + (e.key === 'ArrowRight' ? 1 : -1) + subs.length) % subs.length];
    choose(next);
    (document.getElementById(`mon-tab-${next}`) as HTMLElement | null)?.focus();
  }

  onMount(async () => {
    try {
      mon.caps = await monitorApi.caps();
    } catch (err) {
      error = err instanceof ApiError ? friendlyError(err).title : String(err);
    }
    startMonitor();
  });
  onDestroy(stopMonitor);

  const caps = $derived(mon.caps);
</script>

<section class="monitor">
  <header class="head">
    <div>
      <h1>{t('monitor.title')}</h1>
      {#if caps}
        <p class="dim">
          {caps.flavor === 'mariadb' ? 'MariaDB' : 'MySQL'} · <span class="mono">{caps.version}</span> ·
          performance_schema {caps.performanceSchema ? (caps.performanceSchemaReadable ? '✓' : t('monitor.ps.noAccess')) : t('monitor.ps.offShort')}
          · <span class="mono">{caps.grantee}</span>
        </p>
      {/if}
    </div>
  </header>

  {#if error}<p class="v-banner v-banner--danger" role="alert">{error}</p>{/if}
  {#if caps && !caps.hasProcess}
    <MissingPrivilegeBox privilege="PROCESS" grant={caps.grants.process} what={t('monitor.missing.process')} />
  {/if}
  {#if caps && caps.performanceSchema && !caps.performanceSchemaReadable}
    <MissingPrivilegeBox privilege="SELECT" grant={caps.grants.performanceSchema} what={t('monitor.missing.ps')} />
  {/if}

  <div class="v-segmented subtabs" role="tablist" aria-label={t('monitor.title')}>
    {#each subs as s, i}
      <button
        class="v-segmented__item"
        role="tab"
        id="mon-tab-{s}"
        aria-selected={sub === s}
        aria-controls="mon-panel"
        tabindex={sub === s ? 0 : -1}
        onclick={() => choose(s)}
        onkeydown={(e) => tabKey(e, i)}>{t(`monitor.tab.${s}`)}</button
      >
    {/each}
  </div>

  <div id="mon-panel" role="tabpanel" aria-labelledby="mon-tab-{sub}" class="panel">
    {#if sub === 'live'}
      <LivePanel />
    {:else if sub === 'processes'}
      <ProcessPanel />
    {:else if sub === 'queries'}
      <TopQueriesPanel />
    {:else if sub === 'storage'}
      <StoragePanel />
    {:else}
      <HistoryPanel />
    {/if}
  </div>
</section>

<style>
  .monitor {
    height: 100%;
    overflow: auto;
    padding: 16px 20px 32px;
    display: grid;
    gap: 12px;
    align-content: start;
  }
  .head h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .dim {
    margin: 2px 0 0;
    color: var(--sp-text-secondary);
    font-size: 12.5px;
  }
  .subtabs {
    justify-self: start;
    flex-wrap: wrap;
  }
  .panel {
    min-width: 0;
  }
  @media (max-width: 640px) {
    .monitor {
      padding: 12px;
    }
  }
</style>
