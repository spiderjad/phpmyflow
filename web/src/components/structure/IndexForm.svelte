<script lang="ts">
  // New / edit index. Type as a segmented radiogroup (disabled options say
  // why), columns filtered by what that type accepts, the selection ordered
  // (drag or Alt+↑/↓) with ASC/DESC and prefix length, live warnings
  // (duplicate, redundant, key too long) and, for UNIQUE, duplicate rows.
  import { tick, untrack } from 'svelte';
  import { editorApi } from '../../lib/api';
  import { n, t } from '../../lib/i18n.svelte';
  import {
    autoIndexName,
    columnIssue,
    duplicateOf,
    formatIdxCol,

    kindAvailable,
    parseIdxCol,
    suggestPrefix,
    type IdxCol,
    type IdxKind,
  } from '../../lib/indexes';
  import { app } from '../../lib/state.svelte';
  import { tabs } from '../../lib/tabs.svelte';
  import type { ColModel, IndexModel, TableInfo } from '../../lib/tableDraft';
  import { toast } from '../../lib/ui.svelte';
  import Segmented from '../ui/Segmented.svelte';

  let {
    db,
    table,
    columns,
    indexes,
    support,
    collation,
    initial = null,
    preselect = null,
    onsave,
    oncancel,
  }: {
    db: string;
    table: string;
    columns: ColModel[];
    indexes: IndexModel[];
    support: NonNullable<TableInfo['indexSupport']>;
    collation: string;
    initial?: IndexModel | null;
    preselect?: string | null;
    onsave: (idx: { name: string; kind: IdxKind; columns: string[]; invisible: boolean }) => void;
    oncancel: () => void;
  } = $props();

  const start = untrack(() => initial);
  let kind = $state<IdxKind>(start?.kind ?? 'INDEX');
  let selected = $state<IdxCol[]>(start ? start.columns.map(parseIdxCol) : untrack(() => (preselect ? [{ name: preselect, len: null, desc: false }] : [])));
  let name = $state(start?.name ?? '');
  // An existing name that is the automatic one keeps following the columns.
  let nameTouched = $state(!!start && start.name !== autoIndexName(start.kind, start.columns.map((c) => parseIdxCol(c).name)));
  let invisible = $state(!!start?.invisible);
  let removed = $state<string[]>([]);
  const uid = `ixf-${Math.random().toString(36).slice(2, 8)}`;

  const byName = $derived(Object.fromEntries(columns.map((c) => [c.name, c])));
  const charBytes = $derived(/^utf8mb4/i.test(collation) ? 4 : /^utf8/i.test(collation) ? 3 : /^(ucs2|utf16)/i.test(collation) ? 2 : /^utf32/i.test(collation) ? 4 : 1);
  const otherPrimary = $derived(indexes.some((i) => i.kind === 'PRIMARY' && i.id !== start?.id));
  const colLikes = $derived(columns.map((c) => ({ type: c.type, length: c.length, nullable: c.nullable })));

  const kinds = $derived([
    { value: 'INDEX' as IdxKind, label: 'INDEX', hint: t('idx.hint.INDEX') },
    { value: 'UNIQUE' as IdxKind, label: 'UNIQUE', hint: t('idx.hint.UNIQUE') },
    { value: 'FULLTEXT' as IdxKind, label: 'FULLTEXT', hint: t('idx.hint.FULLTEXT'), disabled: !support.fulltext ? t('idx.why.ftEngine') : !kindAvailable('FULLTEXT', colLikes) ? t('idx.why.ftNoText') : null },
    { value: 'SPATIAL' as IdxKind, label: 'SPATIAL', hint: t('idx.hint.SPATIAL'), disabled: !support.spatial ? t('idx.why.spEngine') : !kindAvailable('SPATIAL', colLikes) ? t('idx.why.spNoGeo') : null },
    { value: 'PRIMARY' as IdxKind, label: 'PRIMARY', hint: t('idx.hint.PRIMARY'), disabled: otherPrimary ? t('idx.why.hasPrimary') : null },
  ]);

  /** Hard incompatibility (can't be fixed with a prefix): the chip is disabled. */
  function hardIssue(c: ColModel, k: IdxKind): string | null {
    const why = columnIssue(k, c, 1);
    return why;
  }

  function setKind(k: IdxKind) {
    kind = k;
    const drop = selected.filter((s) => byName[s.name] && hardIssue(byName[s.name], k));
    removed = drop.map((s) => s.name);
    selected = selected
      .filter((s) => !removed.includes(s.name))
      .map((s) => (k === 'FULLTEXT' || k === 'SPATIAL' ? { ...s, len: null, desc: false } : s));
    if (k === 'SPATIAL') selected = selected.slice(0, 1);
  }

  function toggle(c: ColModel) {
    removed = [];
    if (selected.some((s) => s.name === c.name)) selected = selected.filter((s) => s.name !== c.name);
    else selected = kind === 'SPATIAL' ? [{ name: c.name, len: null, desc: false }] : [...selected, { name: c.name, len: null, desc: false }];
  }
  async function moveSel(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= selected.length) return;
    const next = [...selected];
    [next[i], next[j]] = [next[j], next[i]];
    selected = next;
    await tick();
    document.querySelector<HTMLElement>(`#${uid}-sel-${j}`)?.focus();
  }
  let dragFrom = -1;

  const colNames = $derived(selected.map((s) => s.name));
  const finalName = $derived(kind === 'PRIMARY' ? 'PRIMARY' : (nameTouched ? name : autoIndexName(kind, colNames)).slice(0, 64));
  const isLob = (c: ColModel | undefined) => !!c && /(text|blob)$/i.test(c.type);
  const prefixIssues = $derived(selected.filter((s) => kind !== 'FULLTEXT' && kind !== 'SPATIAL' && isLob(byName[s.name]) && !s.len).map((s) => s.name));
  const dup = $derived(duplicateOf(colNames, kind, indexes, start?.id));
  const defs = $derived(Object.fromEntries(columns.map((c) => [c.name, { type: c.type, length: c.length, nullable: c.nullable }])));
  const tooLong = $derived(kind === 'FULLTEXT' || kind === 'SPATIAL' ? null : suggestPrefix(colNames, defs, charBytes, Object.fromEntries(selected.map((s) => [s.name, s.len]))));
  const nullablePk = $derived(kind === 'PRIMARY' ? selected.filter((s) => byName[s.name]?.nullable).map((s) => s.name) : []);
  const nameBad = $derived(kind !== 'PRIMARY' && (!finalName.trim() || indexes.some((i) => i.id !== start?.id && i.name.toLowerCase() === finalName.toLowerCase())));
  const blocker = $derived(
    !selected.length ? t('idx.need.columns') : prefixIssues.length ? t('idx.need.prefix', { columns: prefixIssues.join(', ') }) : kind === 'SPATIAL' && selected.length > 1 ? t('idx.need.oneSpatial') : nameBad ? t('idx.need.name') : '',
  );

  // UNIQUE / PRIMARY: how many rows share a value (existing columns only).
  let dupRows = $state<{ groups?: number; rows?: number; more?: boolean; error?: string } | null>(null);
  let timer: ReturnType<typeof setTimeout>;
  let seq = 0;
  $effect(() => {
    const k = kind;
    const cols = selected.map((s) => formatIdxCol({ ...s, desc: false }));
    clearTimeout(timer);
    dupRows = null;
    if ((k !== 'UNIQUE' && k !== 'PRIMARY') || !cols.length || cols.some((c) => !byName[parseIdxCol(c).name]?.orig)) return;
    const mine = ++seq;
    timer = setTimeout(async () => {
      try {
        const r = await editorApi.fkChecks(db, table, [], {}, [], [{ id: 'u', columns: cols.map((c) => { const p = parseIdxCol(c); return formatIdxCol({ ...p, name: byName[p.name]?.orig ?? p.name }); }) }]);
        if (mine === seq) dupRows = r.uniques.u ?? { groups: 0, rows: 0 };
      } catch {
        if (mine === seq) dupRows = null;
      }
    }, 350);
  });

  function viewDuplicates() {
    const q = (s: string) => '`' + s.replace(/`/g, '``') + '`';
    const cols = selected.map((s) => (s.len ? `LEFT(${q(byName[s.name]?.orig ?? s.name)}, ${s.len})` : q(byName[s.name]?.orig ?? s.name)));
    const list = cols.join(', ');
    const sql = `SELECT ${list}, COUNT(*) AS n\nFROM ${q(table)}\nWHERE ${cols.map((c) => `${c} IS NOT NULL`).join(' AND ')}\nGROUP BY ${list}\nHAVING COUNT(*) > 1\nORDER BY n DESC\nLIMIT 100`;
    if (!tabs.create({ sql, db, autorun: true })) {
      toast(t('tabs.limit', { max: 30 }), 'error');
      return;
    }
    app.view = 'sql';
  }

  function save() {
    if (blocker) return;
    onsave({ name: finalName, kind, columns: selected.map(formatIdxCol), invisible: kind === 'PRIMARY' ? false : invisible });
  }
  const typeLabel = (c: ColModel) => c.type + (c.length ? `(${c.length})` : '');
</script>

<div class="adder" role="group" aria-label={start ? t('idx.editTitle', { name: start.name }) : t('idx.newTitle')}>
  <div class="field">
    <span class="lbl" id="{uid}-type">{t('idx.type')}</span>
    <Segmented options={kinds} value={kind} label={t('idx.type')} onchange={setKind} />
  </div>

  <div class="field">
    <span class="lbl">{t('editor.idx.columns')}</span>
    <div class="cols" role="group" aria-label={t('idx.pickColumns')}>
      {#each columns as c (c.id)}
        {@const why = hardIssue(c, kind)}
        {@const on = selected.some((s) => s.name === c.name)}
        <button type="button" class="pick mono" data-col={c.name} aria-pressed={on} disabled={!!why && !on} title={why ? t(why) : typeLabel(c)} onclick={() => toggle(c)}>
          {#if on}<span class="ord">{selected.findIndex((s) => s.name === c.name) + 1}</span>{/if}{c.name}
        </button>
      {/each}
    </div>
    {#if removed.length}<p class="warn" role="status">{t('idx.removed', { columns: removed.join(', ') })}</p>{/if}
  </div>

  {#if selected.length}
    <div class="field">
      <span class="lbl" id="{uid}-sel-label">{t('idx.selected')}</span>
      <ol class="selected" aria-labelledby="{uid}-sel-label">
        {#each selected as s, i (s.name)}
          {@const c = byName[s.name]}
          <!-- Reorderable list item: focusable, Alt+↑/↓ moves it, Delete removes it. -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
          <li
            id="{uid}-sel-{i}"
            tabindex="0"
            draggable="true"
            aria-label={t('idx.selItem', { n: i + 1, of: selected.length, name: s.name })}
            ondragstart={() => (dragFrom = i)}
            ondragover={(e) => e.preventDefault()}
            ondrop={() => {
              if (dragFrom < 0 || dragFrom === i) return;
              const next = [...selected];
              const [m] = next.splice(dragFrom, 1);
              next.splice(i, 0, m);
              selected = next;
              dragFrom = -1;
            }}
            onkeydown={(e) => {
              if (e.altKey && e.key === 'ArrowUp') (e.preventDefault(), moveSel(i, -1));
              else if (e.altKey && e.key === 'ArrowDown') (e.preventDefault(), moveSel(i, 1));
              else if (e.key === 'Delete') (e.preventDefault(), (selected = selected.filter((_, j) => j !== i)));
            }}
          >
            <span class="grip" aria-hidden="true">⋮⋮</span>
            <span class="ord">{i + 1}</span>
            <span class="mono nm">{s.name}</span>
            <span class="dim mono">{c ? typeLabel(c) : ''}</span>
            {#if support.desc && kind !== 'FULLTEXT' && kind !== 'SPATIAL'}
              <button type="button" class="v-btn-ghost v-btn--sm dir" aria-pressed={s.desc} aria-label={t('idx.order', { name: s.name, dir: s.desc ? 'DESC' : 'ASC' })} onclick={() => (selected[i] = { ...s, desc: !s.desc })}>{s.desc ? 'DESC' : 'ASC'}</button>
            {/if}
            {#if kind !== 'FULLTEXT' && kind !== 'SPATIAL' && c && /(char|text|blob|binary)$/i.test(c.type)}
              <label class="prefix">
                <span class="sr-only">{t('idx.prefixFor', { name: s.name })}</span>
                <input class="v-input" type="number" min="1" max="3072" placeholder={isLob(c) ? t('idx.prefixReq') : t('idx.prefixOpt')} value={s.len ?? ''} aria-invalid={isLob(c) && !s.len} oninput={(e) => (selected[i] = { ...s, len: Number((e.currentTarget as HTMLInputElement).value) || null })} />
              </label>
            {/if}
            <span class="moves">
              <button type="button" class="v-btn-icon v-btn--sm" aria-label={t('idx.up', { name: s.name })} disabled={i === 0} onclick={() => moveSel(i, -1)}>↑</button>
              <button type="button" class="v-btn-icon v-btn--sm" aria-label={t('idx.down', { name: s.name })} disabled={i === selected.length - 1} onclick={() => moveSel(i, 1)}>↓</button>
              <button type="button" class="v-btn-icon v-btn--sm" aria-label={t('idx.unselect', { name: s.name })} onclick={() => (selected = selected.filter((_, j) => j !== i))}>×</button>
            </span>
          </li>
        {/each}
      </ol>
      <p class="hint">{t('idx.reorderHelp')}</p>
    </div>
  {/if}

  {#if kind !== 'PRIMARY'}
    <label class="field">
      <span class="lbl">{t('idx.nameLabel')}</span>
      <input class="v-input mono name" value={finalName} maxlength="64" aria-invalid={nameBad} oninput={(e) => ((name = (e.currentTarget as HTMLInputElement).value), (nameTouched = true))} />
    </label>
  {:else}
    <p class="hint">{t('idx.pkName')}</p>
  {/if}

  {#if support.invisible && kind !== 'PRIMARY'}
    <label class="inline"><input type="checkbox" bind:checked={invisible} /> {t('idx.invisibleLabel')}</label>
  {/if}

  <div class="notes" aria-live="polite">
    {#if prefixIssues.length}<p class="err">⛔ {t('idx.needsPrefix', { columns: prefixIssues.join(', ') })}</p>{/if}
    {#if dup}<p class="warn">⚠ {t(dup.how === 'same' ? 'idx.dupSame' : 'idx.dupPrefix', { name: dup.index.name })}</p>{/if}
    {#if tooLong}
      <p class="warn">⚠ {t('idx.tooLong', { column: tooLong.column, len: tooLong.len })}
        <button type="button" class="v-btn-ghost v-btn--sm" onclick={() => (selected = selected.map((s) => (s.name === tooLong!.column ? { ...s, len: tooLong!.len } : s)))}>{t('idx.usePrefix', { len: tooLong.len })}</button>
      </p>
    {/if}
    {#if nullablePk.length}<p class="warn">⚠ {t('idx.pkNotNull', { columns: nullablePk.join(', ') })}</p>{/if}
    {#if dupRows?.rows}
      <p class="err">⛔ {t('idx.duplicates', { count: n(dupRows.rows) + (dupRows.more ? '+' : ''), groups: n(dupRows.groups ?? 0) })}
        <button type="button" class="v-btn-ghost v-btn--sm" onclick={viewDuplicates}>{t('fk.viewRows')}</button>
      </p>
    {/if}
  </div>

  <div class="row end">
    {#if blocker}<span class="why" id="{uid}-why">{blocker}</span>{/if}
    <button type="button" class="v-btn-secondary v-btn--sm" onclick={oncancel}>{t('common.cancel')}</button>
    <button type="button" class="v-btn-primary v-btn--sm" onclick={save} disabled={!!blocker} aria-describedby={blocker ? `${uid}-why` : undefined}>{start ? t('idx.save') : t('editor.idx.addConfirm')}</button>
  </div>
</div>

<style>
  .adder {
    display: grid;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
    background: var(--sp-bg-subtle);
  }
  .field {
    display: grid;
    gap: 6px;
  }
  .lbl {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--sp-text-secondary);
  }
  .cols {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pick {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border: 1px solid var(--sp-border);
    border-radius: 999px;
    background: var(--sp-bg);
    color: var(--sp-text-primary);
    font-size: 12.5px;
    cursor: pointer;
  }
  .pick[aria-pressed='true'] {
    border-color: var(--sp-text-primary);
    box-shadow: inset 0 0 0 1px var(--sp-text-primary);
  }
  .pick:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .ord {
    display: inline-grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--sp-inverse);
    color: var(--sp-on-inverse);
    font-size: 11px;
    font-family: var(--sp-font-sans, inherit);
  }
  .selected {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 4px;
  }
  .selected li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
    background: var(--sp-bg);
    font-size: 12.5px;
  }
  .selected li:focus-visible {
    outline: 2px solid var(--sp-focus);
    outline-offset: 1px;
  }
  .grip {
    color: var(--sp-text-tertiary);
    cursor: grab;
    letter-spacing: -2px;
  }
  .nm {
    font-weight: 500;
  }
  .dim {
    color: var(--sp-text-tertiary);
  }
  .prefix input {
    width: 110px;
    height: 26px;
    padding: 0 6px;
    font-size: 12px;
  }
  .moves {
    margin-left: auto;
    display: flex;
    gap: 2px;
  }
  .name {
    max-width: 420px;
  }
  .inline {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 13px;
  }
  .notes {
    display: grid;
    gap: 4px;
  }
  .notes p {
    margin: 0;
    font-size: 12.5px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .warn {
    margin: 0;
    font-size: 12.5px;
    color: var(--sp-warning);
  }
  .err {
    color: var(--sp-danger-text);
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--sp-text-tertiary);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .row.end {
    justify-content: flex-end;
  }
  .why {
    margin-right: auto;
    font-size: 12px;
    color: var(--sp-text-secondary);
  }
  @media (max-width: 520px) {
    .moves {
      margin-left: 0;
    }
  }
</style>
