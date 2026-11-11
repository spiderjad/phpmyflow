// Sensitive columns (passwords, hashes, tokens, keys): shown hidden in the
// grid and the row detail until revealed. Detected by the column name (a
// list of patterns the user can edit in Settings › Data and grid) and by the
// content (bcrypt / argon2 hashes). Only text columns: a `token_expires_at`
// date is not a secret. Copy and export keep the real value.

export const DEFAULT_SENSITIVE = ['password', 'passwd', 'pass', 'hash', 'secret', 'token', 'api_key', 'apikey', 'salt', 'private_key', 'remember_token'];

/** Words of a column name: snake_case, kebab-case and camelCase. */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Does the name match a pattern? A pattern with "_" (api_key) matches inside
 * the name; a single word (pass) must be one of the name's words, so
 * "passenger" or "compass" are not sensitive but "user_pass" is.
 */
export function isSensitiveName(name: string, patterns: string[] = DEFAULT_SENSITIVE): boolean {
  const low = name.toLowerCase();
  const w = words(name);
  for (const raw of patterns) {
    const p = raw.trim().toLowerCase();
    if (!p) continue;
    if (low === p) return true;
    if (/[^a-z0-9]/.test(p)) {
      if (low.includes(p)) return true;
    } else if (w.includes(p)) return true;
  }
  return false;
}

/** A password hash by its format: bcrypt ($2y$ / $2a$ / $2b$ / $2x$) or argon2. */
export function isSensitiveValue(s: string): boolean {
  return /^\$2[abxy]\$\d{2}\$/.test(s) || /^\$argon2(id|i|d)\$/.test(s);
}

/** A text column to hide: by name, or because its sampled values are password hashes. */
export function isSensitiveColumn(name: string, kind: string, values: unknown[], patterns: string[] = DEFAULT_SENSITIVE): boolean {
  if (kind !== 'text') return false;
  if (isSensitiveName(name, patterns)) return true;
  let seen = 0;
  for (const v of values) {
    if (typeof v !== 'string' || v === '') continue;
    if (isSensitiveValue(v)) return true;
    if (++seen >= 20) break;
  }
  return false;
}

export const MASK = '••••••••';
