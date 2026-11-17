// The order tables have in the sidebar, shared by the sidebar itself and by
// Alt+Up / Alt+Down (previous / next table): sorted by name, rows or size,
// one block per shared prefix ("sap_", "cfg_", biggest first) when grouping
// is on, views last.
import type { TableInfo } from './api';
import { prefixGroups } from './fuzzy';
import type { TableSort } from './prefs.svelte';

export function sortTables<T extends Pick<TableInfo, 'name' | 'approxRows' | 'bytes'>>(tables: T[], sort: TableSort): T[] {
  const list = [...tables];
  if (sort === 'size') list.sort((a, b) => Number(b.bytes ?? 0) - Number(a.bytes ?? 0) || a.name.localeCompare(b.name));
  else if (sort === 'rows') list.sort((a, b) => Number(b.approxRows ?? 0) - Number(a.approxRows ?? 0) || a.name.localeCompare(b.name));
  return list;
}

export function displayOrder(tables: TableInfo[], sort: TableSort, groupPrefix: boolean): string[] {
  const sorted = sortTables(tables, sort);
  const plain = sorted.filter((tb) => tb.type !== 'VIEW');
  const views = sorted.filter((tb) => tb.type === 'VIEW').map((tb) => tb.name);
  const groups = groupPrefix ? prefixGroups(tables.filter((tb) => tb.type !== 'VIEW'), (tb) => tb.name) : null;
  if (!groups) return [...plain.map((tb) => tb.name), ...views];
  const groupOf = new Map(groups.flatMap((g) => g.items.map((tb) => [tb.name, g.prefix] as const)));
  return [...groups.flatMap((g) => plain.filter((tb) => groupOf.get(tb.name) === g.prefix).map((tb) => tb.name)), ...views];
}

/** The table before / after `current` in that order (wraps around); '' when there is none. */
export function stepTable(order: string[], current: string, dir: 1 | -1): string {
  if (!order.length) return '';
  const i = order.indexOf(current);
  if (i === -1) return dir === 1 ? order[0] : order[order.length - 1];
  return order[(i + dir + order.length) % order.length];
}
