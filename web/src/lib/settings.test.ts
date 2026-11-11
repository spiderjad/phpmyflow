import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Node has no DOM: a fake <html> and storage, set before the modules load.
const attrs = new Map<string, string>();
const props = new Map<string, string>();
const root = {
  lang: '',
  setAttribute: (k: string, v: string) => void attrs.set(k, v),
  getAttribute: (k: string) => attrs.get(k) ?? null,
  style: { setProperty: (k: string, v: string) => void props.set(k, v), removeProperty: (k: string) => void props.delete(k) },
};
const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.document = { documentElement: root };
Object.defineProperty(globalThis, 'navigator', { value: { languages: ['en'], language: 'en' }, configurable: true });
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

type M = typeof import('./settings.svelte');
let m: M;
beforeAll(async () => {
  m = await import('./settings.svelte');
});
beforeEach(() => {
  store.clear();
  attrs.clear();
  props.clear();
});

const user = { user: 'root', host: '127.0.0.1', port: 3307 };

describe('apply and restore', () => {
  it('applies every setting to <html> and saves it per user@host', () => {
    m.loadSettings(user, null);
    m.update('appearance', { theme: 'slate', mode: 'dark', density: 'comfortable', radius: 'round', fontSize: 16, accent: 'teal' });
    m.update('editor', { syntax: 'pastel', fontSize: 15 });
    m.update('data', { zebra: true });
    expect(Object.fromEntries(attrs)).toMatchObject({ 'data-theme': 'slate', 'data-mode': 'dark', 'data-density': 'comfortable', 'data-radius': 'round', 'data-syntax': 'pastel', 'data-zebra': 'on' });
    expect(props.get('--editor-font')).toBe('15px');
    expect(props.get('--sp-inverse')).toBe('#2dd4bf'); // teal in dark mode
    expect(Number(props.get('--pmf-zoom'))).toBeCloseTo(16 / 14);
    const saved = JSON.parse(store.get('pmf.settings.root@127.0.0.1:3307')!);
    expect(saved.appearance.theme).toBe('slate');
    // The pre-paint mirror has the accent resolved for both modes.
    expect(JSON.parse(store.get('pmf_appearance')!)).toMatchObject({ theme: 'slate', accentLight: '#0f766e', accentDark: '#2dd4bf' });
  });

  it('restores them on the next login, and another user keeps their own', () => {
    m.loadSettings(user, null);
    m.update('data', { perPage: 250, relations: 'name' });
    m.update('general', { startTab: 'sql' });
    m.loadSettings({ ...user, user: 'demo' }, null);
    expect(m.settings.data.perPage).toBe(100);
    m.loadSettings(user, null);
    expect(m.settings.data).toMatchObject({ perPage: 250, relations: 'name' });
    expect(m.settings.general.startTab).toBe('sql');
  });

  it('ignores broken or unknown stored values', () => {
    store.set('pmf.settings.root@127.0.0.1:3307', JSON.stringify({ editor: { fontSize: 99, syntax: 'neon', lint: 'yes' }, data: { perPage: 7 } }));
    m.loadSettings(user, null);
    expect(m.settings.editor).toMatchObject({ fontSize: 13, syntax: 'theme', lint: true });
    expect(m.settings.data.perPage).toBe(100);
  });

  it('sensitive patterns: cleaned on load, on by default', () => {
    store.set('pmf.settings.root@127.0.0.1:3307', JSON.stringify({ data: { sensitive: [' PIN ', 'pin', 42, '', 'card_number'], hideSensitive: 'no' } }));
    m.loadSettings(user, null);
    expect(m.settings.data.sensitive).toEqual(['pin', 'card_number']);
    expect(m.settings.data.hideSensitive).toBe(true);
  });

  it('reset section brings back the defaults of that section only', () => {
    m.loadSettings(user, null);
    m.update('editor', { wrap: false, lint: false });
    m.update('data', { zebra: true });
    m.resetSection('editor');
    expect(m.settings.editor.wrap).toBe(true);
    expect(m.settings.data.zebra).toBe(true);
  });

  it('config.php lock: appearance comes from config and cannot change', () => {
    const lockedLook = { mode: 'light' as const, theme: 'contrast' as const, accent: null, density: 'compact' as const, radius: 'sharp' as const, fontSize: 14 as const };
    m.loadSettings(user, lockedLook);
    m.update('appearance', { theme: 'forest' });
    expect(attrs.get('data-theme')).toBe('contrast');
    expect(m.settings.appearance.theme).not.toBe('forest');
  });
});

