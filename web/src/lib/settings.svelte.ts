// Settings (gear icon / Ctrl+,): applied live, saved per user@host in
// localStorage. Appearance goes through lib/theme.ts; the rest is read by the
// components that need it (SqlEditor, DataGrid, TableView, SqlView, state).
// Connection colors / environments are per server for everyone on this
// browser (lib/connections.ts), but travel in the same export file.
import { applyAppearance, mirroredAppearance, normalizeAppearance, type Appearance } from './theme';
import { readConnectionPrefs, writeConnectionPrefs, ENVS, type ConnectionPrefs } from './connections';
import { COLORS } from './theme';
import { i18n, LOCALES, setLocale, type Locale } from './i18n.svelte';
import { prefs } from './prefs.svelte';
import { DEFAULT_SENSITIVE } from './sensitive';

export const EDITOR_FONT_SIZES = [12, 13, 14, 15, 16] as const;
export const SYNTAX = ['theme', 'mono', 'classic', 'pastel'] as const;
export const PER_PAGE = [25, 50, 100, 250, 500] as const;
export const RELATIONS = ['both', 'name', 'id'] as const;
export const DATES = ['locale', 'iso'] as const;
export const START_TABS = ['overview', 'data', 'sql'] as const;

export interface Settings {
  appearance: Appearance;
  editor: { fontSize: (typeof EDITOR_FONT_SIZES)[number]; syntax: (typeof SYNTAX)[number]; upperKeywords: boolean; lint: boolean; wrap: boolean };
  data: { perPage: (typeof PER_PAGE)[number]; relations: (typeof RELATIONS)[number]; zebra: boolean; dates: (typeof DATES)[number]; hideSensitive: boolean; sensitive: string[] };
  general: { confirmWhere: boolean; startTab: (typeof START_TABS)[number] };
}
export type Section = keyof Settings;

export function defaults(appearance: Appearance = mirroredAppearance()): Settings {
  return {
    appearance: { ...appearance },
    editor: { fontSize: 13, syntax: 'theme', upperKeywords: true, lint: true, wrap: true },
    data: { perPage: 100, relations: 'both', zebra: false, dates: 'locale', hideSensitive: true, sensitive: [...DEFAULT_SENSITIVE] },
    general: { confirmWhere: false, startTab: 'overview' },
  };
}

const pick = <T>(x: unknown, allowed: readonly T[], d: T): T => (allowed.includes(x as T) ? (x as T) : d);
const bool = (x: unknown, d: boolean) => (typeof x === 'boolean' ? x : d);

/** Keeps known keys with valid values; anything else falls back to `base` (imports, old storage). */
export function normalizeSettings(raw: unknown, base: Settings): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Record<string, unknown> | undefined>;
  const e = r.editor ?? {};
  const d = r.data ?? {};
  const g = r.general ?? {};
  return {
    appearance: normalizeAppearance((r.appearance ?? {}) as Partial<Record<keyof Appearance, unknown>>, base.appearance),
    editor: {
      fontSize: pick(Number(e.fontSize), EDITOR_FONT_SIZES, base.editor.fontSize),
      syntax: pick(e.syntax, SYNTAX, base.editor.syntax),
      upperKeywords: bool(e.upperKeywords, base.editor.upperKeywords),
      lint: bool(e.lint, base.editor.lint),
      wrap: bool(e.wrap, base.editor.wrap),
    },
    data: {
      perPage: pick(Number(d.perPage), PER_PAGE, base.data.perPage),
      relations: pick(d.relations, RELATIONS, base.data.relations),
      zebra: bool(d.zebra, base.data.zebra),
      dates: pick(d.dates, DATES, base.data.dates),
      hideSensitive: bool(d.hideSensitive, base.data.hideSensitive),
      sensitive: Array.isArray(d.sensitive)
        ? [...new Set(d.sensitive.filter((x): x is string => typeof x === 'string').map((x) => x.trim().toLowerCase()).filter((x) => x && x.length <= 50))].slice(0, 100)
        : [...base.data.sensitive],
    },
    general: {
      confirmWhere: bool(g.confirmWhere, base.general.confirmWhere),
      startTab: pick(g.startTab, START_TABS, base.general.startTab),
    },
  };
}

// --- the live store ---

export const settings = $state<Settings>(defaults());
/** Set from config.php: appearance can't be changed. */
export const settingsMeta = $state({ key: '', locked: false, lockedAppearance: null as Appearance | null });

export const settingsKey = (a: { user: string; host: string; port: number } | null | undefined) => (a ? `pmf.settings.${a.user}@${a.host}:${a.port}` : '');

function save() {
  if (!settingsMeta.key) return;
  try {
    localStorage.setItem(settingsMeta.key, JSON.stringify($state.snapshot(settings)));
  } catch {
    /* storage blocked: applied for this page only */
  }
}

