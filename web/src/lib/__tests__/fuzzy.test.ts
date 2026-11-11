import { describe, expect, it } from 'vitest';
import { commonPrefix, fuzzyFilter, fuzzyMatch } from '../fuzzy';

const glpi = ['glpi_tickets', 'glpi_tickets_users', 'glpi_ticketrecurrents', 'glpi_users', 'glpi_itilfollowups', 'glpi_computers'];

describe('fuzzyMatch', () => {
  it('matches a scattered subsequence', () => {
    expect(fuzzyMatch('tktusr', 'glpi_tickets_users')).not.toBeNull();
  });

  it('returns null when characters are missing or out of order', () => {
    expect(fuzzyMatch('xyz', 'glpi_tickets')).toBeNull();
    expect(fuzzyMatch('sut', 'users')).toBeNull();
  });

  it('is case-insensitive and ignores spaces', () => {
    expect(fuzzyMatch('TICK users', 'glpi_tickets_users')).not.toBeNull();
  });

  it('ranks a substring above a scattered match', () => {
    const sub = fuzzyMatch('users', 'glpi_users')!;
    const scattered = fuzzyMatch('users', 'glpi_ticketrecurrents')!;
    expect(sub.score).toBeGreaterThan(scattered?.score ?? -Infinity);
  });

  it('returns positions of the matched characters', () => {
    const m = fuzzyMatch('usr', 'users')!;
    expect(m.positions.map((i) => 'users'[i]).join('')).toBe('usr');
  });

  it('prefers word starts for scattered matches', () => {
    const m = fuzzyMatch('tu', 'glpi_tickets_users')!;
    expect(m.positions).toEqual([5, 13]);
  });

  it('empty query matches everything', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] });
  });
});

describe('fuzzyFilter', () => {
  it('puts the best match first', () => {
    const out = fuzzyFilter(glpi, 'tktusr', (x) => x).map((m) => m.item);
    expect(out[0]).toBe('glpi_tickets_users');
  });

  it('keeps the original order when the query is empty', () => {
    expect(fuzzyFilter(glpi, '', (x) => x).map((m) => m.item)).toEqual(glpi);
  });

  it('drops non-matching items', () => {
    expect(fuzzyFilter(glpi, 'comp', (x) => x).map((m) => m.item)).toEqual(['glpi_computers']);
  });
});

describe('commonPrefix', () => {
  it('detects glpi_', () => {
    expect(commonPrefix(glpi)).toBe('glpi_');
  });

  it('detects wp_ even with a few other tables', () => {
    expect(commonPrefix(['wp_posts', 'wp_users', 'wp_options', 'wp_terms', 'migrations'])).toBe('wp_');
  });

  it('returns empty when no prefix dominates', () => {
    expect(commonPrefix(['customers', 'orders', 'order_items', 'products'])).toBe('');
  });

  it('needs at least three tables', () => {
    expect(commonPrefix(['a_x', 'a_y'])).toBe('');
  });
});
