import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoTitle, MAX_TABS, TabStore, tabsKey } from '../tabs.svelte';

function memoryStorage() {
  const data: Record<string, string> = {};
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
}

describe('autoTitle', () => {
  it.each([
    ['SELECT * FROM glpi_tickets WHERE id = 1', 'SELECT glpi_tickets'],
    ['select id from `orders` o join customers c on c.id = o.customer_id', 'SELECT orders'],
    ['UPDATE orders SET status = 1', 'UPDATE orders'],
    ['DELETE FROM glpi_logs WHERE id < 10', 'DELETE glpi_logs'],
    ['INSERT INTO customers (name) VALUES ("x")', 'INSERT customers'],
    ['CREATE TABLE IF NOT EXISTS t1 (id int)', 'CREATE t1'],
    ['ALTER TABLE shop.orders ADD x int', 'ALTER shop.orders'],
    ['WITH recent AS (SELECT * FROM orders) SELECT * FROM recent', 'SELECT recent'],
    ["SELECT 'from users' AS x FROM products", 'SELECT products'],
    ['-- FROM nowhere\nSELECT * FROM real_table', 'SELECT real_table'],
    ['SHOW TABLES', 'SHOW TABLES'],
    ['SELECT NOW()', 'SELECT NOW()'],
    ['   ', ''],
  ])('%s -> %s', (sql, title) => {
    expect(autoTitle(sql)).toBe(title);
  });
});

