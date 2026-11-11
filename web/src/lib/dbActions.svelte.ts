// Database and table actions: one dialog store and the two context menus
// (database: selector, breadcrumb, "⋯"; table: sidebar and overview). Every
// entry checks privileges (db_caps); later phases show "Coming soon".
import type { MenuItem } from '../components/ui/Menu.svelte';
import { api } from './api';
import { copyText } from './clipboard';
import { dbApi } from './dbApi';
import { dbTools, loadCaps, need, needCreateDb, needText, type Need } from './dbTools.svelte';
import { t } from './i18n.svelte';
import { objApi, type ObjKind } from './objects';
import { app, openObject, refreshSchema, selectDb, selectTable } from './state.svelte';
import { tabs } from './tabs.svelte';
import { confirmAction, toast } from './ui.svelte';

export type DialogReq =
  | { kind: 'createDb' }
  | { kind: 'editDb'; db: string }
  | { kind: 'copyDb'; db: string }
  | { kind: 'dropDb'; db: string }
  | { kind: 'createTable'; db: string }
  | { kind: 'renameTable'; db: string; table: string }
  | { kind: 'copyTable'; db: string; table: string }
  | { kind: 'truncate'; db: string; tables: string[] }
  | { kind: 'drop'; db: string; tables: string[] }
  | { kind: 'export'; db: string; tables: string[] }
  | { kind: 'import'; db: string }
  | { kind: 'dropObject'; db: string; objKind: ObjKind; name: string }
  | { kind: 'maintenance'; db: string; tables: string[] }
  | { kind: 'bulk'; db: string; tables: string[] }
  | { kind: 'generate'; db: string; table: string };

export const dialogs = $state({ req: null as DialogReq | null, menu: null as { x: number; y: number; items: MenuItem[]; label: string } | null });

export function openDialog(req: DialogReq) {
  dialogs.req = req;
}
export function closeDialog() {
  dialogs.req = null;
}

export function openMenu(e: MouseEvent | { clientX: number; clientY: number }, items: MenuItem[], label: string) {
  if ('preventDefault' in e) e.preventDefault();
  dialogs.menu = { x: e.clientX, y: e.clientY, items, label };
}

/** Reload databases, the current schema, privileges and the overview. */
export async function reloadAll() {
  const res = await api.databases();
  app.databases = res.databases;
  if (app.db && !res.databases.some((d) => d.name === app.db)) {
    app.db = '';
    app.table = '';
    app.tables = [];
  } else await refreshSchema();
  await loadCaps(app.db);
  dbTools.tick++;
}

/** Extra confirmation before changing a database managed by an app (GLPI, WordPress). */
export async function managedOk(db: string): Promise<boolean> {
  const m = dbTools.caps?.db === db ? dbTools.caps.managedBy : null;
  if (!m) return true;
  return confirmAction({ title: t('managed.confirmTitle'), body: `${t('managed.title', { app: m === 'glpi' ? 'GLPI' : 'WordPress' })} ${t(`managed.${m}`)}`, confirmLabel: t('managed.confirm'), danger: true });
}

const soon = (label: string): MenuItem => ({ label, disabled: true, note: t('dbmenu.soon') });

/** A menu entry gated by privileges: disabled with the reason; a click copies the GRANT. */
function gated(label: string, n: Need, action: () => void, extra: Partial<Exclude<MenuItem, 'sep'>> = {}): MenuItem {
  return {
    label,
    action,
    disabled: !n.ok,
    note: n.ok ? undefined : n.reason,
    title: n.ok ? undefined : needText(n),
    onDisabled: n.grant
      ? async () => {
          if (await copyText(n.grant!)) toast(t('dbtools.grantCopied'), 'info');
        }
      : undefined,
    ...extra,
  };
}

