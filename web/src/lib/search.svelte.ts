// Server-wide text search: one table per request with a time limit, results
// grouped by table and column. Lives in a store so it keeps running (and its
// results stay) when the user opens another view.
import { t } from './i18n.svelte';
import { isAbort, startJob, type Job } from './jobs.svelte';
import { toolsApi, type SearchMode } from './toolsApi';

export interface SearchHit {
  db: string;
  table: string;
  matches: { column: string; count: number }[];
  timedOut?: boolean;
  error?: string;
}

export const search = $state({
  q: '',
  mode: 'contains' as SearchMode,
  caseSensitive: false,
  allColumns: false,
  scope: 'db' as 'db' | 'dbs' | 'server',
  dbs: [] as string[],
  someTables: false,
  tables: [] as string[],
  timeoutSec: 10,
  running: false,
  progress: 0,
  current: '',
  scanned: 0,
  total: 0,
  hits: [] as SearchHit[],
  /** Tables that timed out or failed (shown apart). */
  problems: [] as SearchHit[],
  /** What the last results were searched with. */
  last: null as { q: string; mode: SearchMode; caseSensitive: boolean } | null,
  error: '',
});

let job: Job | null = null;

export async function runSearch(currentDb: string) {
  if (search.running) return;
  search.running = true;
  search.error = '';
  search.hits = [];
  search.problems = [];
  search.scanned = 0;
  search.progress = 0;
  const params = { q: search.q, mode: search.mode, caseSensitive: search.caseSensitive, allColumns: search.allColumns, timeoutMs: Math.round(search.timeoutSec * 1000) };
  search.last = { q: search.q, mode: search.mode, caseSensitive: search.caseSensitive };
  job = startJob('search', t('search.jobTitle', { q: search.q }));
  const signal = job.controller.signal;
  try {
    const dbs = search.scope === 'server' ? null : search.scope === 'dbs' ? search.dbs : [currentDb];
    const tables = search.scope === 'db' && search.someTables ? search.tables : null;
    const plan = (await toolsApi.searchPlan(dbs, tables)).tables.filter((x) => x.textCols > 0 || search.allColumns);
    search.total = plan.length;
    for (const tb of plan) {
      if (signal.aborted) break;
      search.current = `${tb.db}.${tb.table}`;
      job.detail = t('search.scanning', { table: search.current, n: search.scanned + 1, of: plan.length });
      try {
        const r = await toolsApi.searchTable({ db: tb.db, table: tb.table, ...params }, signal);
        if (r.timedOut) search.problems.push({ db: tb.db, table: tb.table, matches: [], timedOut: true });
        else if (r.matches.length) search.hits.push({ db: tb.db, table: tb.table, matches: r.matches });
      } catch (e) {
        if (isAbort(e) || signal.aborted) break;
        const msg = e instanceof Error ? e.message : String(e);
        if ((e as { code?: string }).code === 'bad_regex' || (e as { code?: string }).code === 'bad_search') {
          search.error = msg;
          break;
        }
        search.problems.push({ db: tb.db, table: tb.table, matches: [], error: msg });
      }
      search.scanned++;
      search.progress = search.scanned / Math.max(1, plan.length);
      job.progress = search.progress;
    }
    const rows = search.hits.reduce((s, h) => s + h.matches.reduce((a, m) => a + m.count, 0), 0);
    job.status = signal.aborted ? 'cancelled' : search.error ? 'error' : 'done';
    job.error = search.error;
    job.detail = t('search.summary', { rows: rows.toLocaleString(), tables: search.hits.length, scanned: search.scanned });
  } catch (e) {
    search.error = e instanceof Error ? e.message : String(e);
    job.status = 'error';
    job.error = search.error;
  } finally {
    search.running = false;
    search.current = '';
  }
}

export function cancelSearch() {
  job?.controller.abort();
}

const q = (s: string) => '`' + s.replace(/`/g, '``') + '`';
const lit = (s: string) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";

/** The same search as a SELECT for the SQL editor. */
export function searchSql(h: { db: string; table: string }, column: string, last: { q: string; mode: SearchMode; caseSensitive: boolean }): string {
  const col = last.caseSensitive && last.mode !== 'regex' ? `BINARY ${q(column)}` : q(column);
  const like = last.q.replace(/[\\%_]/g, (c) => '\\' + c);
  const cond =
    last.mode === 'exact'
      ? `${col} = ${lit(last.q)}`
      : last.mode === 'starts'
        ? `${col} LIKE ${lit(like + '%')}`
        : last.mode === 'regex'
          ? `${q(column)} REGEXP ${lit((last.caseSensitive ? '(?-i)' : '(?i)') + last.q)}`
          : `${col} LIKE ${lit('%' + like + '%')}`;
  return `SELECT *\nFROM ${q(h.db)}.${q(h.table)}\nWHERE ${cond}\nLIMIT 100`;
}
