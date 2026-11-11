<script lang="ts">
  import { n, t } from '../../lib/i18n.svelte';
  import type { Description, FailedChange, ServerWarning } from '../../lib/tableDraft';
  import { describeText } from '../../lib/describeText';
  import Drawer from './Drawer.svelte';

  /** A failed ALTER, as the server explained it. */
  export interface Failure {
    title: string;
    server: string;
    change: FailedChange | null;
    cause: 'fk_orphans' | 'check_violations' | null;
    params: Record<string, unknown>;
    nullified: number;
  }

  let {
    table,
    items,
    warnings,
    sql,
    loading,
    error,
    failure,
    managed,
    applying,
    onapply,
    onclose,
    onfix,
    onremove,
    onviewrows,
    onretrywithout,
  }: {
    table: string;
    items: Description[];
    warnings: ServerWarning[];
    sql: string;
    loading: boolean;
    error: string;
    failure: Failure | null;
    managed: 'glpi' | 'wordpress' | null;
    applying: boolean;
    onapply: () => void;
    onclose: () => void;
    /** Orphans: decide what happens to them (null = undecided). */
    onfix: (fk: string, fix: 'nullify' | null) => void;
    /** Take one change out of the pending list. */
    onremove: (change: FailedChange) => void;
    /** Open the rows behind an orphans warning or failure. */
    onviewrows: (params: Record<string, unknown>) => void;
    onretrywithout: (change: FailedChange) => void;
  } = $props();

  let showSql = $state(false);
  let typed = $state('');

  // Which server warning explains which description.
  const WARN_FOR: Record<string, ServerWarning['code'][]> = {
    'editor.desc.shrink': ['truncate'],
    'editor.desc.notNull': ['nulls'],
    'editor.desc.type': ['convert', 'truncate'],
    'editor.desc.dropColumn': ['drop_data'],
    'editor.desc.addIndex': ['duplicates'],
    'editor.desc.addPrimary': ['duplicates'],
    'editor.desc.addCheck': ['check_violations'],
    'editor.desc.addFk': ['fk_orphans', 'fk_issue'],
  };
  function warningsFor(d: Description): ServerWarning[] {
    const codes = WARN_FOR[d.key] ?? [];
    return warnings.filter((w) => codes.includes(w.code) && (!w.column || w.column === d.column));
  }
  const count = (w: ServerWarning) => n(w.count) + (w.more ? '+' : '');
  const str = (p: Record<string, unknown> | undefined) =>
    Object.fromEntries(Object.entries(p ?? {}).map(([k, v]) => [k, typeof v === 'number' ? n(v) : Array.isArray(v) ? v.join(', ') : String(v ?? '')]));
  function orphanText(p: Record<string, unknown>): string {
    const c = Number(p.count ?? 0);
    const samples = (p.samples as string[] | undefined) ?? [];
    const base = t('fk.orphansReview', { ...str(p), count: n(c) + (p.more ? '+' : '') });
    return samples.length ? `${base} ${t('fk.orphansSamples', { samples: samples.join(', ') })}` : base;
  }

  const blocking = $derived(warnings.filter((w) => w.blocking).length);
  const confirmOk = $derived(!managed || typed.trim() === table);
  const canApply = $derived(!applying && !loading && !error && !blocking && confirmOk);

  /** "Add the column **priority**" -> safe parts with bold segments. */
  function parts(text: string): { text: string; bold: boolean }[] {
    return text.split('**').map((p, i) => ({ text: p, bold: i % 2 === 1 }));
  }
</script>

