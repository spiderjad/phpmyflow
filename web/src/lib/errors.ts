import type { ApiErrorBody, SchemaMap } from './api';
import { t } from './i18n.svelte';

export { closest, distance } from './levenshtein';
import { closest } from './levenshtein';

export const allColumns = (schema: SchemaMap) =>
  new Set(Object.values(schema).flatMap((tb) => tb.columns.map((c) => c.name)));

export interface FriendlyError {
  title: string;
  hint: string | null;
  suggestion: string | null;
  raw: string;
  /** HTTP status + start of the body or incident id, for "Show technical details". */
  technical?: string | null;
  /** MySQL error number, when it is a server SQL error. */
  mysqlCode?: number;
  /** Server "near '…'" text (syntax errors). */
  near?: string;
  /** Offending name (column / table) when the server reports one. */
  name?: string;
}

// MySQL/MariaDB error numbers we explain in plain words.
const KNOWN_MYSQL = new Set([1005, 1215, 1822, 3780, 1044, 1045, 1048, 1052, 1054, 1055, 1062, 1064, 1142, 1146, 1149, 1216, 1217, 1364, 1366, 1406, 1451, 1452]);

/** "Show technical details": HTTP status and the start of what came back, or the incident id. */
export function technicalDetail(err: ApiErrorBody): string | null {
  const d = (err.details ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (d.status !== undefined) parts.push(`HTTP ${d.status}`);
  if (err.code) parts.push(`code: ${err.code}`);
  if (d.incident) parts.push(`incident: ${d.incident}`);
  if (typeof d.body === 'string' && d.body.trim()) parts.push('', d.body);
  return d.status !== undefined || d.incident ? parts.join('\n') : null;
}

export function friendlyError(err: ApiErrorBody, schema: SchemaMap = {}): FriendlyError {
  const d = (err.details ?? {}) as Record<string, any>;
  const raw = (d.serverMessage as string) ?? err.message;

  if (err.code !== 'sql_error') {
    const key = `error.${err.code}`;
    const title = t(key, { limit: String(d.limit ?? '') });
    // The server logged the detail under this id (server/src/Guard.php).
    const hint = d.incident ? t('error.incident', { id: String(d.incident) }) : null;
    return { title: title === key ? err.message : title, hint, suggestion: null, raw, technical: technicalDetail(err) };
  }

  const code = Number(d.mysqlCode);
  // 1055 reports db.table.column: show the short form.
  const shortName = code === 1055 && d.name ? String(d.name).split('.').slice(-2).join('.') : (d.name ?? '');
  const params = { name: shortName, near: d.near ?? '', line: d.line ?? '', ref: d.ref ?? '' };
  const title = KNOWN_MYSQL.has(code) ? t(`mysql.${code}`, params) : t('error.sql_error');
  const hintKey = `mysql.${code}.hint`;
  const hint = t(hintKey, params);

  let suggestion: string | null = null;
  if (code === 1054 && d.name) {
    const bare = String(d.name).split('.').pop()!;
    suggestion = closest(bare, allColumns(schema));
  } else if (code === 1146 && d.name) {
    suggestion = closest(String(d.name), Object.keys(schema));
  }

  return { title, hint: hint === hintKey ? null : hint, suggestion, raw, mysqlCode: code, near: d.near, name: d.name };
}
