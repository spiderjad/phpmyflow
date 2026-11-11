// Fuzzy matching for the table filter ("tktusr" -> glpi_tickets_users) and
// common-prefix detection ("glpi_", "wp_").

export interface FuzzyMatch {
  score: number;
  /** Indexes of matched characters in the text, for highlighting. */
  positions: number[];
}

const isBoundary = (text: string, i: number) => i === 0 || text[i - 1] === '_' || text[i - 1] === '-' || text[i - 1] === '.';

/**
 * Returns null when `query` is not a subsequence of `text` (case-insensitive).
 * Higher scores are better: a plain substring beats a scattered match, and
 * matches at word starts or in a row score higher.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { score: 0, positions: [] };
  const lower = text.toLowerCase();

  const sub = lower.indexOf(q);
  if (sub !== -1) {
    const positions = Array.from({ length: q.length }, (_, k) => sub + k);
    // Substrings win; earlier and at a word start is better; shorter names first.
    return { score: 1000 - sub * 2 + (isBoundary(lower, sub) ? 50 : 0) - lower.length * 0.1, positions };
  }

  const positions: number[] = [];
  let score = 0;
  let prev = -2;
  let from = 0;
  for (const ch of q) {
    // Prefer the next word start that has this char, else the next occurrence.
    let at = -1;
    for (let i = from; i < lower.length; i++) {
      if (lower[i] === ch && isBoundary(lower, i)) {
        at = i;
        break;
      }
    }
    const plain = lower.indexOf(ch, from);
    if (plain === -1) return null;
    if (at === -1 || (plain === prev + 1 && plain < at)) at = plain;
    score += at === prev + 1 ? 8 : 1;
    if (isBoundary(lower, at)) score += 6;
    positions.push(at);
    prev = at;
    from = at + 1;
  }
  return { score: score - lower.length * 0.1, positions };
}

/** Filter and rank names by fuzzy score (stable for equal scores). */
export function fuzzyFilter<T>(items: T[], query: string, key: (item: T) => string): { item: T; match: FuzzyMatch }[] {
  const out: { item: T; match: FuzzyMatch; i: number }[] = [];
  items.forEach((item, i) => {
    const match = fuzzyMatch(query, key(item));
    if (match) out.push({ item, match, i });
  });
  if (query.trim()) out.sort((a, b) => b.match.score - a.match.score || a.i - b.i);
  return out.map(({ item, match }) => ({ item, match }));
}

/**
 * Prefix shared by most tables, ending in "_" (e.g. "glpi_", "wp_").
 * Needs at least 3 tables and 60% of them; returns '' otherwise.
 */
export function commonPrefix(names: string[], minShare = 0.6): string {
  if (names.length < 3) return '';
  const counts = new Map<string, number>();
  for (const name of names) {
    const cut = name.indexOf('_');
    if (cut > 0 && cut < name.length - 1) {
      const p = name.slice(0, cut + 1);
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  let best = '';
  let bestCount = 0;
  for (const [p, c] of counts) {
    if (c > bestCount) {
      best = p;
      bestCount = c;
    }
  }
  return bestCount >= 3 && bestCount / names.length >= minShare ? best : '';
}
