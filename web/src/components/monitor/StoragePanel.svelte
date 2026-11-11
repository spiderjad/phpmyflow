<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError, monitorApi, type AdvisorItem, type Deadlock, type MissingPrivilege, type StorageInfo } from '../../lib/api';
  import { formatBytes } from '../../lib/bytes';
  import { friendlyError } from '../../lib/errors';
  import { i18n, n, t } from '../../lib/i18n.svelte';
  import { fmtPct } from '../../lib/monitor';
  import { mon } from '../../lib/monitorState.svelte';
  import { confirmAction, toast } from '../../lib/ui.svelte';
  import MissingPrivilegeBox from './MissingPrivilege.svelte';

  let storage = $state<StorageInfo | null>(null);
  let advisor = $state<AdvisorItem[] | null>(null);
  let deadlock = $state<{ available: boolean; missing?: MissingPrivilege; deadlock?: Deadlock | null } | null>(null);
  let error = $state('');
  let optimizing = $state('');

  const loc = $derived(i18n.locale);
  const size = (b: number) => formatBytes(b, loc);

  async function load() {
    error = '';
    const settle = async <T,>(p: Promise<T>, set: (v: T) => void) => {
      try {
        set(await p);
      } catch (err) {
        error = err instanceof ApiError ? friendlyError(err).title : String(err);
      }
    };
    await Promise.all([
      settle(monitorApi.storage(), (v) => (storage = v)),
      settle(monitorApi.advisor(), (v) => (advisor = v.items)),
      settle(monitorApi.deadlock(mon.hideLiterals), (v) => (deadlock = v)),
    ]);
  }
  onMount(load);

  const top15 = $derived(storage ? storage.tables.slice(0, 15) : []);
  const maxSize = $derived(Math.max(1, ...top15.map((tb) => tb.data + tb.idx)));

  async function optimize(db: string, table: string, free: number) {
    const ok = await confirmAction({
      title: t('monitor.storage.optimizeTitle', { table: `${db}.${table}` }),
      body: t('monitor.storage.optimizeBody', { free: size(free) }),
      confirmLabel: t('monitor.storage.optimize'),
      danger: true,
    });
    if (!ok) return;
    optimizing = `${db}.${table}`;
    try {
      const res = await monitorApi.optimize(db, table);
      toast(t('monitor.storage.optimized', { table: `${db}.${table}`, s: n(Math.round(res.timeMs / 100) / 10) }), 'success');
      storage = await monitorApi.storage();
    } catch (err) {
      toast(err instanceof ApiError ? friendlyError(err).title : String(err), 'error', 6000);
    } finally {
      optimizing = '';
    }
  }

  const levelIcon: Record<AdvisorItem['level'], string> = { ok: '✓', info: 'ℹ', warn: '⚠', crit: '⛔' };

  /** Advisor params formatted for the message. */
  function advParams(a: AdvisorItem): Record<string, string> {
    const p = a.params as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === 'number') out[k] = ['pool', 'data', 'size', 'tmpSize'].includes(k) ? size(v) : k === 'pct' ? fmtPct(v, loc) : n(v);
      else if (typeof v === 'string') out[k] = v;
    }
    return out;
  }
  const advList = (a: AdvisorItem): string[] => {
    const p = a.params as Record<string, unknown>;
    return (Array.isArray(p.tables) ? p.tables : Array.isArray(p.columns) ? p.columns : Array.isArray(p.items) ? p.items : []) as string[];
  };
</script>

