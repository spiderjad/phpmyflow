// Copy / export actions shared by DataGrid (selection) and the SQL result
// bar ("Copy result"). Text formats live in serialize.ts; .xlsx is loaded
// on demand so it never weighs on the first load.
import type { Cell } from './api';
import { copyText, downloadBlob, fileName } from './clipboard';
import { columnKind, type GridColumn } from './grid';
import { i18n, n, t } from './i18n.svelte';
import { columnNames, toCsvText, toInList, toInsert, toJson, toMarkdown, toTsv, type SerialColumn } from './serialize';
import { toast } from './ui.svelte';

export type CopyFormat = 'tsv' | 'json' | 'csv' | 'markdown' | 'insert' | 'in' | 'names';
export type ExportFormat = 'xlsx' | 'csv' | 'json';

type Values = (Cell | undefined)[][];

export const serialColumns = (cols: GridColumn[]): SerialColumn[] => cols.map((c) => ({ name: c.name, numeric: columnKind(c.type) === 'number' }));

export function formatText(format: CopyFormat, cols: GridColumn[], values: Values, table = ''): string {
  const sc = serialColumns(cols);
  switch (format) {
    case 'tsv':
      return toTsv(sc, values, i18n.locale);
    case 'json':
      return toJson(sc, values);
    case 'csv':
      return toCsvText(sc, values);
    case 'markdown':
      return toMarkdown(sc, values);
    case 'insert':
      return toInsert(table, sc, values);
    case 'in':
      return toInList(sc[0], values.map((r) => r[0]));
    case 'names':
      return columnNames(sc);
  }
}

export async function copyAs(format: CopyFormat, cols: GridColumn[], values: Values, table = '') {
  if (!cols.length) return;
  const ok = await copyText(formatText(format, cols, values, table));
  if (!ok) {
    toast(t('copy.failed'), 'error');
    return;
  }
  const single = values.length === 1 && cols.length === 1 && format === 'tsv';
  toast(single ? t('copy.cell') : format === 'names' ? t('copy.names') : t('copy.rows', { count: n(values.length) }), 'success', 1800);
}

export async function exportAs(format: ExportFormat, cols: GridColumn[], values: Values, base: string) {
  if (!cols.length) return;
  if (format === 'xlsx') {
    try {
      const { xlsxBlob } = await import('./xlsx');
      const kinds = cols.map((c) => {
        const k = columnKind(c.type);
        return k === 'number' ? 'number' : k === 'date' ? 'date' : k === 'datetime' ? 'datetime' : 'text';
      }) as ('number' | 'date' | 'datetime' | 'text')[];
      const widths = cols.map((c, j) => Math.max(c.name.length, ...values.slice(0, 50).map((r) => String(r[j] ?? '').length)) + 2);
      downloadBlob(
        xlsxBlob(
          cols.map((c, j) => ({ name: c.name, kind: kinds[j], width: widths[j] })),
          values,
          base || 'result',
        ),
        fileName(base, 'xlsx'),
      );
    } catch {
      toast(t('export.failed'), 'error');
      return;
    }
  } else if (format === 'csv') {
    downloadBlob(new Blob(['﻿' + formatText('csv', cols, values)], { type: 'text/csv;charset=utf-8' }), fileName(base, 'csv'));
  } else {
    downloadBlob(new Blob([formatText('json', cols, values)], { type: 'application/json' }), fileName(base, 'json'));
  }
  toast(t('export.done', { count: n(values.length) }), 'success', 2200);
}
