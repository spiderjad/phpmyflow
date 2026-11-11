import type { Cell } from './api';
import { n, t } from './i18n.svelte';

const NUMERIC = /^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|bit|year|long|longlong|newdecimal|short|tiny|int24)$/i;

export const isNumericType = (type: string) => NUMERIC.test(type.split('(')[0].trim());

export function cellText(value: Cell): string {
  if (value === null) return 'NULL';
  if (typeof value === 'object') return t('grid.binary', { size: n(value.$binary) });
  return String(value);
}

export function cellClass(value: Cell, numeric: boolean): string {
  if (value === null || typeof value === 'object') return 'cell-null';
  return numeric ? 'cell-num' : '';
}