/** Puts every setting into effect (attributes on <html>, shared prefs). */
export function applySettings(s: Settings = settings) {
  const appearance = settingsMeta.lockedAppearance ?? s.appearance;
  applyAppearance(appearance);
  prefs.density = appearance.density;
  const root = document.documentElement;
  root.setAttribute('data-syntax', s.editor.syntax);
  root.setAttribute('data-zebra', s.data.zebra ? 'on' : 'off');
  root.style.setProperty('--editor-font', `${s.editor.fontSize}px`);
}

/**
 * After login: this user@host's settings (or the defaults, starting from the
 * appearance in use, so the login's light/dark choice carries over).
 */
export function loadSettings(auth: { user: string; host: string; port: number } | null, locked: Appearance | null) {
  settingsMeta.key = settingsKey(auth);
  settingsMeta.locked = !!locked;
  settingsMeta.lockedAppearance = locked;
  const base = defaults();
  let stored: unknown = null;
  try {
    stored = settingsMeta.key ? JSON.parse(localStorage.getItem(settingsMeta.key) ?? 'null') : null;
  } catch {
    stored = null;
  }
  Object.assign(settings, normalizeSettings(stored, base));
  applySettings();
}

export function update<S extends Section>(section: S, patch: Partial<Settings[S]>) {
  if (section === 'appearance' && settingsMeta.locked) return;
  Object.assign(settings[section], patch);
  applySettings();
  save();
}

export function resetSection(section: Section) {
  if (section === 'appearance' && settingsMeta.locked) return;
  const d = defaults();
  // Appearance resets to the built-in look (not to the current one).
  settings[section] = (section === 'appearance' ? normalizeAppearance({}) : d[section]) as never;
  applySettings();
  save();
}

// --- export / import ---

export interface ExportFile {
  app: 'phpMyFlow';
  kind: 'settings';
  version: 1;
  language: Locale;
  settings: Settings;
  connections: ConnectionPrefs;
}

export function exportSettings(s: Settings = $state.snapshot(settings) as Settings, connections = readConnectionPrefs(), language: Locale = i18n.locale): string {
  const file: ExportFile = { app: 'phpMyFlow', kind: 'settings', version: 1, language, settings: s, connections };
  return JSON.stringify(file, null, 2);
}

export type ImportResult = { ok: true; settings: Settings; connections: ConnectionPrefs; language: Locale | null } | { ok: false; error: 'json' | 'format' };

/** Validates a file from exportSettings (pure: tested). Unknown values fall back to `base`. */
export function parseImport(text: string, base: Settings): ImportResult {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, error: 'json' };
  }
  const f = v as Partial<ExportFile> | null;
  if (!f || f.app !== 'phpMyFlow' || f.kind !== 'settings' || typeof f.settings !== 'object') return { ok: false, error: 'format' };
  const connections: ConnectionPrefs = {};
  for (const [k, c] of Object.entries((f.connections ?? {}) as Record<string, Record<string, unknown>>)) {
    if (!/^[^:\s]+:\d{1,5}$/.test(k) || !c || typeof c !== 'object') continue;
    const color = (COLORS as readonly unknown[]).includes(c.color) ? (c.color as ConnectionPrefs[string]['color']) : null;
    const env = (ENVS as readonly unknown[]).includes(c.env) ? (c.env as ConnectionPrefs[string]['env']) : null;
    if (color || env) connections[k] = { ...(color ? { color } : {}), ...(env ? { env } : {}) };
  }
  const language = typeof f.language === 'string' && f.language in LOCALES ? (f.language as Locale) : null;
  return { ok: true, settings: normalizeSettings(f.settings, base), connections, language };
}

export function importSettings(text: string): ImportResult {
  const r = parseImport(text, $state.snapshot(settings) as Settings);
  if (!r.ok) return r;
  const keep = settingsMeta.locked ? settings.appearance : r.settings.appearance;
  Object.assign(settings, { ...r.settings, appearance: keep });
  writeConnectionPrefs({ ...readConnectionPrefs(), ...r.connections });
  connectionsVersion.n++;
  if (r.language) setLocale(r.language);
  applySettings();
  save();
  return r;
}

// --- connection preferences (color / env per host:port) ---

/** Bumped when connection prefs change, so views that read them refresh. */
export const connectionsVersion = $state({ n: 0 });

export function setConnectionPref(key: string, patch: { color?: ConnectionPrefs[string]['color']; env?: ConnectionPrefs[string]['env'] }) {
  const all = readConnectionPrefs();
  const next = { ...(all[key] ?? {}), ...patch };
  if (!next.color) delete next.color;
  if (!next.env) delete next.env;
  if (Object.keys(next).length) all[key] = next;
  else delete all[key];
  writeConnectionPrefs(all);
  connectionsVersion.n++;
}

export function resetConnections() {
  writeConnectionPrefs({});
  connectionsVersion.n++;
}
