// SQL editor tabs: the list, the active id, undo for closed tabs, and
// persistence per user@host. Results stay in memory only; what is saved is
// title, SQL, database, cursor and editor height (never credentials).
import type { AiMode, AiResult, QueryResult } from './api';
import type { FriendlyError } from './errors';
import type { RuleDiagnostic } from './sqlRules';
import { mask } from './sqlText';

export type Done = Exclude<QueryResult, { needsConfirm: true }>;

export interface AiMemory {
  open: boolean;
  mode: AiMode;
  prompt: string;
  result: AiResult | null;
}

export interface SqlTab {
  id: string;
  /** "Query N" number, fixed at creation. */
  n: number;
  /** Manual title; empty means automatic from the SQL. */
  title: string;
  sql: string;
  db: string;
  cursor: number;
  scrollTop: number;
  editorHeight: number;
  /** SQL text at the last run: different from `sql` means unsaved changes. */
  lastRunSql: string | null;
  // --- runtime only (not persisted) ---
  running: boolean;
  result: Done | null;
  failure: FriendlyError | null;
  /** A rule that explains the server's syntax error better (1064). */
  failureRule: RuleDiagnostic | null;
  /** SQL of the run that produced `result` / `failure`. */
  resultSql: string;
  lintErrors: number;
  /** Ask SqlView to run this tab once it is shown (sidebar Ctrl+click). */
  autorun: boolean;
  ai: AiMemory;
}

export const MAX_TABS = 30;
export const UNDO_MS = 6000;
const SAVE_DELAY = 500;
const DEFAULT_HEIGHT = 260;

type Persisted = Pick<SqlTab, 'id' | 'n' | 'title' | 'sql' | 'db' | 'cursor' | 'editorHeight' | 'lastRunSql'>;

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function tabsKey(auth: { user: string; host: string; port: number } | null | undefined): string {
  return auth ? `pmf_tabs:${auth.user}@${auth.host}:${auth.port}` : '';
}

const VERB_TITLE: [RegExp, string][] = [
  [/^\s*select\b[\s\S]*?\bfrom\s+([`\w$.]+)/i, 'SELECT'],
  [/^\s*update\s+(?:low_priority\s+|ignore\s+)*([`\w$.]+)/i, 'UPDATE'],
  [/^\s*delete\s+(?:low_priority\s+|quick\s+|ignore\s+)*from\s+([`\w$.]+)/i, 'DELETE'],
  [/^\s*(?:insert|replace)\s+(?:low_priority\s+|delayed\s+|high_priority\s+|ignore\s+)*(?:into\s+)?([`\w$.]+)/i, 'INSERT'],
  [/^\s*create\s+(?:or\s+replace\s+)?(?:temporary\s+)?(?:table|view|index\s+\S+\s+on)\s+(?:if\s+not\s+exists\s+)?([`\w$.]+)/i, 'CREATE'],
  [/^\s*alter\s+table\s+([`\w$.]+)/i, 'ALTER'],
  [/^\s*drop\s+(?:table|view)\s+(?:if\s+exists\s+)?([`\w$.]+)/i, 'DROP'],
  [/^\s*truncate\s+(?:table\s+)?([`\w$.]+)/i, 'TRUNCATE'],
  [/^\s*(?:describe|desc|explain)\s+([`\w$.]+)\s*$/i, 'DESCRIBE'],
];

/**
 * "SELECT glpi_tickets", "UPDATE orders"… from the first statement.
 * Strings and comments are masked first so keywords inside them don't count.
 * Returns '' when there is nothing to name (the UI shows "Query N").
 */
export function autoTitle(sql: string): string {
  const masked = mask(sql);
  const first = masked.split(';').find((s) => s.trim()) ?? '';
  if (!first.trim()) return '';
  const start = masked.indexOf(first);
  let text = first;
  // WITH cte AS (...) SELECT ...: name the main statement.
  if (/^\s*with\b/i.test(text)) {
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      else if (depth === 0 && /^(select|update|delete|insert)\b/i.test(text.slice(i)) && /\W/.test(text[i - 1] ?? ' ')) {
        text = text.slice(i);
        break;
      }
    }
  }
  const offset = start + (first.length - text.length);
  for (const [re, verb] of VERB_TITLE) {
    const m = re.exec(text);
    if (m) {
      const nameStart = offset + m.index + m[0].length - m[1].length;
      const name = sql.slice(nameStart, nameStart + m[1].length).replace(/`/g, '');
      return `${verb} ${name}`;
    }
  }
  const words = text.trim().split(/\s+/).slice(0, 2).join(' ');
  return words.toUpperCase().slice(0, 40);
}

