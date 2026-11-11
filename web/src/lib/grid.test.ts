import { describe, expect, it } from 'vitest';
import { formatDate, formatDateFull, isBoolColumn, isHashColumn, isHashLike, isMonoColumn, jsonSummary, specialCell } from './grid';

describe('dates by language', () => {
  it('compact, 24 h, no seconds', () => {
    expect(formatDate('2025-05-24 22:43:10', 'datetime', 'es')).toBe('24 may 2025 22:43');
    expect(formatDate('2025-05-24 22:43:10', 'datetime', 'en')).toBe('May 24, 2025 22:43');
    expect(formatDate('2025-05-24 09:05:00', 'datetime', 'fr')).toMatch(/^24 mai 2025 09:05$/);
    expect(formatDate('2025-05-24 09:05:00', 'datetime', 'it')).toMatch(/^24 mag 2025 09:05$/);
    expect(formatDate('2025-05-24', 'date', 'es')).toBe('24 may 2025');
    expect(formatDate('2025-05-24', 'date', 'en')).toBe('May 24, 2025');
  });
  it('zero dates and garbage stay as they are', () => {
    expect(formatDate('0000-00-00 00:00:00', 'datetime', 'es')).toBe('0000-00-00 00:00:00');
    expect(formatDate('ayer', 'date', 'es')).toBe('ayer');
  });
  it('tooltip: full date with seconds, zone and the raw value', () => {
    const s = formatDateFull('2025-05-24 22:43:10', 'datetime', 'en', 'UTC');
    expect(s).toContain('22:43:10');
    expect(s).toContain('(UTC)');
    expect(s).toContain('Saturday');
    expect(s.endsWith('\n2025-05-24 22:43:10')).toBe(true);
  });
});

describe('empty vs NULL and special cells', () => {
  it('NULL, empty text, binary and normal values are told apart', () => {
    expect(specialCell(null)).toBe('null');
    expect(specialCell('')).toBe('empty');
    expect(specialCell({ $binary: 12 })).toBe('binary');
    expect(specialCell('0')).toBe(null);
    expect(specialCell(' ')).toBe(null);
  });
  it('TINYINT(1) is a boolean column, TINYINT(4) is not', () => {
    expect(isBoolColumn({ name: 'is_active', type: 'tinyint', fullType: 'tinyint(1)' })).toBe(true);
    expect(isBoolColumn({ name: 'level', type: 'tinyint', fullType: 'tinyint(4) unsigned' })).toBe(false);
    expect(isBoolColumn({ name: 'x', type: 'tiny' })).toBe(false);
  });
  it('JSON objects and arrays summarise; other text does not', () => {
    expect(jsonSummary('{"a":1,"b":[1,2],"c":null}')).toMatchObject({ kind: 'object', size: 3 });
    expect(jsonSummary('[1,2,3,4,5]')).toMatchObject({ kind: 'array', size: 5 });
    expect(jsonSummary('{not json')).toBe(null);
    expect(jsonSummary('hello')).toBe(null);
  });
});

describe('monospace: numbers, ids, dates and hashes', () => {
  it('by column type and name', () => {
    expect(isMonoColumn({ name: 'total', type: 'decimal' })).toBe(true);
    expect(isMonoColumn({ name: 'created_at', type: 'datetime' })).toBe(true);
    expect(isMonoColumn({ name: 'user_id', type: 'varchar' })).toBe(true);
    expect(isMonoColumn({ name: 'name', type: 'varchar' })).toBe(false);
  });
  it('hash-like content', () => {
    expect(isHashLike('$2y$10$abcdefghijklmnopqrstuuJ4H7u8Z7mvx0hNnTq0LZ1y2x3c4d5e6')).toBe(true);
    expect(isHashLike('5d41402abc4b2a76b9719d911017c592')).toBe(true);
    expect(isHashLike('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isHashLike('Lucía Fernández')).toBe(false);
    expect(isHashLike('hello-world-this-is-a-slug')).toBe(false);
    expect(isHashColumn([['5d41402abc4b2a76b9719d911017c592'], [null], ['7d793037a0760186574b0282f2f435e7']], 0)).toBe(true);
    expect(isHashColumn([['5d41402abc4b2a76b9719d911017c592'], ['plain text']], 0)).toBe(false);
  });
});