describe('TabStore', () => {
  let store: TabStore;
  beforeEach(() => {
    store = new TabStore(null);
  });

  it('starts with one empty tab', () => {
    expect(store.list).toHaveLength(1);
    expect(store.active.sql).toBe('');
  });

  it('creates tabs after the active one and activates them', () => {
    const a = store.active;
    const b = store.create({ sql: 'SELECT 1' })!;
    store.activate(a.id);
    const c = store.create()!;
    expect(store.list.map((t) => t.id)).toEqual([a.id, c.id, b.id]);
    expect(store.activeId).toBe(c.id);
    expect(c.n).toBe(3);
  });

  it('inherits the active database', () => {
    store.active.db = 'glpi';
    expect(store.create()!.db).toBe('glpi');
  });

  it('respects the tab limit', () => {
    for (let i = 1; i < MAX_TABS; i++) store.create();
    expect(store.list).toHaveLength(MAX_TABS);
    expect(store.create()).toBeNull();
    expect(store.canCreate).toBe(false);
  });

  it('closing activates the neighbour', () => {
    const a = store.active;
    const b = store.create()!;
    const c = store.create()!;
    store.activate(b.id);
    store.close(b.id);
    expect(store.list.map((t) => t.id)).toEqual([a.id, c.id]);
    expect(store.activeId).toBe(c.id);
  });

  it('closing the last tab leaves an empty one', () => {
    store.active.sql = 'SELECT 1';
    store.close(store.active.id);
    expect(store.list).toHaveLength(1);
    expect(store.active.sql).toBe('');
  });

  it('undo reopens a closed tab at its position', () => {
    const a = store.active;
    const b = store.create({ sql: 'SELECT 2' })!;
    store.create({ sql: 'SELECT 3' });
    expect(store.close(b.id)).toBe(true);
    const back = store.undoClose()!;
    expect(back.sql).toBe('SELECT 2');
    expect(store.list[1].id).toBe(b.id);
    expect(store.activeId).toBe(b.id);
    expect(store.list[0].id).toBe(a.id);
  });

  it('empty tabs are not undoable', () => {
    const b = store.create()!;
    expect(store.close(b.id)).toBe(false);
    expect(store.undoClose()).toBeNull();
  });

  it('undo of the only tab replaces the placeholder empty tab', () => {
    store.active.sql = 'SELECT 1';
    const id = store.active.id;
    store.close(id);
    store.undoClose();
    expect(store.list.map((t) => t.id)).toEqual([id]);
  });

  it('undo keeps an empty tab the user created', () => {
    store.active.sql = 'SELECT 1';
    const a = store.active;
    const b = store.create()!;
    store.close(a.id);
    store.undoClose();
    expect(store.list.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it('close others and close to the right', () => {
    const a = store.active;
    const b = store.create({ sql: 'b' })!;
    const c = store.create({ sql: 'c' })!;
    const d = store.create({ sql: 'd' })!;
    store.closeRight(b.id);
    expect(store.list.map((t) => t.id)).toEqual([a.id, b.id]);
    store.closeOthers(b.id);
    expect(store.list.map((t) => t.id)).toEqual([b.id]);
    expect(store.closed.map((x) => x.tab.id)).toEqual([c.id, d.id]);
  });

  it('duplicates with SQL, database and manual title', () => {
    store.active.sql = 'SELECT 1';
    store.active.db = 'shop';
    store.rename(store.active.id, 'Mine');
    const copy = store.duplicate(store.active.id)!;
    expect(copy).toMatchObject({ sql: 'SELECT 1', db: 'shop', title: 'Mine' });
    expect(store.list).toHaveLength(2);
  });

  it('reorders by index and by step', () => {
    const a = store.active;
    const b = store.create()!;
    const c = store.create()!;
    store.moveTo(c.id, 0);
    expect(store.list.map((t) => t.id)).toEqual([c.id, a.id, b.id]);
    store.move(c.id, 1);
    expect(store.list.map((t) => t.id)).toEqual([a.id, c.id, b.id]);
    store.move(a.id, -1); // already first: no-op
    expect(store.list[0].id).toBe(a.id);
  });

  it('cycles with step()', () => {
    const a = store.active;
    const b = store.create()!;
    store.step(1);
    expect(store.activeId).toBe(a.id);
    store.step(-1);
    expect(store.activeId).toBe(b.id);
  });

  it('auto title until renamed; empty manual title goes back to auto', () => {
    const tab = store.active;
    tab.sql = 'UPDATE orders SET x = 1';
    expect(store.titleOf(tab)).toBe('UPDATE orders');
    store.rename(tab.id, 'Fix orders');
    tab.sql = 'SELECT * FROM customers';
    expect(store.titleOf(tab)).toBe('Fix orders');
    store.rename(tab.id, '  ');
    expect(store.titleOf(tab)).toBe('SELECT customers');
  });

  it('dirty when SQL changed since the last run', () => {
    const tab = store.active;
    expect(store.isDirty(tab)).toBe(false);
    tab.sql = 'SELECT 1';
    expect(store.isDirty(tab)).toBe(true);
    tab.lastRunSql = 'SELECT 1';
    expect(store.isDirty(tab)).toBe(false);
  });
});

describe('persistence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keys by user, host and port', () => {
    expect(tabsKey({ user: 'glpi', host: '192.168.1.50', port: 3306 })).toBe('pmf_tabs:glpi@192.168.1.50:3306');
  });

  it('saves with a 500 ms debounce and restores without results', () => {
    const storage = memoryStorage();
    const store = new TabStore(storage);
    store.load('k');
    store.active.sql = 'SELECT 1';
    store.active.db = 'shop';
    store.active.result = { type: 'affected', verb: 'UPDATE', affected: 1, timeMs: 1 };
    store.create({ sql: 'SELECT 2', db: 'glpi' });
    store.rename(store.active.id, 'Second');
    expect(storage.data.k).toBeUndefined();
    vi.advanceTimersByTime(499);
    expect(storage.data.k).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(storage.data.k).toBeDefined();
    expect(storage.data.k).not.toContain('affected');

    const restored = new TabStore(storage);
    restored.load('k');
    expect(restored.list.map((t) => [t.sql, t.db, t.title])).toEqual([
      ['SELECT 1', 'shop', ''],
      ['SELECT 2', 'glpi', 'Second'],
    ]);
    expect(restored.active.title).toBe('Second');
    expect(restored.list[0].result).toBeNull();
    // New tabs keep numbering after the restored ones.
    expect(restored.create()!.n).toBe(3);
  });

  it('keeps users apart', () => {
    const storage = memoryStorage();
    const store = new TabStore(storage);
    store.load('pmf_tabs:a@h:1');
    store.active.sql = 'SELECT a';
    store.load('pmf_tabs:b@h:1'); // flushes a, starts fresh for b
    expect(store.active.sql).toBe('');
    store.load('pmf_tabs:a@h:1');
    expect(store.active.sql).toBe('SELECT a');
  });

  it('ignores corrupt storage', () => {
    const storage = memoryStorage();
    storage.data.k = '{broken';
    const store = new TabStore(storage);
    store.load('k');
    expect(store.list).toHaveLength(1);
  });
});
