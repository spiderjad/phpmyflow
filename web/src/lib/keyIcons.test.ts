import { beforeAll, describe, expect, it } from 'vitest';
import type { KeyInfo } from './keyIcons';

// i18n reads the browser language when it loads: minimal globals first.
const g = globalThis as Record<string, unknown>;
g.document ??= { documentElement: { lang: '' } };
g.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: { languages: ['en'], language: 'en' }, configurable: true });
let columnKeys: typeof import('./keyIcons').columnKeys;
let groupKeys: typeof import('./keyIcons').groupKeys;
beforeAll(async () => {
  ({ columnKeys, groupKeys } = await import('./keyIcons'));
});

const info: KeyInfo = {
  indexes: [
    { name: 'PRIMARY', kind: 'PRIMARY', columns: ['id'] },
    { name: 'uq_tenant_email', kind: 'UNIQUE', columns: ['tenant_id', 'email(100)'] },
    { name: 'idx_email', kind: 'INDEX', columns: ['email'] },
    { name: 'ft_bio', kind: 'FULLTEXT', columns: ['bio'] },
  ],
  foreignKeys: [{ name: 'fk_tenant', columns: ['tenant_id'], refTable: 'tenants', refColumns: ['id'] }],
};

describe('key icons per column', () => {
  it('primary key', () => {
    const k = columnKeys('id', info);
    expect(k.map((x) => [x.kind, x.text])).toEqual([['pk', 'PK']]);
    expect(k[0].target).toEqual({ type: 'index', name: 'PRIMARY' });
  });
  it('several at once, PK/U/I first and the position in composite keys', () => {
    expect(columnKeys('email', info).map((x) => x.text)).toEqual(['U 2/2', 'I']);
    const tenant = columnKeys('tenant_id', info);
    expect(tenant.map((x) => [x.kind, x.text])).toEqual([['uni', 'U 1/2'], ['fk', 'tenants']]);
    expect(tenant[0].tip).toContain('uq_tenant_email');
    expect(tenant[0].tip).toContain('1');
    expect(tenant[1].tip).toContain('tenants.id');
    expect(tenant[1].tip).toContain('fk_tenant');
    expect(columnKeys('bio', info).map((x) => x.text)).toEqual(['FT']);
  });
  it('inferred relations only where no declared FK exists', () => {
    expect(columnKeys('id_planta', info, [{ column: 'id_planta', table: 'plantas', toColumn: 'id' }]).map((x) => [x.kind, x.text])).toEqual([['inferred', 'plantas']]);
    expect(columnKeys('tenant_id', info, [{ column: 'tenant_id', table: 'tenants', toColumn: 'id' }]).filter((x) => x.kind === 'inferred')).toEqual([]);
    expect(columnKeys('name', info)).toEqual([]);
    expect(columnKeys('id', null)).toEqual([]);
  });
});

describe('header badges: one per category', () => {
  it('several indexes become "I ×3", with every name in the tooltip', () => {
    const many: KeyInfo = {
      indexes: [
        { name: 'PRIMARY', kind: 'PRIMARY', columns: ['id', 'email'] },
        { name: 'uq_email', kind: 'UNIQUE', columns: ['email'] },
        { name: 'idx_a', kind: 'INDEX', columns: ['email', 'name'] },
        { name: 'idx_b', kind: 'INDEX', columns: ['email'] },
        { name: 'ft_email', kind: 'FULLTEXT', columns: ['email'] },
      ],
      foreignKeys: [],
    };
    const g = groupKeys(columnKeys('email', many));
    expect(g.map((x) => x.text)).toEqual(['PK 2/2', 'U', 'I ×3']);
    const i = g[2];
    expect(i.tip.split('\n')).toHaveLength(3);
    expect(i.tip).toContain('idx_a');
    expect(i.tip).toContain('ft_email');
    expect(i.target).toEqual({ type: 'index', name: 'idx_a' });
  });
  it('a single key in each category stays as it is', () => {
    expect(groupKeys(columnKeys('tenant_id', info)).map((x) => x.text)).toEqual(['U 1/2', 'tenants']);
  });
});
