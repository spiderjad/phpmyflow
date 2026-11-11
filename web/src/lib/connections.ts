// Connections as the user sees them: recent logins (login screen cards),
// color and environment per server (config.php 'color' / 'env', or the
// user's own choice in Settings), and the suggested environment for a host.
// Never stores passwords.
import type { LoginSsl, Session } from './api';
import { COLORS, type ColorId } from './theme';

export const ENVS = ['production', 'staging', 'development', 'local'] as const;
export type Env = (typeof ENVS)[number];

/** Default color of each environment (the label is always shown too: never color alone). */
export const ENV_COLOR: Record<Env, ColorId> = { production: 'red', staging: 'amber', development: 'green', local: 'blue' };

export interface RecentConnection {
  host: string;
  port: number;
  user: string;
  /** SSL choices used (only for servers where the user can choose). */
  ssl: LoginSsl | null;
  /** Label of the configured server, null for "Other server…". */
  label: string | null;
  at: number;
}

const RECENT_KEY = 'pmf.login.recent';
const OLD_KEY = 'pmf.login.custom';
export const MAX_RECENT = 4;

export const connKey = (host: string, port: number) => `${host.toLowerCase()}:${port}`;

export function readRecent(): RecentConnection[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? 'null');
    if (Array.isArray(list)) return list.filter((c) => c && typeof c.host === 'string' && typeof c.user === 'string').slice(0, MAX_RECENT);
    // Before recent connections there was one remembered "Other server…".
    const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? 'null');
    if (old && typeof old.host === 'string') return [{ host: old.host, port: Number(old.port) || 3306, user: String(old.user ?? ''), ssl: old.ssl ?? null, label: null, at: 0 }];
  } catch {
    /* blocked or broken storage */
  }
  return [];
}

function writeRecent(list: RecentConnection[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
    localStorage.removeItem(OLD_KEY);
  } catch {
    /* ignore */
  }
}

const same = (a: { host: string; port: number; user: string }, b: { host: string; port: number; user: string }) =>
  connKey(a.host, a.port) === connKey(b.host, b.port) && a.user === b.user;

/** Most recent first, one entry per user@host:port, at most 4. */
export function rememberRecent(c: Omit<RecentConnection, 'at'>, now = Date.now()): RecentConnection[] {
  // Only these fields: whatever else the caller has (a password…) never reaches storage.
  const entry: RecentConnection = { host: c.host, port: c.port, user: c.user, ssl: c.ssl ? { enabled: !!c.ssl.enabled, verify: !!c.ssl.verify, ca: String(c.ssl.ca ?? '') } : null, label: c.label, at: now };
  const list = [entry, ...readRecent().filter((x) => !same(x, c))].slice(0, MAX_RECENT);
  writeRecent(list);
  return list;
}

export function forgetRecent(c: { host: string; port: number; user: string }): RecentConnection[] {
  const list = readRecent().filter((x) => !same(x, c));
  writeRecent(list);
  return list;
}

/**
 * Suggested environment (never applied without the user's OK): loopback and
 * Docker-style hosts look local; anything else is treated as production.
 */
export function suggestEnv(host: string): Env {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h.startsWith('127.') || h === '0.0.0.0') return 'local';
  if (h === 'host.docker.internal' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return 'local';
  // Docker Compose service names: no dot, not an IP ("db", "mysql", "mariadb-1").
  if (!h.includes('.') && !h.includes(':')) return 'local';
  // Docker's default bridge networks.
  if (/^172\.(1[7-9]|2\d|3[01])\./.test(h)) return 'local';
  return 'production';
}

export interface ConnectionLook {
  color: ColorId | null;
  env: Env | null;
  /** Where env came from: config.php wins over the user's choice. */
  envFrom: 'config' | 'user' | null;
}

/** User choices per connection (Settings › Connections), keyed by connKey. */
export type ConnectionPrefs = Record<string, { color?: ColorId | null; env?: Env | null }>;

const CONN_PREFS_KEY = 'pmf.connections';

export function readConnectionPrefs(): ConnectionPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(CONN_PREFS_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function writeConnectionPrefs(p: ConnectionPrefs) {
  try {
    localStorage.setItem(CONN_PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/**
 * Color and environment of host:port. config.php fixes the environment
 * (an admin decides what is production); the color is the user's choice,
 * else config.php's, else the environment's color.
 */
export function connectionLook(host: string, port: number, servers: Session['servers'], prefs: ConnectionPrefs = readConnectionPrefs()): ConnectionLook {
  const key = connKey(host, port);
  const cfg = servers.find((s) => connKey(s.host, s.port) === key);
  const mine = prefs[key] ?? {};
  const cfgEnv = cfg?.env && (ENVS as readonly string[]).includes(cfg.env) ? (cfg.env as Env) : null;
  const userEnv = mine.env && (ENVS as readonly string[]).includes(mine.env) ? mine.env : null;
  const env = cfgEnv ?? userEnv;
  const valid = (c: unknown): c is ColorId => (COLORS as readonly unknown[]).includes(c);
  const color = valid(mine.color) ? mine.color : valid(cfg?.color) ? cfg!.color! : env ? ENV_COLOR[env] : null;
  return { color, env, envFrom: cfgEnv ? 'config' : userEnv ? 'user' : null };
}
