<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { api, ApiError, editorApi } from '../lib/api';
  import { formatBytes } from '../lib/bytes';
  import { copyText } from '../lib/clipboard';
  import { guessTarget, parseQuickLine, suggestColumn } from '../lib/columnDefaults';
  import { familyOf, isBool, realType, typeLabelKey, type ColumnDef } from '../lib/columnTypes';
  import { friendlyError } from '../lib/errors';
  import { i18n, n, t } from '../lib/i18n.svelte';
  import { clearServerLintCache } from '../lib/sqlLint';
  import { app, refreshSchema } from '../lib/state.svelte';
  import {
    changeCount,
    clone,
    columnMarks,
    describe,
    diff,
    DraftHistory,
    fromInfo,
    payload,
    revertChange,
    uid,
    type FailedChange,
    type ColModel,
    type IndexModel,
    type ServerWarning,
    type TableInfo,
    type TableModel,
  } from '../lib/tableDraft';
  import { toast } from '../lib/ui.svelte';
  import AdvancedDrawer from './structure/AdvancedDrawer.svelte';
  import DefaultChip from './structure/DefaultChip.svelte';
  import ForeignKeys from './structure/ForeignKeys.svelte';
  import Checks from './structure/Checks.svelte';
  import TableTriggers from './structure/TableTriggers.svelte';
  import { describeText } from '../lib/describeText';
  import { fkName, orphanQuery, polymorphicIds } from '../lib/foreignKeys';
  import { tabs } from '../lib/tabs.svelte';
  import type { Failure } from './structure/ReviewDrawer.svelte';
  import { commonPrefix } from '../lib/fuzzy';
  import { parseColumnType } from '../lib/columnTypes';
  import IndexForm from './structure/IndexForm.svelte';
  import Select from './ui/Select.svelte';
  import { formatIdxCol, idxColName, keyBadges, parseIdxCol, redundantIndexes, type KeyBadge } from '../lib/indexes';
  import KeyIcon from './KeyIcon.svelte';
  import type { KeyKind } from '../lib/keyIcons';
  import Popover from './structure/Popover.svelte';
  import ReviewDrawer from './structure/ReviewDrawer.svelte';
  import Switch from './structure/Switch.svelte';
  import TypePopover from './structure/TypePopover.svelte';

  let { db, table }: { db: string; table: string } = $props();

  // Sticky header: compact once the page scrolls; the column header sticks right below it.
  let scrolled = $state(false);
  let headH = $state(0);
  let showList = $state(false);

  let info = $state<TableInfo | null>(null);
  let original = $state<TableModel | null>(null);
  let draft = $state<TableModel | null>(null);
  let loadError = $state('');
  const history = new DraftHistory();
  let historyTick = $state(0);

  function autofocus(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  async function load() {
    loadError = '';
    try {
      const res = await editorApi.info(db, table);
      if (res.table.name !== table) return;
      info = res;
      original = fromInfo(res);
      draft = clone(original);
      history.clear();
      historyTick++;
      void applyFocus();
    } catch (err) {
      loadError = err instanceof ApiError ? friendlyError(err, app.schema).title : String(err);
    }
  }
  /** Opened from a key icon in the grid header: show that index, FK or column. */
  async function applyFocus() {
    const f = app.structureFocus;
    if (!f || !draft) return;
    app.structureFocus = null;
    await tick();
    if (f.type === 'index') {
      const i = draft.indexes.find((x) => x.orig === f.name || x.name === f.name);
      if (i) void showIndex(i.id);
      return;
    }
    const el = document.querySelector<HTMLElement>(f.type === 'fk' ? `[data-fk="${CSS.escape(f.name)}"]` : `[data-col="${CSS.escape(f.name)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('focus-flash');
    setTimeout(() => el.classList.remove('focus-flash'), 1600);
    (el.querySelector<HTMLElement>(f.type === 'fk' ? 'input, button, [tabindex]' : '.c-ref button, .c-name input, [tabindex]') ?? el).focus();
  }
  $effect(() => {
    void db;
    void table;
    untrack(() => {
      info = null;
      draft = null;
      load();
    });
  });

  const editable = $derived(!!info?.canAlter);
  const changes = $derived(original && draft ? diff(original, draft) : null);
  const count = $derived(changes ? changeCount(changes) : 0);
  // Logout warns about changes not applied (they would be lost).
  $effect(() => {
    app.pendingStructure = count ? { table, count } : null;
  });
  $effect(() => () => (app.pendingStructure = null));
  const marks = $derived(changes ? columnMarks(changes) : new Map<string, 'new' | 'modified' | 'dropped'>());

  /** Record an undo step, then mutate the draft. */
  function edit(fn: (d: TableModel) => void) {
    if (!draft || !editable) return;
    history.record($state.snapshot(draft) as TableModel);
    fn(draft);
    historyTick++;
  }
  function undo() {
    if (!draft) return;
    const prev = history.undo($state.snapshot(draft) as TableModel);
    if (prev) draft = prev;
    historyTick++;
  }
  function redo() {
    if (!draft) return;
    const next = history.redo($state.snapshot(draft) as TableModel);
    if (next) draft = next;
    historyTick++;
  }
  const canUndo = $derived((void historyTick, history.canUndo));
  const canRedo = $derived((void historyTick, history.canRedo));

  function globalKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, .cm-editor')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }
  }

  // --- rows to show: the draft plus dropped columns struck through in place ---
  const rows = $derived.by(() => {
    if (!draft || !original) return [] as { col: ColModel; dropped: boolean }[];
    const out = draft.columns.map((c) => ({ col: c, dropped: false }));
    original.columns.forEach((o, i) => {
      if (!draft!.columns.some((c) => c.orig === o.orig)) out.splice(Math.min(i, out.length), 0, { col: o, dropped: true });
    });
    return out;
  });

  // --- name editing with live validation ---
  let editingName = $state<string | null>(null);
  let nameValue = $state('');
  function nameProblem(id: string, v: string): string {
    if (!v.trim()) return t('editor.name.empty');
    if (v.length > 64) return t('editor.name.long');
    if (/[/\\.]|\s$/.test(v)) return t('editor.name.chars');
    if (draft?.columns.some((c) => c.id !== id && c.name.toLowerCase() === v.toLowerCase())) return t('editor.name.dup', { name: v });
    return '';
  }
  function startName(c: ColModel) {
    if (!editable) return;
    editingName = c.id;
    nameValue = c.name;
  }
  async function commitName(c: ColModel, move: 'none' | 'next' = 'none') {
    if (editingName !== c.id) return;
    const v = nameValue;
    if (nameProblem(c.id, v)) return;
    editingName = null;
    if (v !== c.name) {
      const old = c.name;
      edit((d) => {
        const col = d.columns.find((x) => x.id === c.id)!;
        col.name = v;
        // Indexes and foreign keys follow the rename.
        for (const i of d.indexes) i.columns = i.columns.map((x) => { const p = parseIdxCol(x); return p.name === old ? formatIdxCol({ ...p, name: v }) : x; });
        for (const f of d.fks) f.columns = f.columns.map((x) => (x === old ? v : x));
      });
    }
    if (move === 'next' && draft) {
      const i = draft.columns.findIndex((x) => x.id === c.id);
      const next = draft.columns[i + 1];
      await tick();
      if (next) startName(next);
      else ghost?.focus();
    }
  }

  // --- column field edits ---
  function setCol(id: string, patch: Partial<ColumnDef>) {
    edit((d) => {
      const col = d.columns.find((x) => x.id === id);
      if (!col) return;
      Object.assign(col, patch);
      if (patch.nullable === false && col.default.kind === 'null') col.default = { kind: 'none' };
      if (patch.autoIncrement) {
        col.nullable = false;
        col.default = { kind: 'none' };
      }
    });
  }

  let typeFor = $state<{ id: string; anchor: HTMLElement } | null>(null);
  let typeRecorded = false;
  function openType(id: string, anchor: HTMLElement) {
    if (!editable) return;
    typeFor = { id, anchor };
    typeRecorded = false;
  }
  function changeType(def: ColumnDef) {
    if (!draft || !typeFor) return;
    // One undo step per popover session, not per keystroke.
    if (!typeRecorded) {
      history.record($state.snapshot(draft) as TableModel);
      typeRecorded = true;
    }
    const col = draft.columns.find((x) => x.id === typeFor!.id);
    if (col) Object.assign(col, def);
    historyTick++;
  }

  let advancedFor = $state<string | null>(null);
  let advancedRecorded = false;
  function changeAdvanced(def: ColumnDef) {
    if (!draft || !advancedFor || !editable) return;
    if (!advancedRecorded) {
      history.record($state.snapshot(draft) as TableModel);
      advancedRecorded = true;
    }
    const col = draft.columns.find((x) => x.id === advancedFor);
    if (col) Object.assign(col, def);
    historyTick++;
  }

  function duplicate(c: ColModel) {
    edit((d) => {
      const i = d.columns.findIndex((x) => x.id === c.id);
      let name = c.name + '_copy';
      while (d.columns.some((x) => x.name === name)) name += '_';
      d.columns.splice(i + 1, 0, { ...clone(c), id: uid('c'), orig: null, name, autoIncrement: false });
    });
  }
  function remove(c: ColModel) {
    edit((d) => {
      d.columns = d.columns.filter((x) => x.id !== c.id);
      d.indexes = d.indexes.map((i) => ({ ...i, columns: i.columns.filter((x) => idxColName(x) !== c.name) })).filter((i) => i.columns.length);
      d.fks = d.fks.filter((f) => !f.columns.includes(c.name));
    });
  }
  function restore(o: ColModel) {
    edit((d) => {
      const at = original!.columns.findIndex((x) => x.orig === o.orig);
      d.columns.splice(Math.min(at, d.columns.length), 0, clone(o));
    });
  }

  // drag (or Alt+↑/↓) to reorder
  let dragId = $state<string | null>(null);
  function dropOn(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const from = dragId;
    edit((d) => {
      const i = d.columns.findIndex((x) => x.id === from);
      const [col] = d.columns.splice(i, 1);
      const j = d.columns.findIndex((x) => x.id === targetId);
      d.columns.splice(j, 0, col);
    });
    dragId = null;
  }
  function moveKey(e: KeyboardEvent, c: ColModel) {
    if (!(e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))) return;
    e.preventDefault();
    edit((d) => {
      const i = d.columns.findIndex((x) => x.id === c.id);
      const j = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (j < 0 || j >= d.columns.length) return;
      [d.columns[i], d.columns[j]] = [d.columns[j], d.columns[i]];
    });
  }

  // --- keys: every index of a column (PRI, UNI, INDEX, FULLTEXT, SPATIAL) ---
  const keysOf = (name: string) => (draft ? keyBadges(name, draft.indexes) : []);
  let flashIndex = $state<string | null>(null);
  async function showIndex(id: string) {
    flashIndex = id;
    await tick();
    const el = document.getElementById(`idx-${id}`);
    el?.scrollIntoView({ block: 'center' });
    el?.focus();
    setTimeout(() => (flashIndex = null), 1600);
  }
  // Index form: new (optionally with a column preselected) or editing one.
  let idxForm = $state<{ editing: string | null; preselect: string | null } | null>(null);
  async function addIndexFor(c: ColModel) {
    idxForm = { editing: null, preselect: c.name };
    await tick();
    document.getElementById('idx-form')?.scrollIntoView({ block: 'center' });
  }
  function saveIndex(idx: { name: string; kind: IndexModel['kind']; columns: string[]; invisible: boolean }) {
    const editing = idxForm?.editing ?? null;
    edit((d) => {
      if (editing) {
        const i = d.indexes.find((x) => x.id === editing);
        if (i) Object.assign(i, idx);
      } else d.indexes.push({ ...idx, id: uid('i'), orig: null });
    });
    queued(t(editing ? 'editor.queued.indexEdited' : 'editor.queued.index', { name: idx.kind === 'PRIMARY' ? t('idx.primaryKey') : idx.name, column: idx.columns.map(idxColName).join(', ') }));
    idxForm = null;
  }
  function toggleInvisible(i: IndexModel) {
    edit((d) => {
      const x = d.indexes.find((y) => y.id === i.id);
      if (x) x.invisible = !x.invisible;
    });
  }
  // Same icons as the grid header (KeyIcon): key + PK / U / I / FT / SP, and "2/3" in composite keys.
  const ICON: Record<KeyBadge['kind'], KeyKind> = { PRI: 'pk', UNI: 'uni', MUL: 'idx', FT: 'ft', SP: 'sp' };
  const LETTER: Record<KeyBadge['kind'], string> = { PRI: 'PK', UNI: 'U', MUL: 'I', FT: 'FT', SP: 'SP' };
  const badgeText = (k: KeyBadge) => LETTER[k.kind] + (k.of > 1 ? ` ${k.pos}/${k.of}` : '');
  const colsOf = (i: IndexModel) => i.columns.map(idxColName).join(', ');
  const idxName = (i: IndexModel) => (i.kind === 'PRIMARY' ? t('idx.primaryKey') : i.name);
  function ordinal(nr: number): string {
    const l = i18n.locale;
    if (l === 'es') return `${nr}.ª`;
    if (l === 'it') return `${nr}ª`;
    if (l === 'fr') return nr === 1 ? '1re' : `${nr}e`;
    const s10 = nr % 100;
    return `${nr}${s10 >= 11 && s10 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][nr % 10] ?? 'th'}`;
  }
  const badgeTip = (k: KeyBadge) => (k.of > 1 ? t('key.tipComposite', { ord: ordinal(k.pos), name: idxName(k.index), columns: colsOf(k.index) }) : t('key.tip', { name: idxName(k.index), columns: colsOf(k.index) }));
  const badgeAria = (k: KeyBadge) => t(k.of > 1 ? `key.aria.${k.kind}.of` : `key.aria.${k.kind}`, { name: idxName(k.index), pos: k.pos, of: k.of });
  const redundant = $derived(draft ? redundantIndexes(draft.indexes) : []);
  // The primary key first, then the rest in their order.
  const shownIndexes = $derived(draft ? [...draft.indexes].sort((a, b) => Number(b.kind === 'PRIMARY') - Number(a.kind === 'PRIMARY')) : []);

  // Row count: exact (deferred COUNT(*)) under 100,000 rows, else the estimate with "Count exactly".
  let exactRows = $state<number | null>(null);
  let counting = $state(false);
  $effect(() => {
    const [d, tb, approx] = [db, table, info?.table.approxRows];
    exactRows = null;
    if (approx === undefined || approx === null || approx >= 100000) return;
    api.count({ db: d, table: tb }).then((r) => {
      if (d === db && tb === table && !r.approx) exactRows = r.total;
    }).catch(() => {});
  });
  async function countExactly() {
    counting = true;
    try {
      const r = await api.count({ db, table, exact: '1' });
      exactRows = r.total;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      counting = false;
    }
  }
  /** Tell the user exactly what was added to the pending changes. */
  function queued(text: string) {
    toast(text + ' ' + t('editor.queued.suffix'), 'info', 4500);
  }
  function restoreIndex(o: IndexModel) {
    edit((d) => d.indexes.push(clone(o)));
  }

  // --- relations (declared from the draft, inferred from the schema) ---
  const inferredOut = $derived(app.relations.filter((r) => r.from === table && r.kind === 'inferred'));
  function refOf(name: string): { table: string; column: string; kind: 'declared' | 'inferred' } | null {
    const fk = draft?.fks.find((f) => f.columns.length === 1 && f.columns[0] === name);
    if (fk) return { table: fk.refTable, column: fk.refColumns[0], kind: 'declared' };
    const inf = inferredOut.find((r) => r.column === name);
    return inf ? { table: inf.to, column: inf.toColumn, kind: 'inferred' } : null;
  }
  const tablesPk = $derived(
    Object.entries(app.schema).map(([name, s]) => {
      const pks = s.columns.filter((c) => c.key === 'PRI');
      return { name, pk: pks.length === 1 ? pks[0].name : null };
    }),
  );
  const polyIds = $derived(polymorphicIds(app.polymorphic, table));
  const looksLikeFk = (name: string) => (/_id($|_)/i.test(name) || /^id_[a-z]/i.test(name)) && !polyIds.has(name);

  /** "Link to a table?" on a column: add a prefilled FK row to the Foreign keys section. */
  async function openFk(column: string) {
    const guess = guessTarget(column, tablesPk) ?? refOf(column);
    const prefix = commonPrefix(app.tables.map((x) => x.name));
    edit((d) =>
      d.fks.push({ id: uid('f'), orig: null, name: fkName(table, [column], prefix), autoName: true, columns: [column], refTable: guess?.table ?? '', refColumns: guess ? [guess.column] : [], onDelete: 'RESTRICT', onUpdate: 'CASCADE', fix: null }),
    );
    await tick();
    document.getElementById('fk-title')?.scrollIntoView({ block: 'start' });
  }
  /** "Adjust source column": the local column takes the referenced column's type. */
  function fixColumn(column: string, columnType: string, collation: string | null) {
    const id = draft?.columns.find((c) => c.name === column)?.id;
    if (!id) return;
    const t2 = parseColumnType(columnType);
    setCol(id, { ...t2, collation: collation ?? null, autoIncrement: false });
    toast(t('fk.columnAdjusted', { column, type: columnType }) + ' ' + t('editor.queued.suffix'), 'info', 4500);
  }

  // --- ghost row: add a column by typing its name or a quick line ---
  let ghost: HTMLInputElement | undefined = $state();
  let ghostValue = $state('');
  const ghostQuick = $derived(ghostValue.trim().includes(' ') ? parseQuickLine(ghostValue) : null);
  const ghostSuggestion = $derived(ghostValue.trim() && !ghostValue.trim().includes(' ') ? suggestColumn(ghostValue.trim(), tablesPk) : null);
  const ghostProblem = $derived(ghostValue.trim() ? nameProblem('', (ghostQuick?.def.name ?? ghostValue.trim().split(/\s+/)[0]).trim()) : '');

  function addFromGhost() {
    const raw = ghostValue.trim();
    if (!raw || !draft) return;
    const quick = raw.includes(' ') ? parseQuickLine(raw) : null;
    // Not a valid quick line: the text is just a name (first word).
    const sug = quick ? null : suggestColumn(raw.split(/\s+/)[0], tablesPk);
    const def: ColumnDef = quick ? quick.def : sug!.def;
    if (nameProblem('', def.name)) return;
    edit((d) => {
      const col: ColModel = { ...def, id: uid('c'), orig: null };
      d.columns.push(col);
      const hasPk = d.indexes.some((i) => i.kind === 'PRIMARY');
      if ((quick?.primary || sug?.primary) && !hasPk) d.indexes.push({ id: uid('i'), orig: null, name: 'PRIMARY', kind: 'PRIMARY', columns: [col.name] });
      if (quick?.unique) d.indexes.push({ id: uid('i'), orig: null, name: `uq_${col.name}`.slice(0, 64), kind: 'UNIQUE', columns: [col.name] });
    });
    queued(t('editor.queued.column', { name: def.name, type: typeText(def) }));
    ghostValue = '';
  }
  function ghostKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addFromGhost();
    } else if (e.key === 'Escape') ghostValue = '';
  }

  // --- table header ---
  let editingTitle = $state(false);
  let titleValue = $state('');
  let chipFor = $state<{ kind: 'engine' | 'collation' | 'ai'; anchor: HTMLElement } | null>(null);
  function setTable(patch: Partial<TableModel>) {
    edit((d) => Object.assign(d, patch));
  }

  // --- review & apply ---
  let review = $state(false);
  let preview = $state<{ sql: string; warnings: ServerWarning[] } | null>(null);
  let previewError = $state('');
  let previewLoading = $state(false);
  let applying = $state(false);
  let codeOpen = $state(false);

  let previewSeq = 0;
  async function loadPreview() {
    const mine = ++previewSeq;
    if (!changes || !count) {
      preview = null;
      previewLoading = false;
      return;
    }
    previewLoading = true;
    previewError = '';
    try {
      const r = await editorApi.preview(db, table, payload(changes));
      if (mine === previewSeq) preview = r;
    } catch (err) {
      if (mine !== previewSeq) return;
      preview = null;
      previewError = err instanceof ApiError ? friendlyError(err, app.schema).title : String(err);
    } finally {
      if (mine === previewSeq) previewLoading = false;
    }
  }
  // Keep the ALTER preview fresh while the review or code panel is open.
  let previewTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    void changes;
    if (!(review || codeOpen)) return;
    // Until the new preview arrives, the old one (and its checks) no longer counts.
    previewLoading = true;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(loadPreview, 300);
  });

  let failure = $state<Failure | null>(null);
  $effect(() => {
    if (!review) failure = null;
  });

  async function apply() {
    if (!changes) return;
    applying = true;
    failure = null;
    try {
      const renamedTo = changes.table.rename;
      await editorApi.apply(db, table, payload(changes));
      review = false;
      toast(t('editor.applied'), 'success');
      clearServerLintCache();
      await refreshSchema();
      if (renamedTo) app.table = renamedTo;
      else await load();
    } catch (err) {
      if (err instanceof ApiError) {
        const d = err.details as Record<string, any>;
        // The MySQL-specific wording ("mysql.<errno>") is the fallback cause.
        const f = friendlyError({ code: d.mysqlCode ? 'sql_error' : err.code, message: err.message, details: d }, app.schema);
        failure = {
          title: f.title + (f.hint ? ` ${f.hint}` : ''),
          server: String(d.serverMessage ?? err.message),
          change: (d.change as FailedChange | null) ?? null,
          cause: (d.cause as Failure['cause']) ?? null,
          params: (d.params as Record<string, unknown>) ?? {},
          nullified: Number(d.nullified ?? 0),
        };
      } else {
        previewError = String(err);
      }
    } finally {
      applying = false;
    }
  }

  // --- review actions ---
  function removeChange(change: FailedChange) {
    if (!draft || !original) return;
    const o = original;
    edit((d) => {
      revertChange(d, o, change);
    });
    toast(t('alter.removed', { name: change.name }), 'info', 3500);
  }
  async function retryWithout(change: FailedChange) {
    removeChange(change);
    failure = null;
    if (!changes || !count) {
      review = false;
      return;
    }
    await tick();
    await loadPreview();
    if (!preview?.warnings.some((w) => w.blocking)) await apply();
  }
  function setFix(fk: string, fix: 'nullify' | null) {
    edit((d) => {
      const f = d.fks.find((x) => x.name === fk);
      if (f) f.fix = fix;
    });
  }
  function viewRows(p: Record<string, unknown>) {
    const cols = String(p.column ?? '').split(', ').filter(Boolean);
    const refCols = String(p.refColumn ?? '').split(', ').filter(Boolean);
    if (!cols.length || !refCols.length) return;
    if (!tabs.create({ sql: orphanQuery(String(p.table ?? table), cols, String(p.refTable), refCols), db, autorun: true })) {
      toast(t('tabs.limit', { max: 30 }), 'error');
      return;
    }
    app.view = 'sql';
  }

  // --- assistant: describe columns -> pending rows (never applied on its own) ---
  let aiOpen = $state(false);
  let aiPrompt = $state('');
  let aiBusy = $state(false);
  let aiNote = $state('');
  async function describeColumns() {
    aiBusy = true;
    aiNote = '';
    try {
      const res = await api.ai({ db, mode: 'columns', lang: i18n.locale, prompt: aiPrompt, sql: table });
      const parts = [...(res.sql ?? '').matchAll(/ADD\s+(?:COLUMN\s+)?(.+?)(?=,\s*ADD\s|;?\s*$)/gis)].map((m) => m[1].trim());
      const defs = parts.map((p) => parseQuickLine(p.replace(/`/g, ''))).filter((x): x is NonNullable<typeof x> => !!x);
      if (!defs.length) {
        aiNote = t('editor.ai.nothing');
        return;
      }
      edit((d) => {
        for (const q of defs) {
          let name = q.def.name;
          while (d.columns.some((c) => c.name === name)) name += '_2';
          d.columns.push({ ...q.def, name, id: uid('c'), orig: null });
        }
      });
      aiOpen = false;
      aiPrompt = '';
      toast(t('editor.ai.added', { count: defs.length }), 'info', 4000);
    } catch (err) {
      aiNote = err instanceof ApiError ? friendlyError(err).title : String(err);
    } finally {
      aiBusy = false;
    }
  }

  const reasonText = $derived(info?.reason === 'view' ? t('editor.ro.view') : info?.reason === 'read_only' ? t('editor.ro.readOnly') : info?.reason === 'no_alter' ? t('editor.ro.noAlter') : '');
  const typeText = (c: ColumnDef) => `${t(typeLabelKey(c))} · ${realType(c)}`;
  function prevTitle(c: ColModel, field: 'type' | 'name' | 'default'): string | undefined {
    if (marks.get(c.id) !== 'modified') return undefined;
    const o = original?.columns.find((x) => x.orig === c.orig);
    if (!o) return undefined;
    const fmt = (x: ColModel) => (field === 'type' ? realType(x) : field === 'name' ? x.name : x.default.kind === 'value' ? `'${x.default.value}'` : x.default.kind);
    return fmt(o) !== fmt(c) ? t('editor.before', { value: fmt(o) }) : undefined;
  }
  const size = (b: number) => formatBytes(b, i18n.locale);
  const descriptions = $derived(changes && original ? describe(changes, original) : []);
  const droppedIndexes = $derived(original && draft ? original.indexes.filter((o) => !draft!.indexes.some((i) => i.orig === o.orig)) : []);
  /** "Add the column **x**" -> plain text for the compact list. */
  const plain = (s: string) => s.replace(/\*\*/g, '');
  async function copy(text: string) {
    toast((await copyText(text)) ? t('structure.copied') : t('copy.failed'), 'success', 1500);
  }
  function discard() {
    if (!original) return;
    history.record($state.snapshot(draft) as TableModel);
    draft = clone(original);
    historyTick++;
  }
