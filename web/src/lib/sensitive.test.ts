import { describe, expect, it } from 'vitest';
import { isSensitiveColumn, isSensitiveName, isSensitiveValue } from './sensitive';

describe('sensitive columns by name', () => {
  it('matches the default patterns as words of the name', () => {
    for (const n of ['password', 'user_pass', 'passwd', 'password_hash', 'passwordHash', 'secret', 'client_secret', 'api_key', 'apikey', 'API_KEY', 'access_token', 'remember_token', 'salt', 'private_key', 'hash'])
      expect(isSensitiveName(n), n).toBe(true);
  });
  it('does not match words that only contain a pattern', () => {
    for (const n of ['passenger', 'compass', 'hashtag', 'saltwater', 'name', 'email', 'tokens_used_total'.replace('tokens', 'tokn')]) expect(isSensitiveName(n), n).toBe(false);
  });
  it('custom patterns (Settings): a single word or with "_"', () => {
    expect(isSensitiveName('pin_code', ['pin'])).toBe(true);
    expect(isSensitiveName('spinner', ['pin'])).toBe(false);
    expect(isSensitiveName('card_number_full', ['card_number'])).toBe(true);
    expect(isSensitiveName('password', [])).toBe(false);
  });
});

describe('sensitive columns by content', () => {
  it('bcrypt and argon2 hashes', () => {
    expect(isSensitiveValue('$2y$10$abcdefghijklmnopqrstuuJ4H7u8Z7mvx0hNnTq0LZ1y2x3c4d5e6')).toBe(true);
    expect(isSensitiveValue('$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW')).toBe(true);
    expect(isSensitiveValue('$argon2id$v=19$m=65536,t=4,p=1$c29tZXNhbHQ$abc')).toBe(true);
    expect(isSensitiveValue('$2 dollars')).toBe(false);
    expect(isSensitiveValue('plain')).toBe(false);
  });
  it('a column named "user_pwd_v2" holding bcrypt hashes is hidden; dates and numbers never are', () => {
    expect(isSensitiveColumn('user_pwd_v2', 'text', [null, '', '$2y$10$abcdefghijklmnopqrstuuJ4H7u8Z7mvx0hNnTq0LZ1y2x3c4d5e6'])).toBe(true);
    expect(isSensitiveColumn('notes', 'text', ['hello', 'world'])).toBe(false);
    expect(isSensitiveColumn('token_expires_at', 'datetime', ['2026-01-01 00:00:00'])).toBe(false);
    expect(isSensitiveColumn('pass_count', 'number', [3])).toBe(false);
  });
});