describe('export / import JSON', () => {
  it('round-trips settings, connections and language', () => {
    m.loadSettings(user, null);
    m.update('appearance', { theme: 'forest' });
    m.update('editor', { upperKeywords: false });
    const text = m.exportSettings(undefined, { 'db.example.com:3306': { env: 'production', color: 'red' } }, 'es');
    const back = m.parseImport(text, m.defaults());
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.settings.appearance.theme).toBe('forest');
    expect(back.settings.editor.upperKeywords).toBe(false);
    expect(back.connections).toEqual({ 'db.example.com:3306': { env: 'production', color: 'red' } });
    expect(back.language).toBe('es');
  });

  it('rejects files that are not a settings export and cleans bad values', () => {
    expect(m.parseImport('{nope', m.defaults())).toEqual({ ok: false, error: 'json' });
    expect(m.parseImport('{"app":"other"}', m.defaults())).toEqual({ ok: false, error: 'format' });
    const r = m.parseImport(
      JSON.stringify({ app: 'phpMyFlow', kind: 'settings', version: 1, language: 'xx', settings: { appearance: { theme: 'neon' } }, connections: { 'bad key': { env: 'production' }, 'h:1': { env: 'chaos', color: 'pink' } } }),
      m.defaults(),
    );
    expect(r.ok && r.settings.appearance.theme).toBe('monochrome');
    expect(r.ok && r.connections).toEqual({ 'h:1': { color: 'pink' } });
    expect(r.ok && r.language).toBe(null);
  });

  it('importSettings applies what it reads', () => {
    m.loadSettings(user, null);
    const r = m.importSettings(JSON.stringify({ app: 'phpMyFlow', kind: 'settings', version: 1, language: 'fr', settings: { data: { dates: 'iso' } }, connections: {} }));
    expect(r.ok).toBe(true);
    expect(m.settings.data.dates).toBe('iso');
  });
});

describe('production guard', () => {
  it('knows which requests write', async () => {
    const { writes, allowWrite, setWriteGuard } = await import('./writeGuard');
    expect(writes('query', { sql: 'SELECT 1' })).toBe(false);
    expect(writes('query', { sql: '/* x */ with t as (select 1) select * from t' })).toBe(false);
    expect(writes('query', { sql: '-- hi\nUPDATE t SET a = 1 WHERE id = 2' })).toBe(true);
    expect(writes('query', { sql: 'WITH x AS (SELECT 1) DELETE FROM t' })).toBe(true);
    expect(writes('update_cell')).toBe(true);
    expect(writes('alter_preview')).toBe(false);
    expect(writes('export_step')).toBe(false);
    expect(writes('gen_rows', { insert: false })).toBe(false);
    expect(writes('gen_rows', { insert: true })).toBe(true);
    expect(writes('table_create', { spec: { dryRun: true } })).toBe(false);

    // Batches of one job ask once; separate edits ask every time.
    let asked = 0;
    setWriteGuard(async () => (asked++, true));
    await allowWrite('import_upload', undefined, 0);
    await allowWrite('import_upload', undefined, 1000);
    await allowWrite('import_run', undefined, 2000);
    expect(asked).toBe(1);
    await allowWrite('update_cell', undefined, 3000);
    await allowWrite('update_cell', undefined, 4000);
    expect(asked).toBe(3);
    await allowWrite('query', { sql: 'SELECT 1' }, 5000);
    expect(asked).toBe(3);
    setWriteGuard(async () => false);
    expect(await allowWrite('delete_rows', undefined, 6000)).toBe(false);
    setWriteGuard(null);
  });
});
