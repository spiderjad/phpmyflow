import { beforeEach, describe, expect, it } from 'vitest';
import { connectionLook, forgetRecent, MAX_RECENT, readRecent, rememberRecent, suggestEnv } from './connections';

// Tests run in Node: a minimal localStorage.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};
beforeEach(() => store.clear());

describe('suggested environment', () => {
  it('loopback and Docker look local', () => {
    for (const h of ['127.0.0.1', 'localhost', '::1', '[::1]', 'host.docker.internal', 'db', 'mariadb-1', '172.18.0.3', 'mysql.local']) expect(suggestEnv(h), h).toBe('local');
  });
  it('remote hosts look like production', () => {
    for (const h of ['db.example.com', 'mysql.hostinger.com', '203.0.113.7', '10.0.4.12', '192.168.1.50']) expect(suggestEnv(h), h).toBe('production');
  });
});

describe('recent connections', () => {
  const c = (user: string, port = 3306) => ({ host: '127.0.0.1', port, user, ssl: null, label: null });
  it('most recent first, one per user@host:port, at most 4', () => {
    rememberRecent(c('a'), 1);
    rememberRecent(c('b'), 2);
    rememberRecent(c('a'), 3);
    expect(readRecent().map((r) => r.user)).toEqual(['a', 'b']);
    for (let i = 0; i < 6; i++) rememberRecent(c(`u${i}`), 10 + i);
    expect(readRecent()).toHaveLength(MAX_RECENT);
    expect(readRecent()[0].user).toBe('u5');
  });
  it('forgets one entry and never stores a password', () => {
    rememberRecent({ ...c('root'), ...({ password: 'secret' } as object) } as ReturnType<typeof c>, 1);
    expect(store.get('pmf.login.recent')).not.toContain('secret');
    rememberRecent(c('demo'), 2);
    expect(forgetRecent(c('root')).map((r) => r.user)).toEqual(['demo']);
  });
  it('migrates the old single "Other server…" memory', () => {
    store.set('pmf.login.custom', JSON.stringify({ host: 'db.example.com', port: 3307, user: 'app', ssl: { enabled: true, verify: true, ca: '' } }));
    expect(readRecent()).toEqual([{ host: 'db.example.com', port: 3307, user: 'app', ssl: { enabled: true, verify: true, ca: '' }, label: null, at: 0 }]);
  });
});

describe('connection color and environment', () => {
  const servers = [
    { label: 'Prod', host: 'db.example.com', port: 3306, color: 'violet' as const, env: 'production' as const },
    { label: 'Dev', host: '127.0.0.1', port: 3307, color: null, env: null },
  ];
  it('config.php fixes the environment; the user only changes the color', () => {
    expect(connectionLook('db.example.com', 3306, servers, {})).toEqual({ color: 'violet', env: 'production', envFrom: 'config' });
    expect(connectionLook('db.example.com', 3306, servers, { 'db.example.com:3306': { env: 'local', color: 'teal' } })).toEqual({ color: 'teal', env: 'production', envFrom: 'config' });
  });
  it('without config, the user’s environment applies and colors the stripe by default', () => {
    expect(connectionLook('127.0.0.1', 3307, servers, {})).toEqual({ color: null, env: null, envFrom: null });
    expect(connectionLook('127.0.0.1', 3307, servers, { '127.0.0.1:3307': { env: 'production' } })).toEqual({ color: 'red', env: 'production', envFrom: 'user' });
    expect(connectionLook('other.host', 3306, servers, { 'other.host:3306': { color: 'blue' } }).color).toBe('blue');
  });
});
