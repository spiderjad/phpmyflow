import { describe, expect, it } from 'vitest';
import { autoIndexName, columnIssue, duplicateOf, formatIdxCol, keyBadges, keyBytes, parseIdxCol, redundantIndexes, suggestPrefix } from './indexes';
import type { IndexModel } from './tableDraft';

const idx = (name: string, kind: IndexModel['kind'], columns: string[], orig: string | null = name): IndexModel => ({ id: `i_${name}`, orig, name, kind, columns });

// The real `usuarios` table: PK, composite unique (tenant_id, email), index on email, FULLTEXT on bio.
const usuarios = [
  idx('PRIMARY', 'PRIMARY', ['id']),
  idx('uq_tenant_email', 'UNIQUE', ['tenant_id', 'email']),
  idx('idx_email', 'INDEX', ['email']),
  idx('idx_tenant_created', 'INDEX', ['tenant_id', 'created_at DESC']),
  idx('ft_bio', 'FULLTEXT', ['bio']),
];

describe('index column specs', () => {
  it('parses and formats prefix length and DESC', () => {
    expect(parseIdxCol('email(191) DESC')).toEqual({ name: 'email', len: 191, desc: true });
    expect(parseIdxCol('`we ird`')).toEqual({ name: 'we ird', len: null, desc: false });
    expect(formatIdxCol({ name: 'bio', len: 100, desc: false })).toBe('bio(100)');
    expect(formatIdxCol({ name: 'created_at', len: null, desc: true })).toBe('created_at DESC');
  });
});

describe('keyBadges (column "Key")', () => {
  it('shows every index of a column, PRI, UNI, INDEX, FULLTEXT order, with the position in composite ones', () => {
    // Before: email showed only "UNI" (or nothing), never its INDEX nor its place in uq_tenant_email.
    const email = keyBadges('email', usuarios);
    expect(email.map((b) => [b.kind, b.pos, b.of, b.index.name])).toEqual([
      ['UNI', 2, 2, 'uq_tenant_email'],
      ['MUL', 1, 1, 'idx_email'],
    ]);
    // A column that is only 2nd of a composite index still gets its badge.
    expect(keyBadges('created_at', usuarios).map((b) => [b.kind, b.pos, b.of])).toEqual([['MUL', 2, 2]]);
    expect(keyBadges('tenant_id', usuarios).map((b) => b.kind)).toEqual(['UNI', 'MUL']);
    expect(keyBadges('id', usuarios).map((b) => b.kind)).toEqual(['PRI']);
    expect(keyBadges('bio', usuarios).map((b) => b.kind)).toEqual(['FT']);
    expect(keyBadges('name', usuarios)).toEqual([]);
  });
});

describe('columnIssue (columns allowed per index type)', () => {
  const text = { type: 'text', length: null, nullable: true };
  const varchar = { type: 'varchar', length: 255, nullable: false };
  const geo = { type: 'point', length: null, nullable: false };
  const geoNull = { type: 'geometry', length: null, nullable: true };
  const int = { type: 'int', length: null, nullable: false };
  it('FULLTEXT: char, varchar, text only', () => {
    expect(columnIssue('FULLTEXT', varchar)).toBeNull();
    expect(columnIssue('FULLTEXT', text)).toBeNull();
    expect(columnIssue('FULLTEXT', int)).toBe('idx.why.ftText');
  });
  it('SPATIAL: geometry NOT NULL only', () => {
    expect(columnIssue('SPATIAL', geo)).toBeNull();
    expect(columnIssue('SPATIAL', geoNull)).toBe('idx.why.spNotNull');
    expect(columnIssue('SPATIAL', varchar)).toBe('idx.why.spGeo');
  });
  it('INDEX / UNIQUE / PRIMARY: TEXT and BLOB need a prefix length', () => {
    expect(columnIssue('INDEX', text)).toBe('idx.why.needsPrefix');
    expect(columnIssue('INDEX', text, 100)).toBeNull();
    expect(columnIssue('UNIQUE', varchar)).toBeNull();
    expect(columnIssue('PRIMARY', geo)).toBe('idx.why.geoKey');
  });
});

describe('names, duplicates, redundancy, key size', () => {
  it('auto names by type and columns, truncated to 64', () => {
    expect(autoIndexName('INDEX', ['tenant_id', 'email'])).toBe('idx_tenant_id_email');
    expect(autoIndexName('UNIQUE', ['email'])).toBe('uq_email');
    expect(autoIndexName('FULLTEXT', ['bio'])).toBe('ft_bio');
    expect(autoIndexName('SPATIAL', ['geo'])).toBe('sp_geo');
    expect(autoIndexName('INDEX', ['x'.repeat(80)])).toHaveLength(64);
  });
  it('same columns in the same order, or a prefix of an existing index', () => {
    expect(duplicateOf(['email'], 'INDEX', usuarios)).toEqual({ index: usuarios[2], how: 'same' });
    expect(duplicateOf(['tenant_id'], 'INDEX', usuarios)).toEqual({ index: usuarios[1], how: 'prefix' });
    expect(duplicateOf(['email', 'tenant_id'], 'INDEX', usuarios)).toBeNull();
  });
  it('redundant: a plain index that is the leading part of another one', () => {
    const list = [...usuarios, idx('idx_tenant', 'INDEX', ['tenant_id'])];
    expect(redundantIndexes(list).map((r) => [r.index.name, r.coveredBy.name])).toEqual([['idx_tenant', 'uq_tenant_email']]);
  });
  it('utf8mb4 keys over 3072 bytes suggest a 191 prefix', () => {
    const defs = { title: { type: 'varchar', length: 800, nullable: false }, code: { type: 'varchar', length: 20, nullable: false } };
    expect(keyBytes(['title', 'code'], defs, 4)).toBe(3280);
    expect(suggestPrefix(['title', 'code'], defs, 4)).toEqual({ column: 'title', len: 191 });
    expect(suggestPrefix(['code'], defs, 4)).toBeNull();
  });
});