</script>

<svelte:window onkeydown={globalKey} />

<section class="editor-view" aria-busy={!draft} onscroll={(e) => (scrolled = (e.currentTarget as HTMLElement).scrollTop > 60)} style:--head-h="{headH}px">
  {#if loadError}<p class="v-banner v-banner--danger" role="alert">{loadError}</p>{/if}

  {#if info && draft && original}
    {#if !editable}
      <p class="v-banner v-banner--info ro" role="note">{reasonText}</p>
    {/if}
    {#if info.managedBy}
      <p class="v-banner v-banner--warning ro managed" role="note"><strong>⚠ {t('managed.title', { app: info.managedBy === 'glpi' ? 'GLPI' : 'WordPress' })}</strong> {t(`managed.${info.managedBy}`)}</p>
    {/if}

    <!-- 1. header (sticky; compact when scrolled) -->
    <header class="head" class:scrolled bind:offsetHeight={headH}>
      {#if editingTitle}
        <input
          class="title-input mono"
          bind:value={titleValue}
          aria-label={t('editor.table.rename')}
          aria-invalid={!titleValue.trim() || titleValue.length > 64}
          onkeydown={(e) => {
            if (e.key === 'Enter' && titleValue.trim() && titleValue.length <= 64) {
              setTable({ name: titleValue.trim() });
              editingTitle = false;
            } else if (e.key === 'Escape') editingTitle = false;
          }}
          onblur={() => (editingTitle = false)}
          use:autofocus
        />
      {:else if editable}
        <button class="title mono" onclick={() => ((titleValue = draft!.name), (editingTitle = true))} title={t('editor.table.rename')}>{draft.name}</button>
      {:else}
        <h1 class="title mono">{draft.name}</h1>
      {/if}
      {#if scrolled}
        <!-- compact: name only -->
      {:else if editable}
        <input
          class="comment"
          placeholder={t('editor.table.addComment')}
          value={draft.comment}
          aria-label={t('editor.table.comment')}
          onchange={(e) => setTable({ comment: (e.currentTarget as HTMLInputElement).value })}
        />
      {:else if draft.comment}
        <p class="comment ro-text">{draft.comment}</p>
      {/if}
      <div class="chips" hidden={scrolled}>
        {#if editable}
          <button class="chip" onclick={(e) => (chipFor = { kind: 'engine', anchor: e.currentTarget as HTMLElement })} title={t('structure.engine')}>{draft.engine}</button>
          <button class="chip mono" onclick={(e) => (chipFor = { kind: 'collation', anchor: e.currentTarget as HTMLElement })} title={t('editor.advanced.collation')}>{draft.collation}</button>
        {:else}
          <span class="chip static">{draft.engine}</span><span class="chip static mono">{draft.collation}</span>
        {/if}
        {#if exactRows !== null}
          <span class="chip static rows">{t('editor.table.rowsExact', { count: n(exactRows) })}</span>
        {:else}
          <span class="chip static rows" title={t('editor.table.rowsApprox')}>{t('editor.table.rows', { count: n(info.table.approxRows ?? 0) })}</span>
          {#if (info.table.approxRows ?? 0) >= 100000}<button class="chip" onclick={countExactly} disabled={counting}>{counting ? t('common.loading') : t('editor.table.countExact')}</button>{/if}
        {/if}
        <span class="chip static">{size(info.table.bytes)}</span>
        {#if draft.autoIncrement !== null}
          {#if editable}
            <button class="chip" onclick={(e) => (chipFor = { kind: 'ai', anchor: e.currentTarget as HTMLElement })}>AUTO_INCREMENT {n(draft.autoIncrement)}</button>
          {:else}<span class="chip static">AUTO_INCREMENT {n(draft.autoIncrement)}</span>{/if}
        {/if}
      </div>
    </header>

    <!-- 2. columns -->
    <section class="block" aria-labelledby="cols-title">
      <div class="block-head">
        <div>
          <h2 id="cols-title">{t('editor.columns')} <span class="dim">{n(draft.columns.length)}</span></h2>
          <p class="section-help">{editable ? t('editor.help.columns') : t('editor.help.columnsRo')}</p>
        </div>
        {#if editable && app.session?.ai}
          <button class="v-btn-ai v-btn--sm" onclick={() => (aiOpen = !aiOpen)} aria-expanded={aiOpen}>✦ {t('editor.ai.describe')}</button>
        {/if}
      </div>
      {#if aiOpen}
        <div class="ai-box">
          <label for="ai-cols">{t('editor.ai.prompt')}</label>
          <textarea id="ai-cols" class="v-input" rows="2" bind:value={aiPrompt} placeholder={t('editor.ai.placeholder')}></textarea>
          <div class="ai-actions">
            <button class="v-btn-ai v-btn--sm" onclick={describeColumns} disabled={aiBusy || !aiPrompt.trim()}>{aiBusy ? t('ai.thinking') : t('editor.ai.propose')}</button>
            <span class="dim">{aiNote || t('editor.ai.note')}</span>
          </div>
        </div>
      {/if}

      <div class="cols" role="table" aria-label={t('editor.columns')}>
        <div class="cols-head" role="row">
          <span role="columnheader" class="c-handle"><span class="sr-only">{t('editor.col.order')}</span></span>
          <span role="columnheader">{t('editor.col.name')}</span>
          <span role="columnheader">{t('editor.col.type')}</span>
          <span role="columnheader" class="c-sw">{t('editor.col.null')}</span>
          <span role="columnheader" class="c-sw">{t('editor.col.unsignedShort')}</span>
          <span role="columnheader" class="c-sw">AI</span>
          <span role="columnheader">{t('editor.col.default')}</span>
          <span role="columnheader">{t('editor.col.key')}</span>
          <span role="columnheader">{t('editor.col.references')}</span>
          <span role="columnheader" class="c-act"><span class="sr-only">{t('monitor.proc.actions')}</span></span>
        </div>

        {#each rows as { col: c, dropped } (c.id + (dropped ? ':d' : ''))}
          {@const mark = dropped ? 'dropped' : marks.get(c.id)}
          {@const numeric = ['int', 'decimal', 'float'].includes(familyOf(c.type)) && !isBool(c)}
          {@const ref = dropped ? null : refOf(c.name)}
          {@const keys = dropped ? [] : keysOf(c.name)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="col-row {mark ?? ''}"
            data-col={c.name}
            role="row"
            tabindex="-1"
            draggable={editable && !dropped}
            ondragstart={() => (dragId = c.id)}
            ondragover={(e) => dragId && e.preventDefault()}
            ondrop={() => dropOn(c.id)}
            onkeydown={(e) => moveKey(e, c)}
          >
            <span class="c-handle" role="cell">
              {#if editable && !dropped}<span class="handle" aria-hidden="true" title={t('editor.col.drag')}>⋮⋮</span>{/if}
            </span>
            <span role="cell" class="c-name" data-label={t('editor.col.name')}>
              {#if editingName === c.id}
                {@const problem = nameProblem(c.id, nameValue)}
                <input
                  class="cell-input mono"
                  bind:value={nameValue}
                  aria-label={t('editor.col.name')}
                  aria-invalid={!!problem}
                  aria-describedby="name-err-{c.id}"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitName(c, 'next');
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      editingName = null;
                    } else if (e.key === 'Tab') commitName(c);
                  }}
                  onblur={() => commitName(c)}
                  use:autofocus
                />
                {#if problem}<span class="err" id="name-err-{c.id}" role="alert">{problem}</span>{/if}
              {:else if editable && !dropped}
                <button class="cell-btn mono name" onclick={() => startName(c)} title={prevTitle(c, 'name')}>{c.name}</button>
              {:else}
                <span class="mono name">{c.name}</span>
              {/if}
              {#if c.generated}<span class="v-badge" title={c.generated.expr}>{t('editor.col.generated')}</span>{/if}
              {#if mark === 'new'}<span class="v-badge v-badge--success state">{t('editor.state.new')}</span>
              {:else if mark === 'modified'}<span class="v-badge v-badge--warning state">{t('editor.state.modified')}</span>
              {:else if mark === 'dropped'}<span class="v-badge v-badge--danger state">{t('editor.state.dropped')}</span>{/if}
            </span>
            <span role="cell" data-label={t('editor.col.type')}>
              {#if editable && !dropped}
                <button class="cell-btn type" onclick={(e) => openType(c.id, e.currentTarget as HTMLElement)} aria-haspopup="dialog" title={prevTitle(c, 'type')}>
                  {t(typeLabelKey(c))} <span class="raw mono">· {realType(c)}</span>
                </button>
              {:else}
                <span class="type">{t(typeLabelKey(c))} <span class="raw mono">· {realType(c)}</span></span>
              {/if}
            </span>
            <span role="cell" class="c-sw" data-label={t('editor.col.null')}>
              {#if editable}
                <Switch checked={c.nullable} disabled={dropped || !!c.generated || c.autoIncrement} label={t('editor.col.nullFor', { name: c.name })} onchange={(v) => setCol(c.id, { nullable: v })} />
              {:else}<span class="ro-val">{c.nullable ? t('common.yes') : t('common.no')}</span>{/if}
            </span>
            <span role="cell" class="c-sw" data-label={t('editor.col.unsignedShort')}>
              {#if numeric}
                {#if editable}<Switch checked={c.unsigned} disabled={dropped} label={t('editor.col.unsignedFor', { name: c.name })} onchange={(v) => setCol(c.id, { unsigned: v })} />
                {:else if c.unsigned}<span class="ro-val">✓</span>{/if}
              {/if}
            </span>
            <span role="cell" class="c-sw" data-label="AI">
              {#if familyOf(c.type) === 'int' && !isBool(c)}
                {#if editable}<Switch checked={c.autoIncrement} disabled={dropped} label={t('editor.col.aiFor', { name: c.name })} onchange={(v) => setCol(c.id, { autoIncrement: v })} />
                {:else if c.autoIncrement}<span class="ro-val">✓</span>{/if}
              {/if}
            </span>
            <span role="cell" class="c-default" data-label={t('editor.col.default')} title={prevTitle(c, 'default')}>
              <DefaultChip def={c} editable={editable && !dropped} onchange={(d) => setCol(c.id, { default: d })} />
            </span>
            <span role="cell" class="c-keys" data-label={t('editor.col.key')}>
              {#each keys.slice(0, 2) as k}
                <button class="key {k.kind.toLowerCase()}" class:pending={!k.index.orig} onclick={() => showIndex(k.index.id)} title={badgeTip(k)} aria-label={badgeAria(k)}><KeyIcon kind={ICON[k.kind]} text={badgeText(k)} /></button>
              {/each}
              {#if keys.length > 2}
                <button type="button" class="key more" title={keys.map(badgeTip).join('\n')} aria-label={keys.map(badgeAria).join('; ')} onclick={() => showIndex(keys[2].index.id)}>+{keys.length - 2}</button>
              {/if}
              {#if editable && !dropped}
                <button class="add-index" class:has={keys.length > 0} onclick={() => addIndexFor(c)} title={t(keys.length ? 'editor.col.indexAnotherTip' : 'editor.col.indexTip', { name: c.name })} aria-label={t('editor.col.indexFor', { name: c.name })}>+ {keys.length ? '' : t('editor.col.index')}</button>
              {/if}
            </span>
            <span role="cell" class="c-ref" data-label={t('editor.col.references')}>
              {#if ref}
                <button class="ref" class:inferred={ref.kind === 'inferred'} onclick={() => (app.table = ref.table)} title={ref.kind === 'inferred' ? t('editor.rel.inferredTip') : ''}>
                  <KeyIcon kind={ref.kind === 'inferred' ? 'inferred' : 'fk'} text="{ref.table}.{ref.column}" wide />
                </button>
                {#if ref.kind === 'inferred'}<span class="v-badge">{t('relations.kind.inferred')}</span>{/if}
              {:else if polyIds.has(c.name)}
                {@const pair = app.polymorphic.find((p) => p.table === table && p.idColumn === c.name)}
                <span class="v-badge" title={t('relations.poly.tip', { type: pair?.typeColumn ?? '', id: c.name })}>{t('relations.poly.badge')}</span>
              {:else if !dropped && looksLikeFk(c.name) && editable}
                <button class="maybe" onclick={() => openFk(c.name)} title={t('editor.rel.maybeTip', { name: c.name })}>{t('editor.rel.maybe')}</button>
              {/if}
            </span>
            <span role="cell" class="c-act">
              {#if dropped}
                <button class="v-btn-ghost v-btn--sm" onclick={() => restore(c)}>{t('editor.col.restore')}</button>
              {:else}
                {#if editable}
                  <span class="hover-acts">
                    <button class="v-btn-icon v-btn--sm" onclick={() => duplicate(c)} aria-label={t('editor.col.duplicate', { name: c.name })} title={t('editor.col.duplicate', { name: c.name })}>⧉</button>
                    <button class="v-btn-icon v-btn--sm danger" onclick={() => remove(c)} aria-label={t('editor.col.delete', { name: c.name })} title={t('editor.col.delete', { name: c.name })}>✕</button>
                  </span>
                {/if}
                <button
                  class="v-btn-icon v-btn--sm"
                  onclick={() => {
                    advancedFor = c.id;
                    advancedRecorded = false;
                  }}
                  aria-label={t('editor.col.more', { name: c.name })}
                  title={t('editor.col.more', { name: c.name })}>⋯</button
                >
              {/if}
            </span>
          </div>
        {/each}

        {#if editable}
          <div class="col-row ghost" role="row">
            <span class="c-handle" role="cell"></span>
            <span role="cell" class="ghost-cell">
              <input
                class="ghost-input mono"
                bind:this={ghost}
                bind:value={ghostValue}
                onkeydown={ghostKey}
                placeholder={'+ ' + t('editor.ghost.placeholder')}
                aria-label={t('editor.ghost.label')}
                aria-invalid={!!ghostProblem}
                aria-describedby="ghost-help"
              />
              <span id="ghost-help" class="ghost-help" aria-live="polite">
                {#if ghostProblem}<span class="ghost-err">{ghostProblem}</span>
                {:else if ghostQuick}{t('editor.ghost.quick')}: <span class="mono">{ghostQuick.def.name}</span> · {typeText(ghostQuick.def)}{ghostQuick.def.nullable ? '' : ' · NOT NULL'}
                {:else if ghostSuggestion}{t(ghostSuggestion.reason)} → {typeText(ghostSuggestion.def)}{ghostSuggestion.def.nullable ? '' : ' · NOT NULL'}{#if ghostSuggestion.primary} · PK{/if}{#if ghostSuggestion.references} · {t('editor.ghost.relates', { table: ghostSuggestion.references.table })}{/if}
                {:else if ghostValue.trim()}{t('editor.ghost.nameOnly')}
                {:else}{t('editor.ghost.hint')}{/if}
              </span>
            </span>
          </div>
        {/if}
      </div>
    </section>

    <!-- 3. indexes -->
    <section class="block" aria-labelledby="idx-title">
      <div class="block-head">
        <div>
          <h2 id="idx-title">{t('editor.indexes')} <span class="dim">{n(draft.indexes.length)}</span></h2>
          <p class="section-help">{t('editor.help.indexes')}</p>
        </div>
      </div>
      {#if draft.indexes.length || droppedIndexes.length}
        <div class="idx-grid" role="grid" aria-label={t('editor.indexes')}>
          <div class="idx-head" role="row">
            <span role="columnheader">{t('idx.colType')}</span>
            <span role="columnheader">{t('editor.idx.name')}</span>
            <span role="columnheader">{t('editor.idx.columns')}</span>
            <span role="columnheader"><span class="sr-only">{t('monitor.proc.actions')}</span></span>
          </div>
          {#each shownIndexes as i (i.id)}
            {@const o = i.orig ? original.indexes.find((x) => x.orig === i.orig) : null}
            {@const changedIdx = !!o && JSON.stringify([o.kind, o.name, o.columns, !!o.invisible]) !== JSON.stringify([i.kind, i.name, i.columns, !!i.invisible])}
            <div id="idx-{i.id}" class="idx-row" role="row" tabindex="-1" class:flash={flashIndex === i.id} class:new={!i.orig} class:modified={changedIdx} class:hidden-idx={i.invisible}>
              <span role="gridcell"><span class="v-badge kind {i.kind.toLowerCase()}">{i.kind}</span></span>
              <span role="gridcell" class="iname" class:mono={i.kind !== 'PRIMARY'}>
                {idxName(i)}
                {#if i.invisible}<span class="v-badge" title={t('idx.invisibleTip')}>{t(info.indexSupport?.invisible === 'ignored' ? 'idx.ignored' : 'idx.invisible')}</span>{/if}
                {#if !i.orig}<span class="v-badge v-badge--success">{t('editor.state.newIndex')}</span>{:else if changedIdx}<span class="v-badge v-badge--warning">{t('idx.changed')}</span>{/if}
              </span>
              <span role="gridcell" class="ichips">
                {#each i.columns.map(parseIdxCol) as col, k}
                  <span class="ichip mono">{#if i.columns.length > 1}<span class="ord">{k + 1}</span>{/if}{col.name}{#if col.len}<span class="dim">({col.len})</span>{/if}{#if col.desc}<span class="dim"> DESC</span>{/if}</span>
                {/each}
              </span>
              <span role="gridcell" class="iacts">
                {#if editable}
                  <span class="hover-acts">
                    <button class="v-btn-ghost v-btn--sm" onclick={() => (idxForm = { editing: i.id, preselect: null })} aria-label={t('idx.edit', { name: idxName(i) })}>{t('idx.editShort')}</button>
                    {#if info.indexSupport?.invisible && i.kind !== 'PRIMARY'}
                      <button class="v-btn-ghost v-btn--sm" aria-pressed={!!i.invisible} onclick={() => toggleInvisible(i)} title={t('idx.invisibleTip')}>{i.invisible ? t('idx.makeVisible') : t('idx.makeInvisible')}</button>
                    {/if}
                    <button class="v-btn-icon v-btn--sm danger" onclick={() => edit((d) => (d.indexes = d.indexes.filter((x) => x.id !== i.id)))} aria-label={t('editor.idx.delete', { name: idxName(i) })} title={t('editor.idx.delete', { name: idxName(i) })}>✕</button>
                  </span>
                {/if}
              </span>
            </div>
            {#if idxForm?.editing === i.id && info.indexSupport}
              <div class="idx-form-row" id="idx-form">
                <IndexForm {db} {table} columns={draft.columns} indexes={draft.indexes} support={info.indexSupport} collation={draft.collation} initial={i} onsave={saveIndex} oncancel={() => (idxForm = null)} />
              </div>
            {/if}
          {/each}
          {#each droppedIndexes as o (o.id)}
            <div class="idx-row dropped" role="row">
              <span role="gridcell"><span class="v-badge kind">{o.kind}</span></span>
              <span role="gridcell" class="iname mono">{idxName(o)} <span class="v-badge v-badge--danger">{t('editor.state.dropped')}</span></span>
              <span role="gridcell" class="ichips">{#each o.columns.map(parseIdxCol) as col}<span class="ichip mono">{col.name}</span>{/each}</span>
              <span role="gridcell" class="iacts">{#if editable}<button class="v-btn-ghost v-btn--sm" onclick={() => restoreIndex(o)}>{t('editor.col.restore')}</button>{/if}</span>
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty">{t('editor.idx.empty')}</p>
      {/if}
      {#if redundant.length && editable}
        <div class="redundant" role="note">
          {#each redundant as r}
            <p>
              <span>💡 {t('idx.redundant', { name: r.index.name, by: idxName(r.coveredBy), columns: colsOf(r.coveredBy) })}</span>
              <button class="v-btn-ghost v-btn--sm" onclick={() => edit((d) => (d.indexes = d.indexes.filter((x) => x.id !== r.index.id)))} aria-label={t('idx.dropRedundantFor', { name: r.index.name })}>{t('idx.dropRedundant')}</button>
            </p>
          {/each}
        </div>
      {/if}
      {#if editable && info.indexSupport}
        {#if idxForm && !idxForm.editing}
          <div id="idx-form">
            <IndexForm {db} {table} columns={draft.columns} indexes={draft.indexes} support={info.indexSupport} collation={draft.collation} preselect={idxForm.preselect} onsave={saveIndex} oncancel={() => (idxForm = null)} />
          </div>
        {:else if !idxForm}
          <button class="v-btn-ghost v-btn--sm add-idx" onclick={() => (idxForm = { editing: null, preselect: null })}>+ {t('editor.idx.add')}</button>
        {/if}
      {/if}
    </section>

    <!-- 4. foreign keys (outgoing, suggestions, referenced by) -->
    <ForeignKeys {db} {table} {draft} {original} {editable} {edit} onfixcolumn={fixColumn} />

    <!-- CHECK constraints -->
    <Checks {db} {table} {draft} {original} {editable} {edit} support={info.checkSupport} />

    <!-- Triggers (edited in their own editor) -->
    <TableTriggers {table} />

    <!-- 5. code -->
    <details class="block code" bind:open={codeOpen}>
      <summary>{t('editor.code')}</summary>
      <div class="code-body">
        <div class="code-head"><strong>CREATE</strong><button class="v-btn-ghost v-btn--sm" onclick={() => copy(info!.create)}>{t('common.copy')}</button></div>
        <pre class="mono">{info.create}</pre>
        {#if count}
          <div class="code-head"><strong>ALTER</strong>{#if preview}<button class="v-btn-ghost v-btn--sm" onclick={() => copy(preview!.sql)}>{t('common.copy')}</button>{/if}</div>
          <pre class="mono">{previewError || preview?.sql || '…'}</pre>
        {/if}
      </div>
    </details>

    <!-- pending changes bar -->
    {#if count}
      <div class="pending" role="status" aria-live="polite">
        {#if showList}
          <ol class="pending-list" id="pending-list">
            {#each descriptions as d}<li>{plain(describeText(d))}</li>{/each}
          </ol>
        {/if}
        <button class="v-btn-ghost v-btn--sm count" onclick={() => (showList = !showList)} aria-expanded={showList} aria-controls="pending-list">
          <strong>{t('editor.pending.count', { count: n(count) })}</strong> <span aria-hidden="true">{showList ? '▾' : '▴'}</span>
        </button>
        <button class="v-btn-ghost v-btn--sm" onclick={undo} disabled={!canUndo} title="Ctrl+Z">{t('tabs.undo')}</button>
        <button class="v-btn-ghost v-btn--sm" onclick={redo} disabled={!canRedo} title="Ctrl+Shift+Z">{t('editor.redo')}</button>
        <button class="v-btn-ghost v-btn--sm" onclick={discard}>{t('editor.pending.discard')}</button>
        <button
          class="v-btn-primary v-btn--sm"
          onclick={() => {
            review = true;
            loadPreview();
          }}>{t('editor.pending.review')}</button
        >
      </div>
    {/if}
  {:else if !loadError}
    <p class="dim loading">{t('common.loading')}</p>
  {/if}
</section>

{#if typeFor && draft}
  {@const col = draft.columns.find((x) => x.id === typeFor!.id)}
  {#if col}
    <TypePopover anchor={typeFor.anchor} def={col} onchange={changeType} onclose={() => (typeFor = null)} />
  {/if}
{/if}

{#if chipFor && draft && info}
  <Popover anchor={chipFor.anchor} label={chipFor.kind === 'engine' ? t('structure.engine') : chipFor.kind === 'collation' ? t('editor.advanced.collation') : 'AUTO_INCREMENT'} onclose={() => (chipFor = null)} width={280}>
    {#if chipFor.kind === 'engine'}
      <div class="pop-field">{t('structure.engine')}
        <Select value={draft.engine} label={t('structure.engine')} options={info.engines.map((en) => ({ value: en, label: en }))} onchange={(v) => { setTable({ engine: v }); chipFor = null; }} />
      </div>
    {:else if chipFor.kind === 'collation'}
      <div class="pop-field">{t('editor.advanced.collation')}
        <Select value={draft.collation} label={t('editor.advanced.collation')} mono options={info.collations.map((c) => ({ value: c, label: c }))} onchange={(v) => { setTable({ collation: v }); chipFor = null; }} />
      </div>
      <p class="pop-note">{t('editor.table.collationNote')}</p>
    {:else}
      <label class="pop-field">AUTO_INCREMENT
        <input
          class="v-input"
          type="number"
          min="1"
          value={draft.autoIncrement ?? 1}
          data-autofocus
          onchange={(e) => {
            setTable({ autoIncrement: Number((e.currentTarget as HTMLInputElement).value) || 1 });
            chipFor = null;
          }}
        />
      </label>
    {/if}
  </Popover>
{/if}

{#if advancedFor && draft && info}
  {@const col = draft.columns.find((x) => x.id === advancedFor)}
  {#if col}
    <AdvancedDrawer def={col} collations={info.collations} {editable} onchange={changeAdvanced} onclose={() => (advancedFor = null)} />
  {/if}
{/if}



{#if review}
  <ReviewDrawer
    items={descriptions}
    warnings={preview?.warnings ?? []}
    sql={preview?.sql ?? ''}
    loading={previewLoading}
    {table}
    error={previewError}
    {failure}
    managed={info?.managedBy ?? null}
    onfix={setFix}
    onremove={removeChange}
    onviewrows={viewRows}
    onretrywithout={retryWithout}
    {applying}
    onapply={apply}
    onclose={() => (review = false)}
  />
{/if}

<style>
  /* Rows scrolled into view stop below the sticky header and column header. */
  .editor-view {
    scroll-padding-top: calc(var(--head-h) + 40px);
  }
  .col-row,
  .idx-row {
    scroll-margin-top: calc(var(--head-h) + 40px);
  }
  .idx-grid {
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
  }
  .idx-head,
  .idx-row {
    display: grid;
    grid-template-columns: 110px minmax(160px, 1fr) minmax(220px, 2fr) 220px;
    gap: 10px;
    align-items: center;
    min-height: 40px;
    padding: 0 12px;
    border-bottom: 1px solid var(--sp-border);
  }
  .idx-head {
    min-height: 32px;
    background: var(--sp-bg-subtle);
    border-radius: var(--sp-radius-lg) var(--sp-radius-lg) 0 0;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--sp-text-secondary);
  }
  .idx-row:last-child {
    border-bottom: 0;
  }
  .idx-row.new {
    box-shadow: inset 3px 0 0 var(--sp-success);
  }
  .idx-row.modified {
    box-shadow: inset 3px 0 0 var(--sp-warning);
  }
  .idx-row.dropped .iname,
  .idx-row.dropped .ichips {
    text-decoration: line-through;
    color: var(--sp-text-tertiary);
  }
  .idx-row.hidden-idx .ichips {
    opacity: 0.6;
  }
  .idx-row.flash {
    animation: idx-flash 1.6s ease;
  }
  @keyframes idx-flash {
    0%,
    40% {
      background: var(--sp-warning-light);
    }
    100% {
      background: transparent;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .idx-row.flash {
      animation: none;
      outline: 2px solid var(--sp-warning);
    }
  }
  .idx-row .iname {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    font-size: 12.5px;
    min-width: 0;
  }
  .idx-row .ichips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .idx-row .ichip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px;
    border: 1px solid var(--sp-border);
    border-radius: 999px;
    font-size: 12px;
  }
  .idx-row .ichip .ord {
    display: inline-grid;
    place-items: center;
    min-width: 16px;
    height: 16px;
    border-radius: 999px;
    background: var(--sp-bg-subtle);
    font-size: 10.5px;
  }
  .idx-row .iacts {
    display: flex;
    justify-content: flex-end;
  }
  .idx-row .hover-acts {
    display: flex;
    gap: 4px;
    opacity: 0;
  }
  .idx-row:hover .hover-acts,
  .idx-row:focus-within .hover-acts {
    opacity: 1;
  }
  .idx-form-row {
    padding: 10px 12px;
    border-bottom: 1px solid var(--sp-border);
  }
  .redundant {
    display: grid;
    gap: 4px;
    padding: 8px 12px;
    border: 1px dashed var(--sp-border);
    border-radius: var(--sp-radius-lg);
    font-size: 12.5px;
    color: var(--sp-text-secondary);
  }
  .redundant p {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .add-idx {
    justify-self: start;
  }
  @media (max-width: 720px) {
    .idx-head {
      display: none;
    }
    .idx-row {
      grid-template-columns: 1fr;
      gap: 6px;
      padding: 10px 12px;
    }
    .idx-row .iacts {
      justify-content: flex-start;
    }
    .idx-row .hover-acts {
      opacity: 1;
    }
  }
  .editor-view {
    height: 100%;
    overflow: auto;
    padding: 16px 20px 96px;
    display: grid;
    gap: 18px;
    align-content: start;
    font-size: 13.5px;
  }
  .ro {
    margin: 0;
  }
  .dim {
    color: var(--sp-text-tertiary);
    font-weight: 400;
  }
  .small {
    font-size: 12px;
  }
  .loading {
    padding: 24px;
  }
  .head {
    position: sticky;
    top: -16px;
    z-index: 6;
    display: grid;
    gap: 4px;
    margin: -16px -20px 0;
    padding: 16px 20px 10px;
    background: var(--sp-bg);
    border-bottom: 1px solid transparent;
    transition: padding 150ms ease, border-color 150ms ease;
  }
  .head.scrolled {
    padding-top: 22px;
    padding-bottom: 8px;
    border-bottom-color: var(--sp-border);
    box-shadow: var(--sp-shadow);
  }
  .head.scrolled .title {
    font-size: 15px;
  }
  .section-help {
    margin: 2px 0 0;
    font-size: 12.5px;
    color: var(--sp-text-secondary);
    max-width: 760px;
  }
  .state {
    flex-shrink: 0;
    font-size: 10.5px;
  }
  .pending-list {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    right: 0;
    margin: 0;
    padding: 10px 14px 10px 30px;
    max-height: 260px;
    overflow: auto;
    background: var(--sp-bg);
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
    box-shadow: var(--sp-shadow-md);
    font-size: 12.5px;
    display: grid;
    gap: 4px;
  }
  .count {
    padding-left: 6px;
  }
  .title,
  .title-input {
    justify-self: start;
    margin: 0 0 0 -6px;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: var(--sp-radius);
    background: none;
    font-size: 20px;
    font-weight: 600;
    color: var(--sp-text-primary);
  }
  button.title {
    cursor: text;
  }
  button.title:hover {
    border-color: var(--sp-border);
  }
  .title-input {
    border-color: var(--sp-focus);
    background: var(--sp-bg);
    min-width: 260px;
  }
  .title-input:focus {
    outline: none;
  }
  .comment {
    margin: 0 0 0 -6px;
    padding: 3px 6px;
    border: 1px solid transparent;
    border-radius: var(--sp-radius);
    background: none;
    color: var(--sp-text-secondary);
    font-size: 13.5px;
    max-width: 640px;
  }
  input.comment:hover {
    border-color: var(--sp-border);
  }
  input.comment:focus {
    outline: none;
    border-color: var(--sp-focus);
    background: var(--sp-bg);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 10px;
    border: 1px solid var(--sp-border);
    border-radius: 999px;
    background: var(--sp-bg);
    color: var(--sp-text-secondary);
    font-size: 12px;
    cursor: pointer;
    transition: border-color var(--sp-ease);
  }
  button.chip:hover {
    border-color: var(--sp-border-hover);
    color: var(--sp-text-primary);
  }
  .chip.static {
    cursor: default;
    background: var(--sp-bg-subtle);
  }
  .block {
    display: grid;
    gap: 8px;
  }
  .block-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .ai-box {
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border-radius: var(--sp-radius-lg);
    background: var(--ai-light);
    border: 1px solid color-mix(in srgb, var(--ai) 30%, transparent);
  }
  .ai-box label {
    font-size: 12.5px;
    font-weight: 500;
  }
  .ai-actions {
    display: flex;
    gap: 10px;
    align-items: center;
    font-size: 12px;
  }

  /* --- columns table --- */
  .cols {
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
  }
  .cols-head,
  .col-row {
    display: grid;
    grid-template-columns: 22px minmax(140px, 1.2fr) minmax(170px, 1.4fr) 52px 52px 44px minmax(110px, 0.9fr) minmax(150px, 0.9fr) minmax(140px, 1fr) 96px;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    min-height: 40px;
  }
  .cols-head {
    position: sticky;
    top: calc(var(--head-h) - 16px);
    z-index: 4;
    min-height: 32px;
    background: var(--sp-bg-subtle);
    border-bottom: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg) var(--sp-radius-lg) 0 0;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--sp-text-secondary);
  }
  .col-row {
    border-bottom: 1px solid var(--sp-border);
    box-shadow: inset 3px 0 0 transparent;
    transition: box-shadow 150ms ease, background 150ms ease;
  }
  .col-row:last-child {
    border-bottom: 0;
  }
  .col-row:hover {
    background: var(--sp-bg-subtle);
  }
  .col-row:focus {
    outline: none;
  }
  .col-row.new {
    box-shadow: inset 3px 0 0 var(--sp-success);
  }
  .col-row.modified {
    box-shadow: inset 3px 0 0 var(--sp-warning);
  }
  .col-row.dropped {
    box-shadow: inset 3px 0 0 var(--sp-danger);
    color: var(--sp-text-tertiary);
  }
  .col-row.dropped .name,
  .col-row.dropped .type {
    text-decoration: line-through;
  }
  .c-sw {
    display: flex;
    justify-content: center;
  }
  .ro-val {
    font-size: 12.5px;
    color: var(--sp-text-secondary);
  }
  .c-handle {
    color: var(--sp-text-tertiary);
    cursor: grab;
    font-size: 11px;
    letter-spacing: -2px;
  }
  .handle {
    opacity: 0;
  }
  .col-row:hover .handle,
  .col-row:focus-within .handle {
    opacity: 1;
  }
  .c-name {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .cell-btn {
    max-width: 100%;
    padding: 3px 6px;
    margin-left: -6px;
    border: 1px solid transparent;
    border-radius: var(--sp-radius);
    background: none;
    text-align: left;
    color: var(--sp-text-primary);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cell-btn:hover,
  .cell-btn:focus-visible {
    border-color: var(--sp-border-hover);
    background: var(--sp-bg);
  }
  .name {
    font-size: 13px;
    font-weight: 500;
  }
  .type {
    font-size: 13px;
  }
  .raw {
    font-size: 12px;
    color: var(--sp-text-tertiary);
  }
  .cell-input {
    width: 100%;
    height: 28px;
    padding: 0 6px;
    border: 1px solid var(--sp-focus);
    border-radius: var(--sp-radius);
    background: var(--sp-bg);
    font-size: 13px;
  }
  .cell-input[aria-invalid='true'] {
    border-color: var(--sp-danger);
  }
  .cell-input:focus {
    outline: none;
  }
  .err {
    position: absolute;
    left: 0;
    top: calc(100% + 1px);
    z-index: 5;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--sp-danger-light);
    color: var(--sp-danger-text);
    font-size: 11.5px;
    white-space: nowrap;
  }
  .c-keys,
  .c-ref {
    display: flex;
    gap: 4px;
    align-items: center;
    min-width: 0;
  }
  .c-keys {
    flex-wrap: wrap;
    row-gap: 2px;
  }
  .key {
    white-space: nowrap;
  }
  .key {
    padding: 1px 6px;
    border: 1px solid var(--sp-border);
    border-radius: 4px;
    background: var(--sp-bg-subtle);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
    cursor: pointer;
  }
  .key.pri {
    color: var(--sp-warning);
    border-color: var(--sp-warning-border);
  }
  .key.uni {
    border-color: var(--sp-text-secondary);
  }
  .key.more {
    cursor: help;
  }
  /* Pending (not applied yet): same green marker as other pending changes. */
  .key.pending {
    border-color: var(--sp-success);
    box-shadow: inset 2px 0 0 var(--sp-success);
  }
  .key:hover {
    border-color: var(--sp-border-hover);
  }
  .add-index,
  .maybe {
    padding: 1px 6px;
    border: 1px dashed var(--sp-border-hover);
    border-radius: 4px;
    background: none;
    color: var(--sp-text-tertiary);
    font-size: 11.5px;
    cursor: pointer;
    white-space: nowrap;
  }
  .add-index {
    opacity: 0;
  }
  .add-index.has {
    padding: 1px 5px;
  }
  .col-row:hover .add-index,
  .add-index:focus-visible {
    opacity: 1;
  }
  .maybe:hover,
  .add-index:hover {
    color: var(--sp-text-primary);
    border-color: var(--sp-text-secondary);
  }
  .ref {
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    font-family: var(--sp-font-mono);
    font-size: 12px;
    color: var(--sp-text-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ref.inferred {
    text-decoration-style: dashed;
    color: var(--sp-text-secondary);
  }
  .c-act {
    display: flex;
    justify-content: flex-end;
    gap: 2px;
  }
  .hover-acts {
    display: inline-flex;
    gap: 2px;
    opacity: 0;
  }
  .col-row:hover .hover-acts,
  .col-row:focus-within .hover-acts {
    opacity: 1;
  }
  .danger {
    color: var(--sp-danger);
  }
  .ghost {
    background: var(--sp-bg-subtle);
    border-radius: 0 0 var(--sp-radius-lg) var(--sp-radius-lg);
  }
  .ghost-cell {
    grid-column: 2 / -1;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .ghost-input {
    flex: 0 1 380px;
    height: 28px;
    padding: 0 8px;
    border: 1px dashed var(--sp-border-hover);
    border-radius: var(--sp-radius);
    background: var(--sp-bg);
    font-size: 13px;
  }
  .ghost-input:focus {
    outline: none;
    border-style: solid;
    border-color: var(--sp-focus);
  }
  .ghost-input[aria-invalid='true'] {
    border-color: var(--sp-danger);
  }
  .ghost-help {
    font-size: 12px;
    color: var(--sp-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ghost-err {
    color: var(--sp-danger-text);
  }

  .iname {
    font-size: 12.5px;
    min-width: 120px;
  }
  .ichips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    flex: 1;
  }
  .ichip {
    padding: 1px 8px;
    border: 1px solid var(--sp-border);
    border-radius: 999px;
    background: var(--sp-bg-subtle);
    font-size: 11.5px;
  }
  .empty {
    margin: 0;
    padding: 12px 14px;
    border: 1px dashed var(--sp-border);
    border-radius: var(--sp-radius-lg);
    color: var(--sp-text-secondary);
    font-size: 13px;
  }

  /* --- code --- */
  .code {
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
    padding: 0;
  }
  .code summary {
    padding: 10px 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .code-body {
    padding: 0 14px 14px;
    display: grid;
    gap: 6px;
  }
  .code-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
  }
  pre {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--sp-radius);
    background: var(--sp-bg-subtle);
    font-size: 12px;
    white-space: pre-wrap;
    overflow-x: auto;
  }

  /* --- pending bar --- */
  .pending {
    position: sticky;
    min-width: 0;
    bottom: 12px;
    justify-self: center;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px 6px 14px;
    border: 1px solid var(--sp-border);
    border-radius: 999px;
    background: var(--sp-bg);
    box-shadow: var(--sp-shadow-md);
    font-size: 13px;
    z-index: 5;
    animation: rise 150ms ease-out;
  }
  @keyframes rise {
    from {
      transform: translateY(6px);
      opacity: 0;
    }
  }
  .pop-field {
    display: grid;
    gap: 6px;
    font-size: 12.5px;
    font-weight: 500;
  }
  .pop-note {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--sp-text-secondary);
  }

  /* --- phones: each column is a stacked card with the same controls --- */
  @media (max-width: 720px) {
    .editor-view {
      padding: 12px 12px 120px;
    }
    .cols {
      border: 0;
      display: grid;
      gap: 8px;
    }
    .cols-head {
      display: none;
    }
    .col-row {
      grid-template-columns: 1fr 1fr 1fr;
      gap: 8px 10px;
      padding: 10px 12px;
      border: 1px solid var(--sp-border);
      border-radius: var(--sp-radius-lg);
    }
    .col-row:last-child {
      border-bottom: 1px solid var(--sp-border);
    }
    .col-row > [role='cell'][data-label]::before {
      content: attr(data-label);
      display: block;
      font-size: 11px;
      color: var(--sp-text-tertiary);
      margin-bottom: 3px;
    }
    .c-name,
    .col-row > [role='cell']:nth-child(3),
    .c-ref {
      grid-column: 1 / -1;
    }
    .c-name,
    .c-keys,
    .c-ref {
      display: block;
    }
    .c-handle {
      display: none;
    }
    .c-sw {
      display: block;
    }
    .c-act {
      grid-column: 1 / -1;
      justify-content: flex-start;
    }
    .hover-acts,
    .add-index {
      opacity: 1;
    }
    .ghost-cell {
      grid-column: 1 / -1;
      flex-direction: column;
      align-items: stretch;
    }
    .ghost-help {
      white-space: normal;
    }
    .pending {
      flex-wrap: wrap;
      justify-content: center;
      border-radius: var(--sp-radius-lg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .col-row,
    .pending {
      transition: none;
      animation: none;
    }
  }
  :global(.focus-flash) {
    outline: 2px solid var(--sp-focus);
    outline-offset: -2px;
    background-color: var(--sp-bg-muted);
  }
</style>
