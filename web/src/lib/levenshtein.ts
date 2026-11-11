// Edit distance for "did you mean" suggestions. Pure: safe to import from tests.

/** Levenshtein distance, small and good enough for identifiers. */
export function distance(a: string, b: string): number {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Closest candidate within a sensible typo distance, or null. */
export function closest(name: string, candidates: Iterable<string>): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  const limit = Math.max(2, Math.floor(name.length / 3));
  for (const c of candidates) {
    if (c.toLowerCase() === name.toLowerCase()) return c;
    const d = distance(name, c);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return bestD <= limit ? best : null;
}
