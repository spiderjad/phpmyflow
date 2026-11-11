<script lang="ts" module>
  /** Hidden / pinned columns and per-column relation display, per table, for this session. */
  const viewMemory = new Map<string, { hidden: string[]; pinned: string[]; rel: Record<string, 'both' | 'name' | 'id'>; revealed: string[] }>();
</script>

<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { groupKeys } from '../lib/keyIcons';
  import { isSensitiveColumn, MASK } from '../lib/sensitive';
  import { toast } from '../lib/ui.svelte';
  import type { Cell, RefCount, Relation } from '../lib/api';
  import { autoWidths, columnKind, filterKind, formatDate, formatDateFull, isBoolColumn, isHashColumn, isMonoColumn, jsonSummary, specialCell, visibleRange, type GridColumn } from '../lib/grid';
  import { app } from '../lib/state.svelte';
  import { copyAs, exportAs, type CopyFormat, type ExportFormat } from '../lib/gridExport';
  import { i18n, n, t } from '../lib/i18n.svelte';
  import { prefs, ROW_HEIGHT } from '../lib/prefs.svelte';
  import {
    allRange,
    bounds,
    cellRange,
    colRange,
    edges,
    fullRows,
    isSelected,
    rowRange,
    selectionMatrix,
    spanRange,
    stats,
    type Pos,
    type Range,
  } from '../lib/selection';
  import RecordPicker from './objects/RecordPicker.svelte';
  import { cellLabel, type ColumnLabels } from '../lib/fkLabels';
  import KeyIcon from './KeyIcon.svelte';
  import type { KeyIconData } from '../lib/keyIcons';
  import { settings } from '../lib/settings.svelte';
  import ContextMenu, { type MenuItem } from './ui/Menu.svelte';
  import RowDetail from './RowDetail.svelte';

  let {
    columns: allColumns,
    rows: allRows,
    label,
    tableName = '',
    rowOffset = 0,
    sort = null,
    onsort,
    filters,
    filtersOpen = false,
    onfilter,
    onfiltervalue,
    editable = false,
    onedit: parentEdit,
    ondeleterows,
    links: allLinks = [],
    onfollow: parentFollow,
    loadRelated,
    onopenrelated,
    selectable = false,
    selected = $bindable(new Set<number>()),
    emptyText = '',
    labels: allLabels = [],
    db = '',
    keyIcons: allKeyIcons = null,
    onkey,
    onsortdir,
    onopenfilter,
    onstructure,
  }: {
    columns: GridColumn[];
    rows: Cell[][];
    label: string;
    /** Known table (data view): used for INSERT and file names. */
    tableName?: string;
    rowOffset?: number;
    sort?: { col: string; dir: 'ASC' | 'DESC' } | null;
    onsort?: (col: string) => void;
    filters?: Record<string, string>;
    filtersOpen?: boolean;
    onfilter?: (col: string, value: string) => void;
    /** "Filter by this value" / "Exclude this value" (data view only). */
    onfiltervalue?: (col: string, value: Cell, exclude: boolean) => void;
    editable?: boolean;
    /** Persist one cell. Resolve true when saved (the parent updates `rows`). */
    onedit?: (row: number, col: number, value: string | null) => Promise<boolean>;
    ondeleterows?: (rows: number[]) => void;
    /** Relation per column (declared or inferred), aligned with `columns`. */
    links?: (Relation | undefined)[];
    /** Follow the relation of a cell: open the target table filtered by its value. */
    onfollow?: (row: number, col: number) => void;
    /** Rows elsewhere that point to this row (row detail "Related"). */
    loadRelated?: (row: number) => Promise<RefCount[]>;
    onopenrelated?: (ref: RefCount, row: number) => void;
    selectable?: boolean;
    /** Rows fully selected (row header or full-width range), for bulk delete. */
    selected?: Set<number>;
    /** Names of related records per column (lookup_many), aligned with `columns`. */
    labels?: (ColumnLabels | undefined)[];
    /** Database of the table (the in-cell record picker). */
    db?: string;
    /** Keys per column (PK, U, I, FK, inferred) for table data; null = query results (plain PK mark). */
    keyIcons?: KeyIconData[][] | null;
    /** A key icon was clicked: open its definition. */
    onkey?: (k: KeyIconData) => void;
    /** Header menu: sort in this direction. */
    onsortdir?: (col: string, dir: 'ASC' | 'DESC') => void;
    /** Header menu: show the filter row (the grid focuses this column's filter). */
    onopenfilter?: (col: string) => void;
    /** Header menu: open the column in Structure. */
    onstructure?: (col: string) => void;
    emptyText?: string;
  } = $props();

  // --- visual order: pinned columns first, hidden ones out (identity = the parent's arrays) ---
  const viewKey = $derived(tableName || label);
  let hidden = $state<string[]>([]);
  let pinned = $state<string[]>([]);
  let relMode = $state<Record<string, 'both' | 'name' | 'id'>>({});
  /** Sensitive columns revealed for this session (header eye). */
  let revealed = $state<string[]>([]);
  /** Single cells revealed (cell eye): "row:column", reset with new rows. */
  let revealedCells = $state<Set<string>>(new Set());
  $effect(() => {
    const k = viewKey;
    untrack(() => {
      const m = viewMemory.get(k);
      hidden = m?.hidden ?? [];
      pinned = m?.pinned ?? [];
      relMode = m?.rel ?? {};
      revealed = m?.revealed ?? [];
    });
  });
  function remember() {
    viewMemory.set(viewKey, { hidden: [...hidden], pinned: [...pinned], rel: { ...relMode }, revealed: [...revealed] });
  }
  const order = $derived.by(() => {
    const vis = allColumns.map((_, j) => j).filter((j) => !hidden.includes(allColumns[j].name));
    const pin = pinned.map((n) => allColumns.findIndex((c) => c.name === n)).filter((j) => j >= 0 && vis.includes(j));
    return [...pin, ...vis.filter((j) => !pin.includes(j))];
  });
  const identity = $derived(order.length === allColumns.length && order.every((j, k) => j === k));
  const columns = $derived(identity ? allColumns : order.map((j) => allColumns[j]));
  const rows = $derived(identity ? allRows : allRows.map((r) => order.map((j) => r[j])));
  const links = $derived(identity ? allLinks : order.map((j) => allLinks[j]));
  const labels = $derived(identity ? allLabels : order.map((j) => allLabels[j]));
  const keyIcons = $derived(!allKeyIcons || identity ? allKeyIcons : order.map((j) => allKeyIcons[j]));
  const pinnedCount = $derived(order.filter((j) => pinned.includes(allColumns[j].name)).length);
  // Back to the parent's column numbers.
  const onedit = $derived(parentEdit ? (r: number, c: number, v: string | null) => parentEdit(r, order[c], v) : undefined);
  const onfollow = $derived(parentFollow ? (r: number, c: number) => parentFollow(r, order[c]) : undefined);
  const relModeOf = (j: number) => relMode[columns[j]?.name] ?? settings.data.relations;

  const VIRTUAL_FROM = 500;
  const HEAD_WIDTH = 56;
  const rowHeight = $derived(ROW_HEIGHT[prefs.density]);
  const kinds = $derived(columns.map((c) => columnKind(c.type)));
  // One typeface per data type: numbers, ids, dates and hashes in monospace, text in the UI font.
  const mono = $derived(columns.map((c, j) => isMonoColumn(c) || (kinds[j] === 'text' && isHashColumn(rows, j))));
  const bools = $derived(columns.map(isBoolColumn));
  // Sensitive columns (password, token, bcrypt / argon2 values...): hidden until revealed.
  const secret = $derived(
    columns.map((c, j) => settings.data.hideSensitive && isSensitiveColumn(c.name, kinds[j], rows.slice(0, 50).map((r) => r[j]), settings.data.sensitive)),
  );
  const masked = (i: number, j: number) => secret[j] && !revealed.includes(columns[j].name) && !revealedCells.has(`${i}:${columns[j].name}`);
  $effect(() => {
    void allRows;
    untrack(() => (revealedCells = new Set()));
  });
  function revealCell(i: number, j: number) {
    revealedCells = new Set([...revealedCells, `${i}:${columns[j].name}`]);
  }
  function toggleColumn(j: number) {
    const name = columns[j].name;
    revealed = revealed.includes(name) ? revealed.filter((x) => x !== name) : [...revealed, name];
    remember();
  }
  const numericCols = $derived(kinds.map((k) => k === 'number'));

  /** What a cell shows: text, extra class, tooltip, accessible name, relation label. */
  interface CellView {
    text: string;
    cls: string;
    title?: string;
    aria?: string;
    /** Relation: name of the related record (UI font) and its id (monospace, dimmed). */
    label?: string;
    id?: string;
    broken?: string;
    /** Long text / JSON: preview on hover (after a short wait). */
    peek?: string;
    /** Sensitive value shown as dots (eye to reveal). */
    secret?: boolean;
  }
  const LONG = 48;
  function cellView(v: Cell, j: number, i = -1): CellView {
    const sp = specialCell(v);
    if (sp === 'null') return { text: 'NULL', cls: 'c-null' };
    if (sp === 'binary') return { text: display(v, j), cls: 'c-null' };
    if (sp === 'empty') return { text: t('grid.emptyText'), cls: 'c-empty', aria: t('grid.emptyAria') };
    if (i >= 0 && masked(i, j)) return { text: MASK, cls: 'c-secret', aria: t('grid.hiddenValue'), secret: true };
    const s = String(v);
    if (links[j] && relModeOf(j) !== 'id') {
      const lab = cellLabel(v, labels[j]);
      if (lab.kind === 'label') return { text: '', cls: 'c-rel', label: lab.label, id: relModeOf(j) === 'both' ? lab.id : undefined, title: `${lab.label} · ${lab.id}` };
      if (lab.kind === 'broken') return { text: '', cls: 'c-rel', broken: lab.id, title: t('grid.brokenRef', { id: lab.id, table: links[j]?.to ?? '' }) };
    }
    if (bools[j] && (s === '0' || s === '1')) return { text: s === '1' ? '✓' : '—', cls: s === '1' ? 'c-bool on' : 'c-bool', title: s, aria: s === '1' ? t('common.yes') : t('common.no') };
    const kind = kinds[j];
    if (kind === 'date' || kind === 'datetime') {
      return { text: settings.data.dates === 'locale' ? formatDate(s, kind, i18n.locale) : s, cls: '', title: formatDateFull(s, kind, i18n.locale, app.timeZone) };
    }
    if (kind === 'text') {
      const js = jsonSummary(s);
      if (js) return { text: js.kind === 'object' ? t('grid.jsonObject', { count: n(js.size) }) : t('grid.jsonArray', { count: n(js.size) }), cls: 'c-json', peek: js.preview };
      if (s.length > LONG || s.includes('\n')) return { text: s.length > 300 ? s.slice(0, 300) : s, cls: '', peek: s.slice(0, 4000) };
    }
    return { text: s, cls: '' };
  }

  // Long text and JSON: preview after a short wait on hover (full content in the row detail).
  let peek = $state<{ text: string; x: number; y: number; json: boolean } | null>(null);
  let peekTimer: ReturnType<typeof setTimeout> | undefined;
  function peekStart(e: PointerEvent, cv: CellView) {
    clearTimeout(peekTimer);
    if (!cv.peek || dragging) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const json = cv.cls === 'c-json';
    const text = cv.peek;
    peekTimer = setTimeout(() => (peek = { text, x: Math.min(r.left, window.innerWidth - 500), y: r.bottom + 4 > window.innerHeight - 220 ? Math.max(8, r.top - 224) : r.bottom + 4, json }), 550);
  }
  function peekEnd() {
    clearTimeout(peekTimer);
    peek = null;
  }

  function display(v: Cell, j: number): string {
    if (v === null) return 'NULL';
    if (typeof v === 'object') return t('grid.binary', { size: n(v.$binary) });
    const kind = kinds[j];
    if ((kind === 'date' || kind === 'datetime') && settings.data.dates === 'locale') return formatDate(String(v), kind, i18n.locale);
    return String(v);
  }

  function tooltip(v: Cell, j: number): string | undefined {
    if (v === null || typeof v === 'object') return undefined;
    const lab = cellLabel(v, labels[j]);
    if (lab.kind === 'label') return `${lab.label} · ${lab.id}`;
    if (lab.kind === 'broken') return t('grid.brokenRef', { id: lab.id, table: links[j]?.to ?? '' });
    const s = String(v);
    const kind = kinds[j];
    if (kind === 'date' || kind === 'datetime') return s;
    return s.length > 24 ? s.slice(0, 1000) : undefined;
  }

  // --- column widths: automatic from the first rows, then user-resizable ---
  let widthMap = $state<Record<string, number>>({});
  const widths = $derived(columns.map((c) => widthMap[c.name] ?? 120));
  function setWidths(list: number[]) {
    const next = { ...widthMap };
    columns.forEach((c, j) => (next[c.name] = list[j]));
    widthMap = next;
  }
  function setWidth(j: number, w: number) {
    widthMap = { ...widthMap, [columns[j].name]: w };
  }
  /** Header: name (+ grouped key badges, sort and menu buttons), and the full type in comfortable mode. */
  function headerWidth(j: number): number {
    const c = columns[j];
    const badges = keyIcons?.[j] ? groupKeys(keyIcons[j]).reduce((sum, k) => sum + 22 + Math.min(14, k.text.length) * 6.6, 0) : 0;
    // Name and type share the column button; badges, sort and ⋯ sit beside it.
    const name = c.name.length * 7.6;
    const type = prefs.density === 'comfortable' ? (c.fullType ?? c.type).length * 6.8 : 0;
    const side = badges + (onsort ? 22 : 0) + 24 + 12;
    const padding = prefs.density === 'comfortable' ? 26 : 18;
    return Math.min(520, Math.round(Math.max(name, type) + side + padding));
  }
  const columnsKey = $derived(allColumns.map((c) => c.name + ':' + c.type).join('|'));
  $effect(() => {
    void columnsKey;
    untrack(() => {
      // Hidden (sensitive) columns are measured as the dots they show.
      const hide = allColumns.map((c, j) => settings.data.hideSensitive && isSensitiveColumn(c.name, columnKind(c.type), allRows.slice(0, 50).map((r) => r[j]), settings.data.sensitive));
      const fit = autoWidths(allColumns, allRows, (v, c) => {
        const j = allColumns.indexOf(c);
        return hide[j] && v !== null && v !== '' ? MASK + '   ' : display(v, j);
      });
      const next: Record<string, number> = {};
      allColumns.forEach((c, j) => (next[c.name] = fit[j]));
      widthMap = next;
      active = { r: 0, c: 0 };
      anchor = { r: 0, c: 0 };
      ranges = [];
      editing = null;
      detail = null;
    });
  });
  // New rows (paging, refresh): selection indexes no longer mean the same rows.
  $effect(() => {
    void rows;
    untrack(() => {
      ranges = [];
      if (active.r >= rows.length) active = { r: 0, c: active.c };
    });
  });
  // Related columns: measured as "Name · id" (+ the follow arrow) once the names arrive.
  function measured(v: Cell, j: number): string {
    const lab = cellLabel(v, labels[j]);
    if (lab.kind !== 'label' || relModeOf(j) === 'id') return display(v, j);
    return relModeOf(j) === 'name' ? `${lab.label}  ` : `${lab.label} · ${lab.id}  `;
  }
  $effect(() => {
    if (!labels.some(Boolean)) return;
    untrack(() => {
      const fit = autoWidths(columns, rows, (v, c) => measured(v, columns.indexOf(c)));
      // Only widen: a column the user resized wider stays as it is.
      setWidths(widths.map((w, j) => (labels[j] ? Math.max(w, fit[j]) : w)));
    });
  });
  // Headers: make room for the key badges, the buttons and (comfortable) the full type. Only widen.
  $effect(() => {
    void keyIcons;
    void prefs.density;
    void columnsKey;
    untrack(() => setWidths(widths.map((w, j) => Math.max(w, headerWidth(j)))));
  });
  const totalWidth = $derived(HEAD_WIDTH + widths.reduce((a, b) => a + b, 0));
  const stickyN = $derived(Math.max(1, pinnedCount));
  const lefts = $derived(widths.reduce<number[]>((acc, w, j) => (acc.push(j === 0 ? HEAD_WIDTH : acc[j - 1] + widths[j - 1]), acc), []));

  let resizing: { col: number; startX: number; startW: number } | null = null;
  function startResize(e: PointerEvent, col: number) {
    e.preventDefault();
    e.stopPropagation();
    resizing = { col, startX: e.clientX, startW: widths[col] };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function moveResize(e: PointerEvent) {
    if (!resizing) return;
    setWidth(resizing.col, Math.max(40, Math.round(resizing.startW + e.clientX - resizing.startX)));
  }
  function endResize() {
    resizing = null;
  }
  function resizeKey(e: KeyboardEvent, col: number) {
    const step = e.shiftKey ? 40 : 10;
    if (e.key === 'ArrowLeft') setWidth(col, Math.max(40, widths[col] - step));
    else if (e.key === 'ArrowRight') setWidth(col, widths[col] + step);
    else return;
    e.preventDefault();
  }
  function fitColumn(col: number) {
    setWidth(col, Math.max(headerWidth(col), autoWidths([columns[col]], rows.map((r) => [r[col]]), (v) => measured(v, col), 200)[0]));
  }

  // --- virtualization (fixed row height) ---
  let scroller: HTMLDivElement | undefined = $state();
  let scrollTop = $state(0);
  let viewport = $state(600);
  const virtual = $derived(rows.length >= VIRTUAL_FROM);
  const range = $derived(virtual ? visibleRange(scrollTop, viewport, rowHeight, rows.length) : { start: 0, end: rows.length });

  $effect(() => {
    if (!scroller) return;
    const ro = new ResizeObserver(() => (viewport = scroller!.clientHeight));
    ro.observe(scroller);
    return () => ro.disconnect();
  });

  // --- selection (spreadsheet style) ---
  let active = $state<Pos>({ r: 0, c: 0 });
  let anchor = $state<Pos>({ r: 0, c: 0 });
  let ranges = $state<Range[]>([]);
  let dragging = false;
  let editing = $state<{ r: number; c: number; value: string } | null>(null);
  let detail = $state<number | null>(null);
  let menu = $state<{ x: number; y: number } | null>(null);

  const sel = $derived(ranges.length ? ranges : rows.length ? [cellRange({ r: active.r, c: Math.max(0, active.c) })] : []);
  const st = $derived(rows.length && columns.length ? stats(sel, rows, numericCols) : null);

  // Fully selected rows drive the parent's bulk delete button.
  $effect(() => {
    const full = selectable ? fullRows(ranges, columns.length) : [];
    untrack(() => {
      if (full.length !== selected.size || full.some((r) => !selected.has(r))) selected = new Set(full);
    });
  });

  function select(next: Range, mode: 'replace' | 'add' | 'extend') {
    if (mode === 'add') ranges = [...ranges, next];
    else if (mode === 'extend' && ranges.length) ranges = [...ranges.slice(0, -1), next];
    else ranges = [next];
  }

  const modeOf = (e: MouseEvent | KeyboardEvent): 'replace' | 'add' | 'extend' => (e.shiftKey ? 'extend' : e.ctrlKey || e.metaKey ? 'add' : 'replace');

  const canFollow = (r: number, c: number) => {
    const v = rows[r]?.[c];
    return !!onfollow && !!links[c] && v !== null && v !== undefined && typeof v !== 'object';
  };

  function cellDown(e: PointerEvent, r: number, c: number) {
    if (e.button !== 0 || editing) return;
    if ((e.ctrlKey || e.metaKey) && canFollow(r, c)) {
      e.preventDefault();
      onfollow!(r, c);
      return;
    }
    const mode = modeOf(e);
    if (mode === 'extend') select(spanRange(anchor, { r, c }), 'extend');
    else {
      anchor = { r, c };
      select(cellRange({ r, c }), mode);
    }
    active = { r, c };
    dragging = true;
  }

  function cellEnter(e: PointerEvent, r: number, c: number) {
    if (!dragging || !(e.buttons & 1)) return;
    select(spanRange(anchor, { r, c }), 'extend');
    active = { r, c };
  }

  function rowHeaderDown(e: PointerEvent, r: number) {
    if (e.button !== 0) return;
    const mode = modeOf(e);
    const last = columns.length - 1;
    if (mode === 'extend') select({ r1: anchor.r, c1: 0, r2: r, c2: last }, 'extend');
    else {
      anchor = { r, c: 0 };
      select(rowRange(r, columns.length), mode);
    }
    active = { r, c: -1 };
  }

  function columnHeaderClick(e: MouseEvent, c: number) {
    if (!rows.length) return;
    const mode = modeOf(e);
    if (mode === 'extend') select({ r1: 0, c1: anchor.c, r2: rows.length - 1, c2: c }, 'extend');
    else {
      anchor = { r: 0, c };
      select(colRange(c, rows.length), mode);
    }
    active = { r: active.r, c };
  }

  function selectAll() {
    if (!rows.length) return;
    ranges = [allRange(rows.length, columns.length)];
  }

  function cellBorder(r: number, c: number): string | undefined {
    if (!ranges.length) return undefined;
    const e = edges(ranges, r, c);
    const s: string[] = [];
    if (e.t) s.push('inset 0 2px 0 -1px var(--sel-edge)');
    if (e.b) s.push('inset 0 -2px 0 -1px var(--sel-edge)');
    if (e.l) s.push('inset 2px 0 0 -1px var(--sel-edge)');
    if (e.r) s.push('inset -2px 0 0 -1px var(--sel-edge)');
    return s.length ? s.join(', ') : undefined;
  }

  // --- keyboard ---
  async function focusActive() {
    if (!scroller) return;
    const top = active.r * rowHeight;
    const head = scroller.querySelector('thead')?.clientHeight ?? 0;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + rowHeight > scroller.scrollTop + scroller.clientHeight - head) scroller.scrollTop = top + rowHeight - scroller.clientHeight + head;
    scrollTop = scroller.scrollTop;
    await tick();
    scroller.querySelector<HTMLElement>(`[data-r="${active.r}"][data-c="${active.c}"]`)?.focus({ preventScroll: false });
  }

  function move(dr: number, dc: number, extend: boolean) {
    if (!rows.length) return;
    active = {
      r: Math.min(rows.length - 1, Math.max(0, active.r + dr)),
      c: Math.min(columns.length - 1, Math.max(extend ? 0 : -1, active.c + dc)),
    };
    if (extend) select(spanRange(anchor, { r: active.r, c: Math.max(0, active.c) }), 'extend');
    else {
      anchor = { r: active.r, c: Math.max(0, active.c) };
      ranges = [];
    }
    focusActive();
  }

  function onGridKey(e: KeyboardEvent) {
    if (editing || menu) return;
    const target = e.target as HTMLElement;
    if (!target.matches('[data-r]')) return;
    const page = Math.max(1, Math.floor((scroller?.clientHeight ?? 400) / rowHeight) - 2);
    const ext = e.shiftKey;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'c') {
      copySelection('tsv');
    } else if (mod && e.key.toLowerCase() === 'a') {
      selectAll();
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      const r = target.getBoundingClientRect();
      menu = { x: r.left + 8, y: r.bottom };
    } else
      switch (e.key) {
        case 'ArrowDown': move(mod ? rows.length : 1, 0, ext); break;
        case 'ArrowUp': move(mod ? -rows.length : -1, 0, ext); break;
        case 'ArrowRight': move(0, mod ? columns.length : 1, ext); break;
        case 'ArrowLeft': move(0, mod ? -columns.length : -1, ext); break;
        case 'PageDown': move(page, 0, ext); break;
        case 'PageUp': move(-page, 0, ext); break;
        case 'Home': mod ? move(-rows.length, -columns.length, ext) : move(0, -columns.length, ext); break;
        case 'End': mod ? move(rows.length, columns.length, ext) : move(0, columns.length, ext); break;
        case 'Escape': ranges = []; break;
        case 'Enter':
        case 'F2':
          if (active.c === -1 || !editable || columns[active.c]?.pk) detail = active.r;
          else startEdit(active.r, active.c);
          break;
        case 'Delete':
          if (ondeleterows && editable && selected.size) ondeleterows([...selected]);
          else return;
          break;
        default:
          return;
      }
    e.preventDefault();
  }

  // --- editing ---
  function startEdit(r: number, c: number) {
    if (!editable || !onedit) return;
    const v = rows[r][c];
    if (v !== null && typeof v === 'object') return; // binary: not editable inline
    active = { r, c };
    editing = { r, c, value: v === null ? '' : String(v) };
  }

  async function saveEdit(setNull = false, then: 'stay' | 'down' | 'right' = 'stay') {
    if (!editing || !onedit) return;
    const { r, c, value } = editing;
    const original = rows[r][c];
    const next = setNull ? null : value;
    editing = null;
    if (next !== (original === null ? null : String(original))) await onedit(r, c, next);
    if (then === 'down') move(1, 0, false);
    else if (then === 'right') move(0, 1, false);
    else focusActive();
  }

  function editKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveEdit(false, 'down');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      saveEdit(false, 'right');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      editing = null;
      focusActive();
    }
  }

  function autofocus(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  function closeDetail() {
    detail = null;
    focusActive();
  }

  // --- copy / export ---
  function selectionData(all = false) {
    if (all) return { cols: columns, values: rows as (Cell | undefined)[][] };
    const m = selectionMatrix(sel, rows);
    return { cols: m.cols.map((c) => columns[c]), values: m.values };
  }

  function copySelection(format: CopyFormat) {
    const { cols, values } = selectionData();
    copyAs(format, cols, values, tableName);
    // The real value is copied: say so when it includes a sensitive one.
    const m = selectionMatrix(sel, rows);
    if (m.cols.some((c, k) => secret[c] && m.values.some((r) => r[k] !== null && r[k] !== undefined && r[k] !== ''))) toast(t('grid.copiedSensitive'), 'info', 4000);
  }

  function exportData(format: ExportFormat, all: boolean) {
    const { cols, values } = selectionData(all);
    exportAs(format, cols, values, tableName || 'result');
  }

  async function setNullSelected() {
    if (!onedit) return;
    const b = bounds(sel);
    for (const r of b.rows) for (const c of b.cols) if (isSelected(sel, r, c) && columns[c].nullable && !columns[c].pk && rows[r][c] !== null) await onedit(r, c, null);
  }

  function openMenu(e: MouseEvent, r: number, c: number) {
    e.preventDefault();
    if (!isSelected(sel, r, Math.max(0, c))) {
      anchor = { r, c: Math.max(0, c) };
      ranges = [c === -1 ? rowRange(r, columns.length) : cellRange({ r, c })];
    }
    active = { r, c };
    menu = { x: e.clientX, y: e.clientY };
  }

  function closeMenu(refocus: boolean) {
    menu = null;
    if (refocus) focusActive();
  }

  const menuItems = $derived.by((): MenuItem[] => {
    if (!menu) return [];
    const c = Math.max(0, active.c);
    const col = columns[c];
    const value = rows[active.r]?.[c];
    const b = bounds(sel);
    const singleCol = b.cols.length === 1;
    const items: MenuItem[] = [
      { label: t('menu.copy'), icon: 'copy', keys: ['Ctrl', 'C'], action: () => copySelection('tsv') },
      {
        label: t('menu.copyAs'),
        icon: 'copyAs',
        submenu: [
          { label: 'JSON', action: () => copySelection('json') },
          { label: 'CSV', action: () => copySelection('csv') },
          { label: 'Markdown', action: () => copySelection('markdown') },
          { label: t('menu.sqlInsert'), action: () => copySelection('insert') },
          { label: t('menu.inList'), disabled: !singleCol, action: () => copySelection('in') },
        ],
      },
      { label: t('menu.copyNames'), icon: 'columns', action: () => copySelection('names') },
      'sep',
      {
        label: t('menu.exportSelection'),
        icon: 'export',
        submenu: [
          { label: 'Excel (.xlsx)', action: () => exportData('xlsx', false) },
          { label: 'CSV', action: () => exportData('csv', false) },
          { label: 'JSON', action: () => exportData('json', false) },
        ],
      },
      {
        label: t('menu.exportAll', { count: n(rows.length) }),
        icon: 'export',
        submenu: [
          { label: 'Excel (.xlsx)', action: () => exportData('xlsx', true) },
          { label: 'CSV', action: () => exportData('csv', true) },
          { label: 'JSON', action: () => exportData('json', true) },
        ],
      },
    ];
    if (canFollow(active.r, c)) {
      const link = links[c]!;
      items.push('sep', {
        label: t('menu.follow', { table: `${link.to}.${link.toColumn}` }),
        icon: 'follow',
        keys: ['Ctrl', t('menu.click')],
        action: () => onfollow!(active.r, c),
      });
    }
    if (onfiltervalue && col && value !== undefined && (value === null || typeof value !== 'object')) {
      items.push(
        'sep',
        { label: t('menu.filterValue'), icon: 'filter', action: () => onfiltervalue(col.name, value, false) },
        { label: t('menu.excludeValue'), icon: 'exclude', action: () => onfiltervalue(col.name, value, true) },
      );
    }
    if (editable && onedit) {
      const rowsToDelete = b.rows;
      items.push(
        'sep',
        { label: t('menu.edit'), icon: 'edit', keys: ['Enter'], disabled: !col || col.pk || active.c === -1, action: () => startEdit(active.r, c) },
        { label: t('menu.setNull'), icon: 'null', disabled: !b.cols.some((j) => columns[j].nullable && !columns[j].pk), action: setNullSelected },
      );
      if (ondeleterows)
        items.push({
          label: t('menu.deleteRows', { count: n(rowsToDelete.length) }),
          icon: 'trash',
          keys: ['Supr'],
          danger: true,
          action: () => ondeleterows(rowsToDelete),
        });
    }
    return items;
  });

  // --- header menu (⋯): sort, filter, hide, pin, fit, copy name, relation display, Structure ---
  let hmenu = $state<{ x: number; y: number; j: number } | null>(null);
  function openHeaderMenu(e: MouseEvent, j: number) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hmenu = { x: r.left, y: r.bottom + 2, j };
  }
  const headerItems = $derived.by((): MenuItem[] => {
    if (!hmenu) return [];
    const j = hmenu.j;
    const c = columns[j];
    if (!c) return [];
    const isPinned = pinned.includes(c.name);
    const items: MenuItem[] = [];
    if (onsortdir) {
      items.push(
        { label: t('grid.sortAsc'), icon: 'sortAsc', action: () => onsortdir(c.name, 'ASC') },
        { label: t('grid.sortDesc'), icon: 'sortDesc', action: () => onsortdir(c.name, 'DESC') },
        'sep',
      );
    }
    if (onopenfilter) {
      items.push({
        label: t('grid.filterThis'),
        icon: 'filter',
        action: async () => {
          onopenfilter(c.name);
          await tick();
          scroller?.querySelector<HTMLInputElement>(`input[aria-label="${CSS.escape(t('grid.filterColumn', { column: c.name }))}"]`)?.focus();
        },
      });
    }
    items.push(
      {
        label: t('grid.hideColumn'),
        icon: 'eyeOff',
        disabled: columns.length <= 1 ? t('grid.hideLast') : false,
        action: () => {
          hidden = [...hidden, c.name];
          remember();
        },
      },
      {
        label: isPinned ? t('grid.unpin') : t('grid.pinLeft'),
        icon: 'pin',
        action: () => {
          pinned = isPinned ? pinned.filter((x) => x !== c.name) : [...pinned, c.name];
          remember();
        },
      },
      { label: t('grid.fitWidth'), icon: 'fit', keys: [t('grid.dblClickBorder')], action: () => fitColumn(j) },
      {
        label: t('grid.copyName'),
        icon: 'copy',
        action: async () => {
          await navigator.clipboard?.writeText(c.name).catch(() => {});
          toast(t('grid.copiedName', { name: c.name }), 'info', 2000);
        },
      },
    );
    if (links[j]) {
      const cur = relModeOf(j);
      const set = (m: 'both' | 'name' | 'id') => {
        relMode = { ...relMode, [c.name]: m };
        remember();
      };
      items.push('sep', {
        label: t('grid.relationAs'),
        icon: 'link',
        submenu: [
          { label: t('settings.relations.both'), checked: cur === 'both', action: () => set('both') },
          { label: t('settings.relations.name'), checked: cur === 'name', action: () => set('name') },
          { label: t('settings.relations.id'), checked: cur === 'id', action: () => set('id') },
        ],
      });
    }
    if (onstructure) items.push('sep', { label: t('grid.toStructure'), icon: 'structure', action: () => onstructure(c.name) });
    return items;
  });
  function showAllColumns() {
    hidden = [];
    remember();
  }

  const placeholder = (type: string) => t(`grid.ph.${filterKind(type)}`);
  const fmt = (x: number) => new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 4 }).format(x);