<Drawer title={t('editor.review.title')} {onclose} width={560}>
  {#if managed}
    <p class="v-banner v-banner--warning" role="note"><strong>⚠ {t('managed.title', { app: managed === 'glpi' ? 'GLPI' : 'WordPress' })}</strong> {t(`managed.${managed}`)}</p>
  {/if}

  {#if failure}
    <section class="failure" role="alert" aria-labelledby="fail-title">
      <h3 id="fail-title">{t('alter.failed.title')}</h3>
      <p>{t('alter.failed.body')}</p>
      {#if failure.nullified}<p class="partial">{t('alter.failed.nullified', { count: n(failure.nullified) })}</p>{/if}
      <p class="cause">
        <strong>{t('alter.failed.cause')}</strong>
        {#if failure.cause === 'fk_orphans'}{orphanText(failure.params)}
        {:else if failure.cause === 'check_violations'}{t('editor.warn.check_violations', str(failure.params))}
        {:else}{failure.title}{/if}
      </p>
      <details><summary>{t('alter.failed.server')}</summary><pre class="mono">{failure.server}</pre></details>
      <div class="acts">
        {#if failure.cause === 'fk_orphans'}<button class="v-btn-secondary v-btn--sm" onclick={() => onviewrows(failure!.params)}>{t('fk.viewRows')}</button>{/if}
        {#if failure.change}
          <button class="v-btn-secondary v-btn--sm" onclick={() => onretrywithout(failure!.change!)}>{t('alter.failed.retryWithout', { name: failure.change.name })}</button>
        {/if}
      </div>
    </section>
  {:else if error}
    <p class="v-banner v-banner--danger" role="alert">{error}</p>
  {/if}

  <ol class="list">
    {#each items as d}
      {@const ws = warningsFor(d)}
      <li class:risky={ws.length > 0} class:blocked={ws.some((w) => w.blocking)}>
        <p>{#each parts(describeText(d)) as p}{#if p.bold}<strong class="mono">{p.text}</strong>{:else}{p.text}{/if}{/each}</p>
        {#each ws as w}
          {#if w.code === 'fk_orphans'}
            {@const p = w.params ?? {}}
            <div class="warn fk" class:blocking={w.blocking}>
              <p><span aria-hidden="true">⚠</span> {orphanText(p)}</p>
              {#if w.fix === 'nullify'}<p class="decided">✓ {t('fk.nullifyNote', { count: count(w) })}</p>
              {:else if w.fix === 'nocheck'}<p class="decided danger">{t('fk.noCheckWarn')}</p>
              {:else}<p class="need">{t('fk.decide')}</p>{/if}
              <div class="acts">
                <button class="v-btn-ghost v-btn--sm" onclick={() => onviewrows(p)}>{t('fk.viewRows')}</button>
                <button class="v-btn-ghost v-btn--sm" aria-pressed={w.fix === 'nullify'} disabled={!p.nullable} title={!p.nullable ? t('fk.nullifyBlocked') : ''} onclick={() => onfix(String(p.fk), w.fix === 'nullify' ? null : 'nullify')}>{t('fk.nullify')}</button>
                <button class="v-btn-ghost v-btn--sm" onclick={() => onremove({ kind: 'fk', name: String(p.fk) })}>{t('fk.removeFromChanges')}</button>
              </div>
            </div>
          {:else if w.code === 'fk_issue'}
            <div class="warn fk blocking">
              <p><span aria-hidden="true">⛔</span> {t(`fk.issue.${w.issue}`, str(w.params))}</p>
              <div class="acts"><button class="v-btn-ghost v-btn--sm" onclick={() => onremove({ kind: 'fk', name: String(w.params?.fk ?? w.column) })}>{t('fk.removeFromChanges')}</button></div>
            </div>
          {:else}
            <p class="warn"><span aria-hidden="true">⚠</span> {t(`editor.warn.${w.code}`, { count: count(w), ...(w.params as Record<string, string> | undefined) })}</p>
          {/if}
        {/each}
      </li>
    {/each}
  </ol>
  {#if loading}<p class="dim">{t('editor.review.checking')}</p>{/if}
  {#if blocking && !loading}<p class="v-banner v-banner--warning" id="review-blocking">{t('editor.review.blocking', { count: n(blocking) })}</p>{/if}

  {#if managed}
    <label class="typed">
      <span>{t('managed.typeToConfirm', { table })}</span>
      <input class="v-input mono" bind:value={typed} autocomplete="off" spellcheck="false" aria-invalid={typed !== '' && !confirmOk} placeholder={table} />
    </label>
  {/if}

  <label class="toggle"><input type="checkbox" bind:checked={showSql} /> {t('editor.review.showSql')}</label>
  {#if showSql}<pre class="mono">{sql || '…'}</pre>{/if}
  {#snippet footer()}
    <button class="v-btn-secondary" onclick={onclose}>{t('common.cancel')}</button>
    <button class="v-btn-primary" onclick={onapply} disabled={!canApply} aria-describedby={blocking ? 'review-blocking' : undefined}>
      {applying ? t('editor.review.applying') : t('editor.review.apply', { count: n(items.length) })}
    </button>
  {/snippet}
</Drawer>

<style>
  .list {
    margin: 0 0 12px;
    padding-left: 20px;
    display: grid;
    gap: 10px;
    font-size: 13.5px;
  }
  .list p {
    margin: 0;
  }
  .list li.risky::marker {
    color: var(--sp-warning);
  }
  .list li.blocked::marker {
    color: var(--sp-danger);
  }
  .warn {
    margin-top: 3px !important;
    padding: 6px 8px;
    border-radius: var(--sp-radius);
    background: var(--sp-warning-light);
    color: var(--sp-warning);
    font-size: 12.5px;
  }
  .warn.fk {
    display: grid;
    gap: 4px;
    color: var(--sp-text-primary);
    border: 1px solid var(--sp-warning);
  }
  .warn.fk.blocking {
    border-color: var(--sp-danger);
    background: var(--sp-danger-light, var(--sp-warning-light));
  }
  .need {
    color: var(--sp-danger-text);
    font-weight: 500;
  }
  .decided {
    color: var(--sp-success);
  }
  .decided.danger {
    color: var(--sp-danger-text);
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .failure {
    display: grid;
    gap: 6px;
    margin-bottom: 14px;
    padding: 10px 12px;
    border: 1px solid var(--sp-danger);
    border-radius: var(--sp-radius-lg);
    background: var(--sp-danger-light, var(--sp-bg-subtle));
    font-size: 13px;
  }
  .failure h3 {
    margin: 0;
    font-size: 14px;
    color: var(--sp-danger-text);
  }
  .failure p {
    margin: 0;
  }
  .partial {
    color: var(--sp-warning);
  }
  .failure details {
    font-size: 12px;
    color: var(--sp-text-secondary);
  }
  .typed {
    display: grid;
    gap: 4px;
    margin: 8px 0 12px;
    font-size: 12.5px;
  }
  .toggle {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    font-size: 12.5px;
  }
  pre {
    margin: 8px 0 0;
    padding: 10px 12px;
    border-radius: var(--sp-radius);
    background: var(--sp-bg-subtle);
    border: 1px solid var(--sp-border);
    font-size: 12px;
    white-space: pre-wrap;
  }
  .dim {
    color: var(--sp-text-tertiary);
    font-size: 12.5px;
  }
</style>
