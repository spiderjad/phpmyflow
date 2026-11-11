import { describe, expect, it } from 'vitest';
import { addRun, groupByDay, historyKey, loadHistory, MAX_ENTRIES, prune, saveHistory, searchHistory, type HistoryEntry } from '../history';

const at = (s: string) => new Date(s).getTime();
const run = (sql: string, when: string, extra: Partial<HistoryEntry> = {}) => ({ sql, db: 'shop', at: at(when), ok: true, ...extra });

function memoryStorage(init: Record<string, string> = {}) {
  const data = { ...init };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => void (data[k] = v),
    removeItem: (k: string) => void delete data[k],
  };
}

describe('addRun', () => {
  it('adds newest first', () => {
    let list = addRun([], run('SELECT 1', '2026-11-10T09:00'));
    list = addRun(list, run('SELECT 2', '2026-11-10T09:05'));
    expect(list.map((e) => e.sql)).toEqual(['SELECT 2', 'SELECT 1']);
  });

  it('merges the same statement run back to back', () => {
    let list = addRun([], run('SELECT 1', '2026-11-10T09:00'));
    list = addRun(list, run('SELECT 1 ', '2026-11-10T09:10', { ms: 4 }));
    expect(list).toHaveLength(1);
    expect(list[0].count).toBe(2);
    expect(list[0].at).toBe(at('2026-11-10T09:10'));
  });

  it('keeps separate entries for the same SQL on another database', () => {
    let list = addRun([], run('SELECT 1', '2026-11-10T09:00'));
    list = addRun(list, { ...run('SELECT 1', '2026-11-10T09:01'), db: 'glpi' });
    expect(list).toHaveLength(2);
  });

  it('records failures with their error code', () => {
    const list = addRun([], run('SELEC 1', '2026-11-10T09:00', { ok: false, error: 'mysql.1064' }));
    expect(list[0]).toMatchObject({ ok: false, error: 'mysql.1064' });
  });

  it('ignores empty SQL', () => {
    expect(addRun([], run('   ', '2026-11-10T09:00'))).toEqual([]);
  });
});

describe('prune', () => {
  it('drops entries older than 90 days but keeps undated ones', () => {
    const list = [
      { ...run('new', '2026-11-01'), id: 'a', count: 1 },
      { ...run('old', '2026-07-01'), id: 'b', count: 1 },
      { ...run('undated', '2026-01-01'), at: 0, id: 'c', count: 1 },
    ];
    expect(prune(list, at('2026-11-10')).map((e) => e.sql)).toEqual(['new', 'undated']);
  });

  it('caps the list size', () => {
    const list = Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => ({ ...run(`SELECT ${i}`, '2026-11-10'), id: String(i), count: 1 }));
    expect(prune(list, at('2026-11-10'))).toHaveLength(MAX_ENTRIES);
  });
});

describe('groupByDay', () => {
  it('groups into today, yesterday, dates and older', () => {
    const now = at('2026-11-10T12:00');
    const list = [
      { ...run('a', '2026-11-10T08:00'), id: '1', count: 1 },
      { ...run('b', '2026-11-09T23:59'), id: '2', count: 1 },
      { ...run('c', '2026-11-02T10:00'), id: '3', count: 1 },
      { ...run('d', '2026-11-10T11:00'), id: '4', count: 1 },
      { ...run('e', '2026-01-01'), at: 0, id: '5', count: 1 },
    ];
    const groups = groupByDay(list, now);
    expect(groups.map((g) => [g.kind, g.entries.map((e) => e.sql).join('')])).toEqual([
      ['today', 'da'],
      ['yesterday', 'b'],
      ['date', 'c'],
      ['older', 'e'],
    ]);
    expect(groups[2].key).toBe('2026-11-02');
  });
});

describe('searchHistory', () => {
  it('matches SQL text and database, case-insensitive', () => {
    const list = [
      { ...run('SELECT * FROM glpi_tickets', '2026-11-10'), id: '1', count: 1 },
      { ...run('SELECT 1', '2026-11-10'), db: 'glpi', id: '2', count: 1 },
      { ...run('SELECT 2', '2026-11-10'), id: '3', count: 1 },
    ];
    expect(searchHistory(list, 'GLPI').map((e) => e.id)).toEqual(['1', '2']);
    expect(searchHistory(list, '')).toHaveLength(3);
  });
});

describe('storage', () => {
  it('keys history by user, host and port', () => {
    expect(historyKey({ user: 'glpi', host: '192.168.1.50', port: 3306 })).toBe('pmf_history:glpi@192.168.1.50:3306');
    expect(historyKey(null)).toBe('');
  });

  it('round-trips through storage', () => {
    const s = memoryStorage();
    const list = addRun([], run('SELECT 1', '2026-11-10T09:00'));
    saveHistory(s, 'k', list);
    expect(loadHistory(s, 'k')).toEqual(list);
  });

  it('migrates the old undated list once', () => {
    const s = memoryStorage({ pmf_history: JSON.stringify(['SELECT 1', 'SELECT 2']) });
    const list = loadHistory(s, 'k');
    expect(list.map((e) => [e.sql, e.at])).toEqual([
      ['SELECT 1', 0],
      ['SELECT 2', 0],
    ]);
    expect(s.getItem('pmf_history')).toBeNull();
    expect(JSON.parse(s.getItem('k')!)).toHaveLength(2);
  });

  it('survives corrupt data', () => {
    expect(loadHistory(memoryStorage({ k: '{nope' }), 'k')).toEqual([]);
  });
});