</script>

<svelte:window onpointerup={() => (dragging = false)} />

<div class="dg-wrap">
  <div class="dg-col">
    <div
      class="dg-scroll {prefs.density}"
      bind:this={scroller}
      onscroll={() => {
        scrollTop = scroller!.scrollTop;
        if (peek) peekEnd();
      }}
      style:--rh="{rowHeight}px"
      style:--head-w="{HEAD_WIDTH}px"
      style:--th-h={prefs.density === 'comfortable' ? '44px' : '30px'}
    >
      <table
        class="dg"
        role="grid"
        aria-label={label}
        aria-multiselectable="true"
        aria-rowcount={rows.length + 1}
        aria-colcount={columns.length + 1}
        style:width="{totalWidth}px"
      >
        <colgroup>
          <col style:width="{HEAD_WIDTH}px" />
          {#each widths as w}<col style:width="{w}px" />{/each}
        </colgroup>
        <thead>
          <tr aria-rowindex={1}>
            <th class="rh sticky-0 corner" scope="col">
              <button class="corner-btn" onclick={selectAll} aria-label={t('grid.selectAll')} title={t('grid.selectAll')}>
                <span aria-hidden="true">#</span>
              </button>
            </th>
            {#each columns as c, j}
              <th
                scope="col"
                class:sticky-1={j < stickyN}
                class:sticky-last={j === stickyN - 1}
                style:left={j < stickyN ? `${lefts[j]}px` : undefined}
                class:col-sel={ranges.some((g) => g.c1 <= j && j <= g.c2 && Math.min(g.r1, g.r2) === 0 && Math.max(g.r1, g.r2) === rows.length - 1)}
                aria-sort={sort?.col === c.name ? (sort.dir === 'ASC' ? 'ascending' : 'descending') : undefined}
                title={(c.fullType ?? c.type) + (c.comment ? ' — ' + c.comment : '') + (pinned.includes(c.name) ? ' · ' + t('grid.pinned') : '')}
              >
                <div class="th-in">
                  <button class="th-btn" onclick={(e) => columnHeaderClick(e, j)} aria-label={t('grid.selectColumn', { column: c.name })}>
                    <span class="th-line">
                      {#if !keyIcons && c.pk}<span class="pk">PK</span>{/if}
                      <span class="th-name">{c.name}</span>
                      {#if !keyIcons && links[j]}<span class="th-link" title={`→ ${links[j]!.to}.${links[j]!.toColumn} (${t(`relations.kind.${links[j]!.kind}`)})`}>→ {links[j]!.to}</span>{/if}
                    </span>
                    {#if prefs.density === 'comfortable'}<span class="th-type">{c.fullType ?? c.type}</span>{/if}
                  </button>
                  {#if keyIcons?.[j]?.length}
                    <!-- Keys: one badge per category (PK, U, I ×n, →table); details in the tooltip. A click opens Structure. -->
                    <span class="th-keys">
                      {#each groupKeys(keyIcons[j]) as k}
                        <button class="th-key" title={k.tip} aria-label={k.tip} onclick={() => onkey?.(k)}><KeyIcon kind={k.kind} text={k.text} /></button>
                      {/each}
                    </span>
                  {/if}
                  {#if secret[j]}
                    <button
                      class="th-eye"
                      aria-pressed={revealed.includes(c.name)}
                      aria-label={revealed.includes(c.name) ? t('grid.hideColumnValues', { column: c.name }) : t('grid.revealColumn', { column: c.name })}
                      title={revealed.includes(c.name) ? t('grid.hideColumnValues', { column: c.name }) : t('grid.revealColumn', { column: c.name })}
                      onclick={() => toggleColumn(j)}
                    >
                      {#if revealed.includes(c.name)}
                        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.3" /><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
                      {:else}
                        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 2l12 12M6.6 6.6a2 2 0 0 0 2.8 2.8M4.3 4.4C2.6 5.6 1.5 8 1.5 8S4 12.5 8 12.5c1.3 0 2.4-.4 3.4-1M7 3.6c.3-.1.7-.1 1-.1 4 0 6.5 4.5 6.5 4.5s-.6 1.1-1.7 2.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" /></svg>
                      {/if}
                    </button>
                  {/if}
                  {#if onsort}
                    <button
                      class="sort"
                      class:on={sort?.col === c.name}
                      onclick={() => onsort(c.name)}
                      aria-label={t('grid.sortBy', { column: c.name })}
                      title={t('grid.sortBy', { column: c.name })}
                    >{sort?.col === c.name ? (sort.dir === 'ASC' ? '↑' : '↓') : '↕'}</button>
                  {/if}
                  <button class="th-menu" aria-haspopup="menu" aria-expanded={hmenu?.j === j} aria-label={t('grid.columnMenu', { column: c.name })} title={t('grid.columnMenu', { column: c.name })} onclick={(e) => openHeaderMenu(e, j)}>
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3" fill="currentColor" /><circle cx="8" cy="8" r="1.3" fill="currentColor" /><circle cx="12.5" cy="8" r="1.3" fill="currentColor" /></svg>
                  </button>
                </div>
                <!-- Focusable separator = ARIA "window splitter" pattern, keyboard resizable. -->
                <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
                <span
                  class="resize"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t('grid.resizeColumn', { column: c.name })}
                  aria-valuenow={widths[j]}
                  tabindex="0"
                  onpointerdown={(e) => startResize(e, j)}
                  onpointermove={moveResize}
                  onpointerup={endResize}
                  onkeydown={(e) => resizeKey(e, j)}
                  ondblclick={() => fitColumn(j)}
                ></span>
              </th>
            {/each}
          </tr>
          {#if filtersOpen && filters && onfilter}
            <tr class="filters">
              <th class="rh sticky-0"></th>
              {#each columns as c, j}
                <th class:sticky-1={j < stickyN} class:sticky-last={j === stickyN - 1} style:left={j < stickyN ? `${lefts[j]}px` : undefined}>
                  <input
                    class="f"
                    value={filters[c.name] ?? ''}
                    oninput={(e) => onfilter(c.name, (e.currentTarget as HTMLInputElement).value)}
                    placeholder={placeholder(c.type)}
                    aria-label={t('grid.filterColumn', { column: c.name })}
                  />
                </th>
              {/each}
            </tr>
          {/if}
        </thead>
        <tbody>
          {#if range.start > 0}<tr class="spacer" aria-hidden="true"><td colspan={columns.length + 1} style:height="{range.start * rowHeight}px"></td></tr>{/if}
          {#each { length: range.end - range.start } as _, k (range.start + k)}
            {@const i = range.start + k}
            {@const row = rows[i]}
            <tr aria-rowindex={i + 2} class:sel-row={selected.has(i)} class:active-row={active.r === i} class:odd={i % 2 === 1}>
              <th
                scope="row"
                class="rh sticky-0"
                class:row-sel={ranges.some((g) => Math.min(g.r1, g.r2) <= i && i <= Math.max(g.r1, g.r2) && Math.min(g.c1, g.c2) === 0 && Math.max(g.c1, g.c2) === columns.length - 1)}
                data-r={i}
                data-c={-1}
                tabindex={active.r === i && active.c === -1 ? 0 : -1}
                onpointerdown={(e) => rowHeaderDown(e, i)}
                oncontextmenu={(e) => openMenu(e, i, -1)}
                onkeydown={onGridKey}
              >
                <span class="rn">{n(rowOffset + i + 1)}</span>
                <button
                  class="open"
                  tabindex="-1"
                  onpointerdown={(e) => e.stopPropagation()}
                  onclick={() => (detail = i)}
                  aria-label={t('grid.openDetail', { n: n(rowOffset + i + 1) })}
                  title={t('grid.openDetail', { n: n(rowOffset + i + 1) })}
                >
                  <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M7 1.5h3.5V5M10.5 1.5 6 6M5 2.5H2.5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></svg>
                </button>
              </th>
              {#each columns as c, j}
                {@const v = row[j]}
                {#if editing && editing.r === i && editing.c === j}
                  <td class="editing" class:sticky-1={j < stickyN} style:left={j < stickyN ? `${lefts[j]}px` : undefined} class:picking={!!links[j] && !!db} role="gridcell">
                    {#if links[j] && db}
                      <RecordPicker
                        {db}
                        table={links[j]!.to}
                        column={links[j]!.toColumn}
                        id="cell-pick-{i}-{j}"
                        label={t('grid.pickFor', { column: c.name, table: links[j]!.to })}
                        nullable={c.nullable}
                        value={editing.value === '' && rows[i][j] === null ? null : editing.value}
                        compact
                        autoOpen
                        onchange={(v) => {
                          if (!editing) return;
                          if (v === null) saveEdit(true);
                          else {
                            editing.value = v;
                            saveEdit();
                          }
                        }}
                        oncancel={() => {
                          editing = null;
                          focusActive();
                        }}
                      />
                    {:else}
                    <input class="cell-input" bind:value={editing.value} onkeydown={editKey} onblur={() => saveEdit()} use:autofocus aria-label={c.name} />
                    {#if c.nullable}
                      <button class="null-btn" onmousedown={(e) => { e.preventDefault(); saveEdit(true); }}>NULL</button>
                    {/if}
                    {/if}
                  </td>
                {:else}
                  {@const isSel = ranges.length > 0 && isSelected(ranges, i, j)}
                  {@const cv = cellView(v, j, i)}
                  {@const follow = !!links[j] && v !== null && typeof v !== 'object' && !!onfollow}
                  <td
                    role="gridcell"
                    aria-selected={isSel}
                    aria-label={cv.aria}
                    data-r={i}
                    data-c={j}
                    tabindex={active.r === i && active.c === j ? 0 : -1}
                    class="{cv.cls}"
                    class:sticky-1={j < stickyN}
                    class:sticky-last={j === stickyN - 1}
                    style:left={j < stickyN ? `${lefts[j]}px` : undefined}
                    class:mono={mono[j] && !cv.label && !cv.broken && cv.cls !== 'c-empty'}
                    class:num={kinds[j] === 'number' && !cv.label}
                    class:sel={isSel}
                    class:linked={!!links[j]}
                    style:box-shadow={isSel ? cellBorder(i, j) : undefined}
                    title={cv.peek ? undefined : cv.title}
                    onpointerdown={(e) => { peekEnd(); cellDown(e, i, j); }}
                    onpointerenter={(e) => { cellEnter(e, i, j); peekStart(e, cv); }}
                    onpointerleave={peekEnd}
                    ondblclick={() => (c.pk || !editable ? (detail = i) : startEdit(i, j))}
                    oncontextmenu={(e) => openMenu(e, i, j)}
                    onkeydown={onGridKey}
                  >{#if cv.secret}<span class="cl"><span class="ct mask" aria-hidden="true">{MASK}</span><button
                        class="eye"
                        tabindex="-1"
                        onpointerdown={(e) => e.stopPropagation()}
                        onclick={() => revealCell(i, j)}
                        aria-label={t('grid.revealValue')}
                        title={t('grid.revealValue')}
                      ><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.3" /><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.3" /></svg></button></span>{:else if follow || cv.label || cv.broken}<span class="cl"><span class="ct">{#if cv.label}<span class="lbl">{cv.label}</span>{#if cv.id}<span class="lid">{' · '}{cv.id}</span>{/if}{:else if cv.broken}<span class="broken"><span aria-hidden="true">⚠ </span>{cv.broken}</span>{:else}{cv.text}{/if}</span>{#if follow}<button
                        class="fk"
                        class:inferred={links[j]!.kind === 'inferred'}
                        tabindex="-1"
                        onpointerdown={(e) => e.stopPropagation()}
                        onclick={() => onfollow!(i, j)}
                        aria-label={t('grid.follow', { table: links[j]!.to })}
                        title={t('grid.followTip', { table: `${links[j]!.to}.${links[j]!.toColumn}`, kind: t(`relations.kind.${links[j]!.kind}`) })}
                      ><svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M4.5 2.5h5v5M9.5 2.5 3 9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" /></svg></button>{/if}</span>{:else}{cv.text}{/if}</td>
                {/if}
              {/each}
            </tr>
          {/each}
          {#if range.end < rows.length}<tr class="spacer" aria-hidden="true"><td colspan={columns.length + 1} style:height="{(rows.length - range.end) * rowHeight}px"></td></tr>{/if}
        </tbody>
      </table>
      {#if !rows.length && emptyText}
        <p class="empty">{emptyText}</p>
      {/if}
    </div>

    {#if st && rows.length}
      <div class="status" role="status" aria-live="polite">
        <span>{t('status.cells', { count: n(st.count) })}</span>
        {#if st.numeric > 0 && st.count > 1}
          <span><span class="k">{t('status.sum')}</span> {fmt(st.sum)}</span>
          <span><span class="k">{t('status.avg')}</span> {fmt(st.avg)}</span>
          <span><span class="k">{t('status.min')}</span> {fmt(st.min)}</span>
          <span><span class="k">{t('status.max')}</span> {fmt(st.max)}</span>
        {/if}
        <span class="spacer"></span>
        {#if hidden.length}
          <button class="hidden-cols" onclick={showAllColumns} title={hidden.join(', ')}>{t('grid.hiddenCols', { count: n(hidden.length) })}</button>
        {/if}
        <span class="hint"><kbd class="v-kbd">Ctrl</kbd><kbd class="v-kbd">C</kbd> {t('status.copyHint')} · {t('status.menuHint')}</span>
      </div>
    {/if}
  </div>

  {#if detail !== null && rows[detail]}
    {@const detailRow = detail}
    <RowDetail
      columns={allColumns}
      row={allRows[detail]}
      secret={(jAll) => {
        const k = order.indexOf(jAll);
        return k >= 0 ? masked(detailRow, k) : false;
      }}
      index={rowOffset + detail + 1}
      display={(v, jAll) => {
        const k = order.indexOf(jAll);
        return k >= 0 ? display(v, k) : v === null ? 'NULL' : typeof v === 'object' ? t('grid.binary', { size: n(v.$binary) }) : String(v);
      }}
      onclose={closeDetail}
      related={loadRelated ? () => loadRelated(detailRow) : undefined}
      onopenrelated={onopenrelated ? (ref) => onopenrelated(ref, detailRow) : undefined}
    />
  {/if}
</div>

{#if peek}
  <div class="peek" class:json={peek.json} role="tooltip" style:left="{peek.x}px" style:top="{peek.y}px">{peek.text}</div>
{/if}

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menuItems} label={t('menu.label')} onclose={closeMenu} />
{/if}
{#if hmenu}
  <ContextMenu x={hmenu.x} y={hmenu.y} items={headerItems} label={t('grid.columnMenu', { column: columns[hmenu.j]?.name ?? '' })} onclose={() => (hmenu = null)} />
{/if}

<style>
  .dg-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    /* Selection colors (spider-ui has no selection tokens yet; see docs/spider-ui-gaps.md). */
    --sel-edge: var(--sp-focus);
    --sel-bg: color-mix(in srgb, var(--sp-focus) 7%, var(--sp-bg));
    --sel-head: color-mix(in srgb, var(--sp-focus) 12%, var(--sp-bg-subtle));
  }
  .dg-col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .dg-scroll {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }
  .dg {
    table-layout: fixed;
    border-collapse: separate;
    border-spacing: 0;
    font-family: var(--sp-font);
    font-size: 13px;
    font-variant-ligatures: none;
    user-select: none;
  }
  .comfortable .dg {
    font-size: 13.5px;
  }
  .dg th,
  .dg td {
    height: var(--rh);
    padding: 0 8px;
    border-bottom: 1px solid var(--sp-border);
    border-right: 1px solid var(--sp-border);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    background: var(--sp-bg);
  }
  .comfortable th,
  .comfortable td {
    padding: 0 12px;
  }
  .dg thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    height: var(--th-h);
    background: var(--sp-bg-subtle);
    font-size: 12px;
    font-weight: 600;
    color: var(--sp-text-secondary);
    overflow: visible;
  }
  .dg thead tr.filters th {
    top: var(--th-h);
    padding: 3px 4px;
    background: var(--sp-bg);
  }
  .sticky-0 {
    position: sticky;
    left: 0;
    z-index: 1;
  }
  .sticky-1 {
    position: sticky;
    left: var(--head-w);
    z-index: 1;
  }
  .sticky-last {
    box-shadow: 1px 0 0 var(--sp-border);
  }
  .dg thead th.sticky-0,
  .dg thead th.sticky-1 {
    z-index: 3;
  }
  .dg td,
  .dg th {
    vertical-align: middle;
  }
  .dg tbody tr:hover > * {
    background: color-mix(in srgb, var(--sp-bg-muted) 55%, var(--sp-bg));
  }
  /* The row of the active cell (and fully selected rows): accent edge on the row header. */
  .dg tbody tr.active-row > th.rh,
  .dg tbody tr.sel-row > th.rh {
    box-shadow: inset 3px 0 0 var(--sp-inverse);
    color: var(--sp-text-primary);
  }
  .dg tbody tr.sel-row > *,
  .dg tbody td.sel {
    background: var(--sel-bg);
  }
  .dg thead th.col-sel,
  .dg tbody th.row-sel {
    background: var(--sel-head);
    color: var(--sp-text-primary);
  }
  .dg td:focus,
  .dg th[data-r]:focus {
    outline: 2px solid var(--sp-focus);
    outline-offset: -2px;
  }
  .mono {
    font-family: var(--sp-font-mono);
    font-size: 12.5px;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  /* Special cells: NULL (italic, dim), empty text (a faint "empty" tag), booleans, JSON. */
  td.c-null {
    color: var(--sp-text-tertiary);
    font-style: italic;
  }
  td.c-empty {
    color: var(--sp-text-tertiary);
    font-size: 11px;
    letter-spacing: 0.02em;
  }
  td.c-bool {
    text-align: center;
    color: var(--sp-text-tertiary);
  }
  td.c-bool.on {
    color: var(--sp-text-primary);
    font-weight: 600;
  }
  td.c-json {
    color: var(--sp-text-secondary);
  }
  /* Relation cells: name in the UI font, id dimmed in monospace, icon at the end. */
  .cl {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }
  .ct {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  td.num .ct {
    text-align: right;
  }
  .lid {
    font-family: var(--sp-font-mono);
    font-size: 0.92em;
    color: var(--sp-text-tertiary);
  }
  /* Sensitive values: dots + eye (cell) and an eye in the header (whole column). */
  .mask {
    letter-spacing: 0.1em;
    color: var(--sp-text-secondary);
  }
  .eye,
  .th-eye {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    margin-right: -6px;
    padding: 0;
    border: 0;
    border-radius: var(--sp-radius);
    background: none;
    color: var(--sp-text-secondary);
    cursor: pointer;
  }
  .eye {
    opacity: 0;
  }
  td:hover .eye,
  td:focus .eye,
  .eye:focus-visible {
    opacity: 1;
  }
  .th-eye {
    width: 20px;
    height: 20px;
    margin: 0;
  }
  .th-eye[aria-pressed='true'] {
    color: var(--sp-warning);
  }
  .eye:hover,
  .th-eye:hover {
    background: var(--sp-bg-muted);
    color: var(--sp-text-primary);
  }
  .th-eye:focus-visible {
    outline: 2px solid var(--sp-focus);
    outline-offset: 1px;
  }
  .peek {
    position: fixed;
    z-index: 60;
    max-width: min(480px, calc(100vw - 16px));
    max-height: 210px;
    overflow: hidden;
    padding: 8px 10px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
    background: var(--sp-bg);
    box-shadow: var(--sp-shadow-md);
    color: var(--sp-text-primary);
    font-size: 12.5px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
    pointer-events: none;
  }
  .peek.json {
    font-family: var(--sp-font-mono);
    font-size: 12px;
  }
  .rh {
    text-align: right;
    color: var(--sp-text-tertiary);
    font-weight: 400;
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    cursor: default;
  }
  tbody .rh {
    padding: 0 4px 0 2px;
  }
  .rn {
    display: inline-block;
    min-width: 24px;
    vertical-align: middle;
  }
  .open {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    margin-left: 2px;
    vertical-align: middle;
    border: 0;
    border-radius: 3px;
    background: none;
    color: var(--sp-text-tertiary);
    cursor: pointer;
    opacity: 0;
  }
  tr:hover .open,
  .rh:focus .open {
    opacity: 1;
  }
  .open:hover {
    background: var(--sp-bg-muted);
    color: var(--sp-text-primary);
  }
  .corner-btn {
    all: unset;
    cursor: pointer;
    padding: 0 4px;
    border-radius: 3px;
  }
  .corner-btn:focus-visible {
    outline: 2px solid var(--sp-focus);
  }
  .th-in {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .th-btn {
    all: unset;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1px;
    overflow: hidden;
    cursor: pointer;
  }
  .th-line {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  .th-btn:focus-visible {
    outline: 2px solid var(--sp-focus);
    outline-offset: 1px;
  }
  .th-name {
    color: var(--sp-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Full type under the name (comfortable density; compact: only in the tooltip). */
  .th-type {
    font-family: var(--sp-font-mono);
    font-weight: 400;
    font-size: 11px;
    line-height: 1.2;
    color: var(--sp-text-tertiary);
    white-space: nowrap;
  }
  .th-menu {
    flex: none;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: var(--sp-radius);
    background: none;
    color: var(--sp-text-secondary);
    cursor: pointer;
    opacity: 0;
  }
  th:hover .th-menu,
  .th-menu:focus-visible,
  .th-menu[aria-expanded='true'] {
    opacity: 1;
  }
  .th-menu:hover {
    background: var(--sp-bg-muted);
    color: var(--sp-text-primary);
  }
  .th-menu:focus-visible {
    outline: 2px solid var(--sp-focus);
    outline-offset: 1px;
  }
  .hidden-cols {
    padding: 0 6px;
    border: 1px solid var(--sp-border);
    border-radius: 999px;
    background: var(--sp-bg);
    color: var(--sp-text-secondary);
    font-size: 11.5px;
    cursor: pointer;
  }
  .hidden-cols:hover {
    color: var(--sp-text-primary);
    border-color: var(--sp-border-hover);
  }
  /* Follow the relation: end of the cell, centred, 24 px target, shown on hover / focus. */
  .fk {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    margin-right: -6px;
    padding: 0;
    border: 0;
    border-radius: var(--sp-radius);
    background: none;
    color: var(--sp-text-tertiary);
    cursor: pointer;
    opacity: 0;
  }
  td:hover .fk,
  td:focus .fk,
  .fk:focus-visible {
    opacity: 1;
  }
  .fk.inferred {
    color: var(--sp-text-tertiary);
  }
  .fk:hover {
    background: var(--sp-bg-muted);
    color: var(--sp-text-primary);
  }
  .th-link {
    font-weight: 400;
    font-size: 11px;
    color: var(--sp-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pk {
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--sp-warning);
  }
  .sort {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: none;
    color: var(--sp-text-tertiary);
    font-size: 11px;
    cursor: pointer;
    opacity: 0;
  }
  th:hover .sort,
  .sort:focus-visible,
  .sort.on {
    opacity: 1;
  }
  .sort.on {
    color: var(--sp-text-primary);
  }
  .sort:hover {
    background: var(--sp-bg-muted);
  }
  .resize {
    position: absolute;
    top: 0;
    right: -3px;
    width: 7px;
    height: 100%;
    cursor: col-resize;
    z-index: 4;
    touch-action: none;
  }
  .resize:hover,
  .resize:focus-visible {
    background: var(--sp-border-hover);
    outline: none;
  }
  .f {
    width: 100%;
    height: 24px;
    border: 1px solid var(--sp-border);
    background: var(--sp-bg);
    border-radius: 4px;
    padding: 0 6px;
    font-size: 12px;
    font-weight: 400;
    color: var(--sp-text-primary);
    user-select: text;
  }
  .f::placeholder {
    color: var(--sp-text-tertiary);
  }
  .f:focus {
    outline: none;
    border-color: var(--sp-focus);
  }
  .th-keys {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex: none;
  }
  .th-key {
    display: inline-flex;
    align-items: center;
    padding: 1px 3px;
    border: 0;
    border-radius: var(--sp-radius);
    background: none;
    cursor: pointer;
  }
  .th-key:hover {
    background: var(--sp-bg-muted);
  }
  .th-key:focus-visible {
    outline: 2px solid var(--sp-focus);
    outline-offset: 1px;
  }
  td.editing.picking {
    overflow: visible;
    z-index: 5;
  }
  .broken {
    color: var(--sp-warning);
  }
  td.editing {
    padding: 0;
    position: relative;
    overflow: visible;
  }
  .cell-input {
    width: 100%;
    height: var(--rh);
    min-width: 160px;
    border: 2px solid var(--sp-focus);
    padding: 0 8px;
    font-family: var(--sp-font-mono);
    font-size: 12.5px;
    background: var(--sp-bg);
    user-select: text;
  }
  .cell-input:focus {
    outline: none;
  }
  .null-btn {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    border: 1px solid var(--sp-border);
    background: var(--sp-bg-subtle);
    border-radius: 4px;
    font-size: 10px;
    padding: 1px 5px;
    cursor: pointer;
  }
  .spacer td {
    padding: 0;
    border: 0;
  }
  .empty {
    padding: 32px 16px;
    color: var(--sp-text-tertiary);
    text-align: center;
  }
  /* Status bar (Excel style); spider-ui has none yet. */
  .status {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 26px;
    padding: 0 12px;
    border-top: 1px solid var(--sp-border);
    background: var(--sp-bg-subtle);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--sp-text-primary);
    white-space: nowrap;
    overflow: hidden;
  }
  .status .k {
    color: var(--sp-text-secondary);
  }
  .status .spacer {
    flex: 1;
  }
  .status .hint {
    color: var(--sp-text-tertiary);
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  @media (max-width: 720px) {
    .status .hint {
      display: none;
    }
  }
</style>
