<script lang="ts">
  // OPTIMIZE / ANALYZE / CHECK / REPAIR / CHECKSUM on some tables, one at a
  // time as a background job; results per table in the jobs panel.
  import { untrack } from 'svelte';
  import { closeDialog, managedOk } from '../../lib/dbActions.svelte';
  import { n, t } from '../../lib/i18n.svelte';
  import { startJob } from '../../lib/jobs.svelte';
  import { app } from '../../lib/state.svelte';
  import { bigTable, runMaintenance, sizeText } from '../../lib/toolJobs';
  import type { MaintOp } from '../../lib/toolsApi';
  import Modal from '../db/Modal.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Select from '../ui/Select.svelte';

  let { db, tables = [] }: { db: string; tables?: string[] } = $props();

  let op = $state<MaintOp>('ANALYZE');
  let checkOpt = $state('');
  let sumOpt = $state('');
  const all = $derived(app.db === db ? app.tables.filter((x) => x.type !== 'VIEW') : []);
  let picked = $state<Set<string>>(untrack(() => new Set(tables)));
  let filter = $state('');

  const chosen = $derived(all.filter((x) => picked.has(x.name)));
  const notMyisam = $derived(chosen.filter((x) => !['myisam', 'aria', 'archive', 'csv'].includes((x.engine ?? '').toLowerCase())));
  const big = $derived(chosen.filter((x) => bigTable(Number(x.bytes ?? 0))));
  const shown = $derived(all.filter((x) => !filter.trim() || x.name.toLowerCase().includes(filter.trim().toLowerCase())));
  const ops: MaintOp[] = ['ANALYZE', 'OPTIMIZE', 'CHECK', 'REPAIR', 'CHECKSUM'];

  function toggle(name: string) {
    const s = new Set(picked);
    s.has(name) ? s.delete(name) : s.add(name);
    picked = s;
  }
  async function go() {
    const [d, list, o, opt] = [db, chosen.map((x) => x.name), op, op === 'CHECK' ? checkOpt || null : op === 'CHECKSUM' ? sumOpt || null : null];
    if ((o === 'OPTIMIZE' || o === 'REPAIR') && !(await managedOk(d))) return;
    closeDialog();
    const job = startJob('maintenance', t('maint.jobTitle', { op: o, count: n(list.length) }));
    void runMaintenance(d, list, o, opt, job);
  }
</script>

<Modal title={t('maint.title', { db })} onclose={closeDialog} width={620}>
  <div class="field">
    <span>{t('maint.operation')}</span>
    <Segmented options={ops.map((o) => ({ value: o, label: o, hint: t(`maint.hint.${o}`) }))} value={op} label={t('maint.operation')} onchange={(v) => (op = v)} />
  </div>
  {#if op === 'CHECK'}
    <div class="field small">
      <span>{t('maint.checkMode')}</span>
      <Select value={checkOpt} label={t('maint.checkMode')} options={[{ value: '', label: t('maint.default') }, ...['QUICK', 'FAST', 'MEDIUM', 'EXTENDED', 'CHANGED'].map((v) => ({ value: v, label: v, hint: t(`maint.check.${v}`) }))]} onchange={(v) => (checkOpt = v)} />
    </div>
  {:else if op === 'CHECKSUM'}
    <div class="field small">
      <span>{t('maint.checkMode')}</span>
      <Select value={sumOpt} label={t('maint.checkMode')} options={[{ value: '', label: t('maint.default') }, { value: 'QUICK', label: 'QUICK' }, { value: 'EXTENDED', label: 'EXTENDED' }]} onchange={(v) => (sumOpt = v)} />
    </div>
  {/if}

  <div class="field">
    <span>{t('maint.tables', { count: n(picked.size) })}</span>
    <input class="v-input" type="search" bind:value={filter} placeholder={t('export.filter')} aria-label={t('export.filter')} />
    <div class="list" role="group" aria-label={t('maint.tables', { count: n(picked.size) })}>
      {#each shown as x (x.name)}
        <label class="inline"><input type="checkbox" aria-label={x.name} checked={picked.has(x.name)} onchange={() => toggle(x.name)} /> <span class="mono">{x.name}</span> <span class="dim">{x.engine} · {sizeText(Number(x.bytes ?? 0))}</span></label>
      {/each}
    </div>
    <div class="acts">
      <button class="v-btn-ghost v-btn--sm" onclick={() => (picked = new Set(all.map((x) => x.name)))}>{t('export.selectAll')}</button>
      <button class="v-btn-ghost v-btn--sm" onclick={() => (picked = new Set())}>{t('export.selectNone')}</button>
    </div>
  </div>

  {#if op === 'REPAIR'}
    <p class="v-banner v-banner--warning" role="note">⚠ {t('maint.repairWarn')}{#if notMyisam.length} {t('maint.repairSkip', { tables: notMyisam.map((x) => x.name).join(', ') })}{/if}</p>
  {/if}
  {#if (op === 'OPTIMIZE' || op === 'REPAIR' || (op === 'CHECK' && checkOpt === 'EXTENDED')) && big.length}
    <p class="v-banner v-banner--warning" role="note">⚠ {t('maint.lockWarn', { tables: big.map((x) => `${x.name} (${sizeText(Number(x.bytes ?? 0))})`).join(', ') })}</p>
  {/if}
  {#snippet footer()}
    <button class="v-btn-secondary" onclick={closeDialog}>{t('common.cancel')}</button>
    <button class="v-btn-primary" onclick={go} disabled={!picked.size}>{t('maint.run', { op })}</button>
  {/snippet}
</Modal>

<style>
  .field {
    display: grid;
    gap: 6px;
  }
  .field > span {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--sp-text-secondary);
  }
  .small :global(.sel) {
    max-width: 220px;
  }
  .list {
    max-height: 200px;
    overflow: auto;
    display: grid;
    gap: 2px;
    padding: 6px 8px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
    font-size: 12.5px;
  }
  .dim {
    color: var(--sp-text-tertiary);
    font-size: 11.5px;
  }
  .acts {
    display: flex;
    gap: 6px;
  }
</style>