const newId = () => Math.random().toString(36).slice(2, 10);

function blankTab(n: number, init: Partial<SqlTab> = {}): SqlTab {
  return {
    id: newId(),
    n,
    title: '',
    sql: '',
    db: '',
    cursor: 0,
    scrollTop: 0,
    editorHeight: DEFAULT_HEIGHT,
    lastRunSql: null,
    running: false,
    result: null,
    failure: null,
    failureRule: null,
    resultSql: '',
    lintErrors: 0,
    autorun: false,
    ai: { open: false, mode: 'generate', prompt: '', result: null },
    ...init,
  };
}

export class TabStore {
  list = $state<SqlTab[]>([]);
  activeId = $state('');
  /** Recently closed tabs (newest last) with their old position, for undo. */
  closed = $state<{ tab: SqlTab; index: number; at: number }[]>([]);

  private counter = 0;
  /** Empty tab created only because the last one was closed; undo replaces it. */
  private placeholderId = '';
  private key = '';
  private storage: Storage | null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage) {
    this.storage = storage;
    this.reset();
  }

  get active(): SqlTab {
    return this.list.find((t) => t.id === this.activeId) ?? this.list[0];
  }

  get canCreate(): boolean {
    return this.list.length < MAX_TABS;
  }

  /** Title shown in the tab: manual, else automatic, else '' (caller adds "Query N"). */
  titleOf(tab: SqlTab): string {
    return tab.title || autoTitle(tab.sql);
  }

  isDirty(tab: SqlTab): boolean {
    return tab.sql.trim() !== '' && tab.sql !== tab.lastRunSql;
  }

  hasError(tab: SqlTab): boolean {
    return !!tab.failure || tab.lintErrors > 0;
  }

  private reset() {
    this.counter = 1;
    const first = blankTab(1);
    this.list = [first];
    this.activeId = first.id;
    this.closed = [];
  }

  /** New tab after the active one. Returns null at the limit. */
  create(init: Partial<Pick<SqlTab, 'sql' | 'db' | 'title' | 'autorun'>> = {}, activate = true): SqlTab | null {
    if (!this.canCreate) return null;
    const tab = blankTab(++this.counter, { db: init.db ?? this.active?.db ?? '', ...init, cursor: init.sql?.length ?? 0 });
    const at = this.list.findIndex((t) => t.id === this.activeId);
    this.list.splice(at + 1, 0, tab);
    if (activate) this.activeId = tab.id;
    this.save();
    return this.list[at + 1];
  }

  activate(id: string) {
    if (this.list.some((t) => t.id === id)) {
      this.activeId = id;
      this.save();
    }
  }

  activateIndex(i: number) {
    const tab = this.list[i];
    if (tab) this.activate(tab.id);
  }

  step(delta: number) {
    const i = this.list.findIndex((t) => t.id === this.activeId);
    this.activateIndex((i + delta + this.list.length) % this.list.length);
  }

  /**
   * Close a tab. Tabs with content go to the undo stack. Closing the last
   * tab leaves a fresh empty one. Returns whether undo is possible.
   */
  close(id: string): boolean {
    const index = this.list.findIndex((t) => t.id === id);
    if (index === -1) return false;
    const [tab] = this.list.splice(index, 1);
    const undoable = tab.sql.trim() !== '';
    if (undoable) this.closed = [...this.closed.slice(-9), { tab, index, at: Date.now() }];
    if (!this.list.length) {
      const fresh = blankTab(++this.counter, { db: tab.db });
      this.list.push(fresh);
      this.placeholderId = fresh.id;
    }
    if (this.activeId === id) this.activeId = this.list[Math.min(index, this.list.length - 1)].id;
    this.save();
    return undoable;
  }

  /** Reopen the most recently closed tab at its old position. */
  undoClose(): SqlTab | null {
    const last = this.closed[this.closed.length - 1];
    if (!last || !this.canCreate) return null;
    this.closed = this.closed.slice(0, -1);
    // The empty tab that replaced the closed one gives its place back.
    const ph = this.list.find((t) => t.id === this.placeholderId);
    if (ph && this.list.length === 1 && !ph.sql.trim()) this.list = [];
    this.placeholderId = '';
    const index = Math.min(last.index, this.list.length);
    this.list.splice(index, 0, last.tab);
    this.activeId = last.tab.id;
    this.save();
    return this.list[index];
  }

  closeOthers(id: string) {
    for (const t of [...this.list]) if (t.id !== id) this.close(t.id);
    this.activeId = id;
    this.save();
  }

  closeRight(id: string) {
    const i = this.list.findIndex((t) => t.id === id);
    for (const t of this.list.slice(i + 1)) this.close(t.id);
    if (!this.list.some((t) => t.id === this.activeId)) this.activeId = id;
    this.save();
  }

  duplicate(id: string): SqlTab | null {
    const src = this.list.find((t) => t.id === id);
    if (!src || !this.canCreate) return null;
    this.activeId = id;
    return this.create({ sql: src.sql, db: src.db, title: src.title });
  }

  rename(id: string, title: string) {
    const tab = this.list.find((t) => t.id === id);
    if (!tab) return;
    tab.title = title.trim().slice(0, 80);
    this.save();
  }

  /** Move a tab to a new index (drag and drop). */
  moveTo(id: string, to: number) {
    const from = this.list.findIndex((t) => t.id === id);
    if (from === -1) return;
    const target = Math.max(0, Math.min(this.list.length - 1, to));
    if (target === from) return;
    const [tab] = this.list.splice(from, 1);
    this.list.splice(target, 0, tab);
    this.save();
  }

  move(id: string, delta: number) {
    const from = this.list.findIndex((t) => t.id === id);
    this.moveTo(id, from + delta);
  }

  // --- persistence ---

  /** Switch to the tabs of another user@host (or a fresh set). */
  load(key: string) {
    this.flush();
    this.key = key;
    this.reset();
    if (!key || !this.storage) return;
    try {
      const raw = this.storage.getItem(key);
      if (!raw) return;
      const data = JSON.parse(raw) as { tabs: Persisted[]; activeId: string; counter: number };
      const tabs = (data.tabs ?? [])
        .filter((p) => p && typeof p.sql === 'string' && typeof p.id === 'string')
        .slice(0, MAX_TABS)
        .map((p) =>
          blankTab(Number(p.n) || 1, {
            id: p.id,
            title: String(p.title ?? ''),
            sql: p.sql,
            db: String(p.db ?? ''),
            cursor: Math.min(Number(p.cursor) || 0, p.sql.length),
            editorHeight: Number(p.editorHeight) || DEFAULT_HEIGHT,
            lastRunSql: typeof p.lastRunSql === 'string' ? p.lastRunSql : null,
          }),
        );
      if (!tabs.length) return;
      this.list = tabs;
      this.activeId = tabs.some((t) => t.id === data.activeId) ? data.activeId : tabs[0].id;
      this.counter = Math.max(Number(data.counter) || 0, ...tabs.map((t) => t.n));
    } catch {
      /* corrupt storage: start fresh */
    }
  }

  /** Debounced save (500 ms). */
  save() {
    if (!this.key || !this.storage) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY);
  }

  /** Write now (also used before switching user and on page hide). */
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.key || !this.storage) return;
    const tabs: Persisted[] = this.list.map((t) => ({
      id: t.id,
      n: t.n,
      title: t.title,
      sql: t.sql,
      db: t.db,
      cursor: t.cursor,
      editorHeight: t.editorHeight,
      lastRunSql: t.lastRunSql,
    }));
    try {
      this.storage.setItem(this.key, JSON.stringify({ tabs, activeId: this.activeId, counter: this.counter }));
    } catch {
      /* quota or blocked storage */
    }
  }
}

export const tabs = new TabStore();