<div class="storage">
  <div class="v-toolbar v-toolbar--sub bar">
    <span class="dim">{t('monitor.storage.note')}</span>
    <span class="v-toolbar__spacer"></span>
    <button class="v-btn-ghost v-btn--sm" onclick={load}>{t('common.refresh')}</button>
  </div>
  {#if error}<p class="v-banner v-banner--danger" role="alert">{error}</p>{/if}

  <div class="cols">
    <section class="v-card block">
      <h3>{t('monitor.storage.databases')}</h3>
      {#if storage}
        <table class="grid list">
          <thead><tr><th>{t('monitor.storage.db')}</th><th class="num">{t('monitor.storage.tables')}</th><th class="num">{t('structure.data')}</th><th class="num">{t('structure.indexes')}</th><th class="num">{t('structure.free')}</th></tr></thead>
          <tbody>
            {#each storage.databases as d}
              <tr><td class="mono">{d.db}</td><td class="num">{n(d.tables)}</td><td class="num">{size(d.data)}</td><td class="num">{size(d.idx)}</td><td class="num">{size(d.free)}</td></tr>
            {/each}
          </tbody>
        </table>
      {:else}<p class="dim">{t('common.loading')}</p>{/if}
    </section>

    <section class="v-card block">
      <h3>{t('monitor.storage.largest')}</h3>
      <ul class="bars" aria-label={t('monitor.storage.largest')}>
        {#each top15 as tb}
          {@const total = tb.data + tb.idx}
          <li>
            <span class="bar-label mono" title="{tb.db}.{tb.name}">{tb.db}.<strong>{tb.name}</strong></span>
            <span class="bar-track" aria-hidden="true">
              <span class="bar-data" style:width="{(tb.data / maxSize) * 100}%"></span><span class="bar-idx" style:width="{(tb.idx / maxSize) * 100}%"></span>
            </span>
            <span class="bar-value">{size(total)}</span>
          </li>
        {/each}
      </ul>
      <p class="legend"><span class="sw data"></span> {t('structure.data')} <span class="sw idx"></span> {t('structure.indexes')}</p>
    </section>
  </div>

  <section class="v-card block">
    <h3>{t('monitor.storage.fragmented')}</h3>
    {#if storage && storage.fragmented.length}
      <p class="small">{t('monitor.storage.fragmentedHelp')}</p>
      <table class="grid list">
        <thead><tr><th>{t('relations.source')}</th><th class="num">{t('structure.total')}</th><th class="num">{t('structure.free')}</th><th>{t('structure.engine')}</th><th></th></tr></thead>
        <tbody>
          {#each storage.fragmented as tb}
            <tr>
              <td class="mono">{tb.db}.{tb.name}</td>
              <td class="num">{size(tb.data + tb.idx)}</td>
              <td class="num">{size(tb.free)} <span class="dim">({fmtPct(tb.free / Math.max(1, tb.data + tb.idx), loc, 0)})</span></td>
              <td>{tb.engine}</td>
              <td class="actions">
                {#if !mon.caps?.readOnly}
                  <button class="v-btn-secondary v-btn--sm" disabled={!!optimizing} onclick={() => optimize(tb.db, tb.name, tb.free)}>
                    {optimizing === `${tb.db}.${tb.name}` ? t('monitor.storage.optimizing') : 'OPTIMIZE TABLE'}
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if storage}
      <p class="dim">{t('monitor.storage.noFragmented')}</p>
    {/if}
  </section>

  <section class="v-card block" aria-labelledby="advisor-title">
    <h3 id="advisor-title">{t('monitor.advisor.title')}</h3>
    {#if advisor}
      <ul class="advisor">
        {#each advisor as a}
          {@const list = advList(a)}
          <li class={a.level}>
            <span class="icon" aria-hidden="true">{levelIcon[a.level]}</span>
            <div>
              <p class="adv-title"><span class="sr-only">{t(`monitor.level.${a.level}`)}:</span>{t(`advisor.${a.id}.title`, advParams(a))}</p>
              <p class="adv-text">{t(`advisor.${a.id}.text`, advParams(a))}</p>
              {#if a.id !== 'all_good'}<p class="adv-fix"><strong>{t('monitor.advisor.recommend')}</strong> {t(`advisor.${a.id}.fix`, advParams(a))}</p>{/if}
              {#if list.length}
                <details><summary>{t('monitor.advisor.show', { count: n(list.length) })}</summary><ul class="mono items">{#each list as x}<li>{x}</li>{/each}</ul></details>
              {/if}
              {#if a.ref}<p class="ref">{t('monitor.advisor.ref')} <code>{a.ref}</code></p>{/if}
            </div>
          </li>
        {/each}
      </ul>
    {:else}<p class="dim">{t('common.loading')}</p>{/if}
  </section>

  <section class="v-card block" aria-labelledby="deadlock-title">
    <h3 id="deadlock-title">{t('monitor.deadlock.title')}</h3>
    {#if deadlock?.missing}
      <MissingPrivilegeBox privilege={deadlock.missing.privilege} grant={deadlock.missing.grant} what={t('monitor.deadlock.needs')} />
    {:else if deadlock && !deadlock.deadlock}
      <p class="dim">{t('monitor.deadlock.none')}</p>
    {:else if deadlock?.deadlock}
      {@const dl = deadlock.deadlock}
      <p class="small">{dl.time ? t('monitor.deadlock.at', { time: dl.time }) : ''} {dl.rolledBack ? t('monitor.deadlock.rolledBack', { n: dl.rolledBack }) : ''}</p>
      <div class="txs">
        {#each dl.transactions as tx}
          <article class="tx" class:victim={dl.rolledBack === tx.n}>
            <h4>{t('monitor.deadlock.tx', { n: tx.n })} {#if dl.rolledBack === tx.n}<span class="v-badge v-badge--danger">{t('monitor.deadlock.victim')}</span>{/if}</h4>
            <p class="small">{tx.user ?? '?'}@{tx.host ?? '?'} · {t('monitor.proc.thread', { id: tx.thread ?? '?' })}</p>
            <pre class="mono">{tx.query}</pre>
            {#if tx.holds.length}<p class="small"><strong>{t('monitor.deadlock.holds')}</strong> {tx.holds.map((l) => `${l.table}${l.index ? ' (' + l.index + ')' : ''} ${l.mode}`).join('; ')}</p>{/if}
            {#if tx.waits.length}<p class="small"><strong>{t('monitor.deadlock.waits')}</strong> {tx.waits.map((l) => `${l.table}${l.index ? ' (' + l.index + ')' : ''} ${l.mode}`).join('; ')}</p>{/if}
          </article>
        {/each}
      </div>
    {:else}<p class="dim">{t('common.loading')}</p>{/if}
  </section>
</div>

<style>
  .storage {
    display: grid;
    gap: 12px;
  }
  .bar {
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
    font-size: 12.5px;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
    gap: 12px;
  }
  .block {
    padding: 12px 14px;
    min-width: 0;
    overflow: auto;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 13px;
  }
  .list {
    width: 100%;
    font-family: var(--sp-font);
    font-size: 12.5px;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .actions {
    text-align: right;
  }
  .dim {
    color: var(--sp-text-tertiary);
  }
  .small {
    margin: 0 0 6px;
    font-size: 12.5px;
    color: var(--sp-text-secondary);
  }
  .bars {
    display: grid;
    gap: 5px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .bars li {
    display: grid;
    grid-template-columns: minmax(120px, 38%) 1fr auto;
    gap: 8px;
    align-items: center;
    font-size: 12px;
  }
  .bar-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--sp-text-secondary);
  }
  .bar-label strong {
    color: var(--sp-text-primary);
    font-weight: 500;
  }
  .bar-track {
    display: flex;
    height: 10px;
    border-radius: 3px;
    background: var(--sp-bg-muted);
    overflow: hidden;
  }
  .bar-data,
  .sw.data {
    background: var(--chart-1);
  }
  .bar-idx,
  .sw.idx {
    background: var(--chart-2);
  }
  .bar-value {
    font-variant-numeric: tabular-nums;
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 8px 0 0;
    font-size: 11.5px;
    color: var(--sp-text-secondary);
  }
  .sw {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }
  .advisor {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .advisor > li {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
  }
  .advisor > li.warn {
    border-color: var(--sp-warning-border);
    background: var(--sp-warning-light);
  }
  .advisor > li.crit {
    border-color: var(--sp-danger-border);
    background: var(--sp-danger-light);
  }
  .advisor > li.ok {
    border-color: var(--sp-success-border);
    background: var(--sp-success-light);
  }
  .icon {
    flex-shrink: 0;
    width: 18px;
    text-align: center;
  }
  .warn .icon {
    color: var(--sp-warning);
  }
  .crit .icon {
    color: var(--sp-danger-text);
  }
  .ok .icon {
    color: var(--sp-success);
  }
  .adv-title {
    margin: 0 0 2px;
    font-weight: 600;
    font-size: 13px;
  }
  .adv-text,
  .adv-fix,
  .ref {
    margin: 0 0 4px;
    font-size: 12.5px;
  }
  .ref code {
    font-family: var(--sp-font-mono);
    font-size: 12px;
  }
  details summary {
    cursor: pointer;
    font-size: 12.5px;
  }
  .items {
    margin: 4px 0;
    padding-left: 18px;
    font-size: 12px;
  }
  .txs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 10px;
  }
  .tx {
    padding: 10px 12px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
  }
  .tx.victim {
    border-color: var(--sp-danger-border);
  }
  .tx h4 {
    margin: 0 0 4px;
    font-size: 13px;
  }
  pre {
    margin: 0 0 6px;
    padding: 8px 10px;
    border-radius: var(--sp-radius);
    background: var(--sp-bg-subtle);
    font-size: 12px;
    white-space: pre-wrap;
  }
</style>
