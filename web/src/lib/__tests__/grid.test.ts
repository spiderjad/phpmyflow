import { describe, expect, it } from 'vitest';
import { autoWidths, columnKind, filterKind, formatDate, isMonoColumn, toCsv, visibleRange } from '../grid';

describe('columnKind', () => {
  it.each([
    ['int', 'number'],
    ['int(10) unsigned', 'number'],
    ['decimal', 'number'],
    ['newdecimal', 'number'],
    ['longlong', 'number'],
    ['date', 'date'],
    ['datetime', 'datetime'],
    ['timestamp', 'datetime'],
    ['time', 'time'],
    ['varchar', 'text'],
    ['enum', 'text'],
    ['longblob', 'binary'],
  ])('%s -> %s', (type, kind) => {
    expect(columnKind(type)).toBe(kind);
  });
});

describe('isMonoColumn', () => {
  it('uses mono for numbers, dates, PKs and *_id columns', () => {
    expect(isMonoColumn({ name: 'total', type: 'decimal' })).toBe(true);
    expect(isMonoColumn({ name: 'created', type: 'datetime' })).toBe(true);
    expect(isMonoColumn({ name: 'code', type: 'varchar', pk: true })).toBe(true);
    expect(isMonoColumn({ name: 'users_id', type: 'varchar' })).toBe(true);
  });

  it('uses the UI font for prose', () => {
    expect(isMonoColumn({ name: 'name', type: 'varchar' })).toBe(false);
    expect(isMonoColumn({ name: 'paid', type: 'varchar' })).toBe(false);
  });
});

describe('filterKind', () => {
  it('maps types to placeholder kinds', () => {
    expect(filterKind('bigint')).toBe('number');
    expect(filterKind('timestamp')).toBe('date');
    expect(filterKind('text')).toBe('text');
  });
});

describe('formatDate', () => {
  it('formats dates per locale without a timezone shift', () => {
    expect(formatDate('2026-04-01', 'date', 'en')).toBe('Apr 1, 2026');
    expect(formatDate('2026-04-01', 'date', 'es')).toMatch(/1 abr 2026/);
  });

  it('formats datetimes with hours and minutes', () => {
    expect(formatDate('2026-04-01 11:05:00', 'datetime', 'en')).toMatch(/11:05/);
  });

  it('keeps zero dates and garbage unchanged', () => {
    expect(formatDate('0000-00-00 00:00:00', 'datetime', 'en')).toBe('0000-00-00 00:00:00');
    expect(formatDate('not a date', 'date', 'en')).toBe('not a date');
  });
});

describe('autoWidths', () => {
  const fmt = (v: unknown) => (v === null ? 'NULL' : String(v));

  it('grows with content and stays within bounds', () => {
    const [short, long] = autoWidths(
      [{ name: 'id', type: 'int' }, { name: 'notes', type: 'text' }],
      [[1, 'x'.repeat(500)]],
      fmt,
    );
    expect(short).toBeGreaterThanOrEqual(56);
    expect(long).toBe(420);
  });

  it('only looks at the first sample rows', () => {
    const rows = [...Array(60).fill(['a']), ['b'.repeat(200)]];
    const [w] = autoWidths([{ name: 'c', type: 'varchar' }], rows, fmt, 50);
    expect(w).toBeLessThan(100);
  });
});

describe('toCsv', () => {
  it('quotes commas, quotes and newlines; NULL and binary are empty', () => {
    const csv = toCsv([{ name: 'a' }, { name: 'b' }], [['x,y', 'say "hi"'], [null, { $binary: 4 }], ['line\nbreak', 1]]);
    expect(csv).toBe('a,b\r\n"x,y","say ""hi"""\r\n,\r\n"line\nbreak",1');
  });
});

describe('visibleRange', () => {
  it('returns the window plus overscan, clamped to the list', () => {
    expect(visibleRange(0, 260, 26, 1000, 5)).toEqual({ start: 0, end: 15 });
    expect(visibleRange(26 * 500, 260, 26, 1000, 5)).toEqual({ start: 495, end: 515 });
    expect(visibleRange(26 * 995, 260, 26, 1000, 5)).toEqual({ start: 990, end: 1000 });
  });
});