export function dbMenuItems(db: string): MenuItem[] {
  const hasDb = !!db;
  return [
    { label: t('dbmenu.overview'), id: 'overview', disabled: !hasDb, action: () => ((app.table = ''), (app.view = 'overview')) },
    gated(t('dbmenu.edit'), need(['ALTER']), () => openDialog({ kind: 'editDb', db }), { id: 'editDb', disabled: !hasDb || !need(['ALTER']).ok }),
    {
      label: t('dbmenu.createNew'),
      id: 'createNew',
      submenu: [
        gated(t('dbmenu.new.database'), needCreateDb(), () => openDialog({ kind: 'createDb' }), { id: 'newDb' }),
        gated(t('dbmenu.new.table'), need(['CREATE']), () => openDialog({ kind: 'createTable', db }), { id: 'newTable', disabled: !hasDb || !need(['CREATE']).ok }),
        gated(t('dbmenu.new.tableCopy'), need(['CREATE', 'INSERT', 'SELECT']), () => app.table && openDialog({ kind: 'copyTable', db, table: app.table }), {
          disabled: !app.table || !need(['CREATE', 'INSERT', 'SELECT']).ok,
          note: !app.table ? t('dbmenu.pickTable') : undefined,
        }),
        gated(t('dbmenu.new.view'), need(['CREATE VIEW']), () => openObject('VIEW', null), { id: 'newView', disabled: !hasDb || !need(['CREATE VIEW']).ok }),
        gated(t('dbmenu.new.procedure'), need(['CREATE ROUTINE']), () => openObject('PROCEDURE', null), { id: 'newProcedure', disabled: !hasDb || !need(['CREATE ROUTINE']).ok }),
        gated(t('dbmenu.new.function'), need(['CREATE ROUTINE']), () => openObject('FUNCTION', null), { id: 'newFunction', disabled: !hasDb || !need(['CREATE ROUTINE']).ok }),
        gated(t('dbmenu.new.trigger'), need(['TRIGGER']), () => openObject('TRIGGER', null, app.table || app.tables.find((x) => x.type !== 'VIEW')?.name), { id: 'newTrigger', disabled: !hasDb || !need(['TRIGGER']).ok }),
        gated(t('dbmenu.new.event'), need(['EVENT']), () => openObject('EVENT', null), { id: 'newEvent', disabled: !hasDb || !need(['EVENT']).ok }),
      ],
    },
    'sep',
    gated(t('dbmenu.export'), need(['SELECT'], false), () => openDialog({ kind: 'export', db, tables: [] }), { id: 'export', keys: undefined, disabled: !hasDb || !need(['SELECT'], false).ok }),
    gated(t('dbmenu.import'), need(['INSERT', 'CREATE']), () => openDialog({ kind: 'import', db }), { id: 'import', disabled: !hasDb || !need(['INSERT', 'CREATE']).ok }),
    gated(t('dbmenu.maintenance'), need(['SELECT', 'INSERT']), () => openDialog({ kind: 'maintenance', db, tables: [] }), { id: 'maintenance', disabled: !hasDb || !need(['SELECT', 'INSERT']).ok }),
    { label: t('dbmenu.search'), id: 'search', keys: ['Ctrl', 'Shift', 'F'], action: () => (app.view = 'search') },
    gated(t('dbmenu.bulk'), need(['ALTER']), () => openDialog({ kind: 'bulk', db, tables: [] }), { id: 'bulk', disabled: !hasDb || !need(['ALTER']).ok }),
    gated(t('dbmenu.generate'), need(['INSERT']), () => openDialog({ kind: 'generate', db, table: app.table }), {
      id: 'generate',
      disabled: !hasDb || !need(['INSERT']).ok || !!dbTools.caps?.managedBy,
      note: dbTools.caps?.managedBy ? t('gen.blockedShort') : need(['INSERT']).reason,
    }),
    'sep',
    { label: t('dbmenu.copyDb'), id: 'copyDb', disabled: !hasDb || !needCreateDb().ok, title: needText(needCreateDb()) || t('dbmenu.copyDbTip'), action: () => openDialog({ kind: 'copyDb', db }) },
    { label: t('dbmenu.reload'), id: 'reload', action: () => void reloadAll() },
    'sep',
    gated(t('dbmenu.drop'), need(['DROP']), () => openDialog({ kind: 'dropDb', db }), { id: 'dropDb', danger: true, disabled: !hasDb || !need(['DROP']).ok }),
  ];
}

