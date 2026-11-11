// Which database actions the user may run, from SHOW GRANTS (db_caps):
// an action without permission is shown disabled with the reason and the
// GRANT that would allow it.
import { dbApi, type DbCaps } from './dbApi';
import { untrack } from 'svelte';
import { t } from './i18n.svelte';

export const dbTools = $state({
  caps: null as DbCaps | null,
  /** Server-level caps (no database): creating databases. */
  serverCaps: null as DbCaps | null,
  /** Bumped after changes so the overview reloads. */
  tick: 0,
});

export async function loadCaps(db: string) {
  // Called from effects: reading the state here must not subscribe them.
  const known = untrack(() => dbTools.serverCaps);
  try {
    const [c, s] = await Promise.all([db ? dbApi.caps(db) : Promise.resolve(null), known ? Promise.resolve(known) : dbApi.caps()]);
    dbTools.caps = c;
    dbTools.serverCaps = s;
  } catch {
    dbTools.caps = null; // unknown: actions stay enabled, the server decides
  }
}

export interface Need {
  ok: boolean;
  reason?: string;
  grant?: string;
}

/**
 * Can the user run an action needing these privileges on the current
 * database? `write` actions are also blocked by read_only and on system
 * databases.
 */
export function need(privs: string[], write = true, caps: DbCaps | null = dbTools.caps): Need {
  if (!caps) return { ok: true };
  if (write && caps.readOnly) return { ok: false, reason: t('dbtools.why.readOnly') };
  if (write && caps.system) return { ok: false, reason: t('dbtools.why.system') };
  for (const p of privs) {
    if (caps.privileges[p] === false) return { ok: false, reason: t('dbtools.why.missing', { priv: p }), grant: caps.grants[p] };
  }
  return { ok: true };
}

export function needCreateDb(): Need {
  const s = dbTools.serverCaps;
  if (!s) return { ok: true };
  if (s.readOnly) return { ok: false, reason: t('dbtools.why.readOnly') };
  if (!s.createDb) return { ok: false, reason: t('dbtools.why.missing', { priv: 'CREATE' }), grant: s.createDbGrant };
  return { ok: true };
}

/** Text for a disabled menu entry or button: reason + GRANT. */
export const needText = (n: Need) => (n.ok ? '' : n.grant ? `${n.reason} ${n.grant}` : (n.reason ?? ''));
