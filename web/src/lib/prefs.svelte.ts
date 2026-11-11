// Per-browser UI preferences kept in localStorage. Never holds credentials
// or row data. Every access is wrapped: storage can be blocked.
import { app } from './state.svelte';

export type Density = 'compact' | 'comfortable';
export type TableSort = 'name' | 'rows' | 'size';

const KEY = 'pmf_prefs';
const PINS_KEY = 'pmf_pins';

export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 560;

interface Stored {
  density: Density;
  sidebarWidth: number;
  hidePrefix: boolean;
  tableSort: TableSort;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export const prefs = $state<Stored>(read<Stored>(KEY, { density: 'compact', sidebarWidth: 248, hidePrefix: false, tableSort: 'name' }));

export function savePrefs() {
  write(KEY, { density: prefs.density, sidebarWidth: prefs.sidebarWidth, hidePrefix: prefs.hidePrefix, tableSort: prefs.tableSort });
}

export function setDensity(d: Density) {
  prefs.density = d;
  savePrefs();
}

export function setSidebarWidth(px: number) {
  prefs.sidebarWidth = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, px)));
}

export const ROW_HEIGHT: Record<Density, number> = { compact: 26, comfortable: 34 };

// --- pinned tables, per user@host:port and database ---

type PinStore = Record<string, string[]>;
const pinStore = $state<PinStore>(read<PinStore>(PINS_KEY, {}));

function pinKey(): string {
  const a = app.session?.auth;
  return a ? `${a.user}@${a.host}:${a.port}/${app.db}` : '';
}

export function pinnedTables(): string[] {
  return pinStore[pinKey()] ?? [];
}

export function togglePin(table: string) {
  const key = pinKey();
  if (!key) return;
  const list = pinStore[key] ?? [];
  pinStore[key] = list.includes(table) ? list.filter((x) => x !== table) : [...list, table];
  if (!pinStore[key].length) delete pinStore[key];
  write(PINS_KEY, pinStore);
}