const q = (name: string) => '`' + name.replace(/`/g, '``') + '`';

function sqlTab(sql: string, run: boolean) {
  if (!tabs.create({ sql, db: app.db, autorun: run })) {
    toast(t('tabs.limit', { max: 30 }), 'error');
    return;
  }
  app.view = 'sql';
}

export function tableMenuItems(db: string, table: string, isView: boolean): MenuItem[] {
  const write = (privs: string[]) => need(privs);
  return [
    { label: t('tblmenu.open'), id: 'open', action: () => selectTable(table) },
    ...(isView ? [gated(t('objects.editView'), need(['CREATE VIEW', 'DROP']), () => openObject('VIEW', table), { id: 'editView' })] : []),
    { label: t('tblmenu.openSql'), id: 'openSql', action: () => sqlTab(`SELECT *\nFROM ${q(table)}\nWHERE 1\nLIMIT 100`, false) },
    { label: t('tblmenu.select1000'), id: 'select1000', action: () => sqlTab(`SELECT * FROM ${q(table)} LIMIT 1000`, true) },
    'sep',
    gated(t('tblmenu.rename'), write(['ALTER', 'DROP', 'CREATE', 'INSERT']), () => openDialog({ kind: 'renameTable', db, table }), { id: 'rename' }),
    gated(t('tblmenu.copy'), write(['CREATE', 'INSERT', 'SELECT']), () => openDialog({ kind: 'copyTable', db, table }), { id: 'copy', disabled: isView || !write(['CREATE', 'INSERT', 'SELECT']).ok, note: isView ? t('tblmenu.viewNo') : undefined }),
    gated(t('tblmenu.truncate'), write(['DROP']), () => openDialog({ kind: 'truncate', db, tables: [table] }), { id: 'truncate', danger: true, disabled: isView || !write(['DROP']).ok }),
    gated(t('tblmenu.drop'), write(['DROP']), () => openDialog({ kind: 'drop', db, tables: [table] }), { id: 'drop', danger: true }),
    'sep',
    gated(t('tblmenu.export'), need(['SELECT'], false), () => openDialog({ kind: 'export', db, tables: [table] }), { id: 'export' }),
    gated(t('tblmenu.maintenance'), need(['SELECT', 'INSERT']), () => openDialog({ kind: 'maintenance', db, tables: [table] }), { id: 'maintenance', disabled: isView || !need(['SELECT', 'INSERT']).ok }),
    gated(t('tblmenu.generate'), need(['INSERT']), () => openDialog({ kind: 'generate', db, table }), {
      id: 'generate',
      disabled: isView || !need(['INSERT']).ok || !!dbTools.caps?.managedBy,
      note: dbTools.caps?.managedBy ? t('gen.blockedShort') : undefined,
    }),
    'sep',
    {
      label: t('tblmenu.copyName'),
      id: 'copyName',
      action: async () => {
        if (await copyText(table)) toast(t('tblmenu.copied'), 'info');
      },
    },
    {
      label: t('tblmenu.copyCreate'),
      id: 'copyCreate',
      action: async () => {
        try {
          const r = await dbApi.createCode(db, table);
          if (await copyText(r.sql)) toast(t('tblmenu.createCopied'), 'info');
        } catch (e) {
          toast(e instanceof Error ? e.message : String(e), 'error');
        }
      },
    },
  ];
}

/** Context menu of a procedure, function, trigger or event. */
export function objectMenuItems(db: string, kind: ObjKind, name: string, table?: string): MenuItem[] {
  const change = kind === 'TRIGGER' ? ['TRIGGER'] : kind === 'EVENT' ? ['EVENT'] : ['ALTER ROUTINE'];
  return [
    { label: t('objects.open'), id: 'open', action: () => openObject(kind, name, table) },
    ...(kind === 'PROCEDURE' || kind === 'FUNCTION' ? [gated(t('objects.execute'), need(['EXECUTE']), () => openObject(kind, name), { id: 'exec' })] : []),
    'sep',
    {
      label: t('objects.copyCreate'),
      id: 'copyCreate',
      action: async () => {
        try {
          const r = await objApi.code(db, kind, name);
          if (await copyText(r.sql)) toast(t('tblmenu.createCopied'), 'info');
        } catch (e) {
          toast(e instanceof Error ? e.message : String(e), 'error');
        }
      },
    },
    {
      label: t('tblmenu.copyName'),
      id: 'copyName',
      action: async () => {
        if (await copyText(name)) toast(t('tblmenu.copied'), 'info');
      },
    },
    'sep',
    gated(t('objects.drop'), need(change), () => openDialog({ kind: 'dropObject', db, objKind: kind, name }), { id: 'drop', danger: true }),
  ];
}

/** After dropping the current database or table. */
export async function afterDrop(db: string, tables: string[] | null) {
  if (tables === null) {
    if (app.db === db) {
      app.db = '';
      app.table = '';
    }
    const res = await api.databases();
    app.databases = res.databases;
    const next = res.databases.find((d) => !d.system)?.name;
    if (!app.db && next) await selectDb(next);
  } else {
    if (tables.includes(app.table)) app.table = '';
    await refreshSchema();
  }
  await loadCaps(app.db);
  dbTools.tick++;
}
