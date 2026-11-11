import { objApi, type DbObjects, type ObjKind } from './objects';
import { settings } from './settings.svelte';
import { api, type DatabaseInfo, type Polymorphic, type Relation, type SchemaMap, type Session, type TableInfo } from './api';

export type View = 'overview' | 'data' | 'structure' | 'relations' | 'sql' | 'monitor' | 'object' | 'search';

const VIEW_KEY = 'pmf_view';
/** Top-level view to come back to after a reload (per browser tab). */
function savedView(): View {
  try {
    const v = sessionStorage.getItem(VIEW_KEY);
    return v === 'sql' || v === 'monitor' ? v : 'overview';
  } catch {
    return 'overview';
  }
}
export function rememberView(v: View) {
  try {
    if (v === 'sql' || v === 'monitor' || v === 'overview') sessionStorage.setItem(VIEW_KEY, v);
  } catch {
    /* ignore */
  }
}

export const app = $state({
  session: null as Session | null,
  databases: [] as DatabaseInfo[],
  serverVersion: '',
  /** Server time zone of date values (grid tooltips). */
  timeZone: '',
  db: '',
  tables: [] as TableInfo[],
  schema: {} as SchemaMap,
  relations: [] as Relation[],
  /** itemtype + items_id pairs: point to any table, never a FK. */
  polymorphic: [] as Polymorphic[],
  /** Views are in tables; procedures, functions, triggers, events here. */
  objects: null as DbObjects | null,
  /** Object open in the editor (name null = new). */
  object: null as { kind: ObjKind; name: string | null; table?: string } | null,
  /** Filters to apply when the next table opens (follow a foreign key). */
  pendingFilter: null as { table: string; filters: Record<string, string> } | null,
  /** Open Structure on this definition (a key icon in the grid header). */
  structureFocus: null as { type: 'index' | 'fk' | 'column'; name: string } | null,
  /** Structure changes not applied yet (logout warns: they would be lost). */
  pendingStructure: null as { table: string; count: number } | null,
  table: '',
  view: savedView(),
  loadingTables: false,
});

const LAST_DB = 'pmf_last_db';

export const isMariaDb = () => /mariadb/i.test(app.serverVersion);

export async function loadDatabases() {
  const res = await api.databases();
  app.databases = res.databases;
  app.serverVersion = res.serverVersion;
  app.timeZone = res.timeZone ?? '';
  let last = '';
  try {
    last = localStorage.getItem(LAST_DB) ?? '';
  } catch {
    /* ignore */
  }
  const fallback = res.databases.find((d) => !d.system)?.name ?? res.databases[0]?.name ?? '';
  const initial = res.databases.some((d) => d.name === last) ? last : fallback;
  if (initial) await selectDb(initial);
}

export async function selectDb(db: string) {
  app.db = db;
  app.table = '';
  // The SQL editor and the monitor don't depend on a table: stay there.
  const opening = app.view !== 'sql' && app.view !== 'monitor';
  if (opening) app.view = 'overview';
  app.loadingTables = true;
  try {
    localStorage.setItem(LAST_DB, db);
  } catch {
    /* ignore */
  }
  try {
    const [tables, schema] = await Promise.all([api.tables(db), api.schema(db)]);
    if (app.db !== db) return; // user switched again meanwhile
    app.tables = tables.tables;
    app.schema = schema.tables;
    app.relations = schema.relations ?? [];
    app.polymorphic = schema.polymorphic ?? [];
    void loadObjects(db);
    // Settings › General › tab when opening a database.
    if (opening && settings.general.startTab === 'sql') app.view = 'sql';
    else if (opening && settings.general.startTab === 'data' && app.tables[0] && !app.table) {
      app.table = app.tables[0].name;
      app.view = 'data';
    }
  } finally {
    app.loadingTables = false;
  }
}

export function selectTable(table: string) {
  app.table = table;
  // Views that don't show a table (SQL, overview, search, an object) switch to its data.
  if (app.view === 'sql' || app.view === 'overview' || app.view === 'search' || app.view === 'object') app.view = 'data';
}

/** Open a table filtered by column values (follow a foreign key, related rows). */
export function openFiltered(table: string, filters: Record<string, string>) {
  app.pendingFilter = { table, filters };
  app.table = table;
  app.view = 'data';
}

/** Refresh schema after DDL (CREATE/ALTER/DROP) so autocomplete stays right. */
export async function refreshSchema() {
  if (!app.db) return;
  const [tables, schema] = await Promise.all([api.tables(app.db), api.schema(app.db)]);
  app.tables = tables.tables;
  app.schema = schema.tables;
  app.relations = schema.relations ?? [];
  app.polymorphic = schema.polymorphic ?? [];
  await loadObjects(app.db);
  if (app.table && !app.schema[app.table]) app.table = '';
}

/** Routines, triggers, events of a database (sidebar groups). */
export async function loadObjects(db: string) {
  try {
    const o = await objApi.list(db);
    if (app.db === db) app.objects = o;
  } catch {
    if (app.db === db) app.objects = null;
  }
}

/** Open a view, routine, trigger or event in its editor (name null: new one). */
export function openObject(kind: ObjKind, name: string | null, table?: string) {
  app.object = { kind, name, table };
  app.view = 'object';
}
