<script lang="ts">
  // Run a procedure or function: one field per parameter (a RecordPicker
  // when the name points to a table: customer_id -> customers), then the
  // result sets and the OUT values.
  import { onMount } from 'svelte';
  import { n, t } from '../../lib/i18n.svelte';
  import { dtdToDef, objApi, paramTable, type ExecResult } from '../../lib/objects';
  import { realType } from '../../lib/columnTypes';
  import { app } from '../../lib/state.svelte';
  import Modal from '../db/Modal.svelte';
  import RecordPicker from './RecordPicker.svelte';
  import ResultTable from './ResultTable.svelte';

  let { db, kind, name, onclose }: { db: string; kind: 'PROCEDURE' | 'FUNCTION'; name: string; onclose: () => void } = $props();

  let params = $state<{ mode: string; name: string; type: string; value: string; isNull: boolean; table: string | null }[]>([]);
  let result = $state<ExecResult | null>(null);
  let error = $state('');
  let busy = $state(false);

  const tablesPk = $derived(
    Object.entries(app.schema).map(([tb, s]) => {
      const pks = s.columns.filter((c) => c.key === 'PRI');
      return { name: tb, pk: pks.length === 1 ? pks[0].name : null };
    }),
  );

  onMount(async () => {
    try {
      const info = await objApi.info(db, kind, name);
      params = (info.params ?? []).map((p: any) => ({
        mode: p.mode ?? 'IN',
        name: p.name,
        type: realType(dtdToDef(p.type)),
        value: '',
        isNull: false,
        table: paramTable(p.name, tablesPk),
      }));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  });

  async function run() {
    busy = true;
    error = '';
    try {
      result = await objApi.execute(db, kind, name, params.map((p) => ({ value: p.mode === 'OUT' || p.isNull ? null : p.value })));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      result = null;
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={t('objects.execTitle', { name })} {onclose} width={720}>
  {#if params.length}
    <div class="params">
      {#each params as p, i}
        <div class="param">
          <label for="arg-{i}" class="pname"><span class="mono">{p.name}</span> <span class="v-badge">{p.mode}</span> <span class="dim mono">{p.type}</span></label>
          {#if p.mode === 'OUT'}
            <span class="dim">{t('objects.outParam')}</span>
          {:else if p.table && !p.isNull}
            <RecordPicker {db} table={p.table} value={p.value || null} id="arg-{i}" label={p.name} compact onchange={(v) => (p.value = v ?? '')} />
          {:else}
            <input id="arg-{i}" class="v-input mono" bind:value={p.value} disabled={p.isNull} />
          {/if}
          {#if p.mode !== 'OUT'}<label class="inline null"><input type="checkbox" bind:checked={p.isNull} /> NULL</label>{/if}
        </div>
      {/each}
    </div>
  {:else if !error}
    <p class="hint">{t('objects.noParams')}</p>
  {/if}
  <p class="hint">{t('objects.execWarn')}</p>
  {#if error}<p class="v-banner v-banner--danger" role="alert">{error}</p>{/if}
  {#if result}
    <section aria-live="polite" class="results">
      <p class="hint">{t('objects.execDone', { ms: n(result.timeMs) })}</p>
      {#if Object.keys(result.out).length}
        <h3>{t('objects.outValues')}</h3>
        <dl class="out">
          {#each Object.entries(result.out) as [k, v]}<dt class="mono">{k}</dt><dd class="mono">{v === null ? 'NULL' : String(v)}</dd>{/each}
        </dl>
      {/if}
      {#each result.resultSets as rs, i}
        <h3>{t('objects.resultSet', { n: i + 1 })}</h3>
        <ResultTable columns={rs.columns} rows={rs.rows} truncated={rs.truncated} caption={t('objects.resultSet', { n: i + 1 })} />
      {/each}
    </section>
  {/if}
  {#snippet footer()}
    <button class="v-btn-secondary" onclick={onclose}>{t('common.close')}</button>
    <button class="v-btn-primary" onclick={run} disabled={busy}>{busy ? t('objects.running') : t('objects.run')}</button>
  {/snippet}
</Modal>

<style>
  .params {
    display: grid;
    gap: 8px;
  }
  .param {
    display: grid;
    grid-template-columns: minmax(160px, 1fr) 2fr auto;
    gap: 8px;
    align-items: center;
  }
  .pname {
    font-size: 12.5px;
  }
  .dim {
    color: var(--sp-text-tertiary);
    font-size: 12px;
  }
  .null {
    font-size: 12px;
  }
  .results {
    display: grid;
    gap: 6px;
  }
  h3 {
    margin: 6px 0 0;
    font-size: 13px;
  }
  .out {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 12px;
    margin: 0;
    font-size: 12.5px;
  }
  dd {
    margin: 0;
  }
  @media (max-width: 560px) {
    .param {
      grid-template-columns: 1fr;
    }
  }
</style>
