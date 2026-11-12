// Grid exports meant for spreadsheets (CSV download, multi-cell copy as TSV)
// never hand a spreadsheet a live formula from database text: a cell starting
// with = + - @ tab or CR gets a leading "'". Numbers stay numbers, and a
// single copied cell keeps its exact value.
import { describe, expect, it } from 'vitest';
import { toCsv } from '../../web/src/lib/grid';
import { toTsv } from '../../web/src/lib/serialize';

const evil = ['=HYPERLINK("http://x","y")', '+1+cmd|"/c calc"!A0', '-2+3', '@SUM(1)', '\t=1', '\r=1'];

describe('spreadsheet formulas from database text', () => {
  it('CSV neutralizes formula cells and headers', () => {
    const csv = toCsv([{ name: '=hdr' }], evil.map((v) => [v]));
    const cells = csv.split('\r\n').map((l) => l.replace(/^"|"$/g, ''));
    for (const c of cells) expect(c.startsWith("'")).toBe(true);
  });

  it('TSV (several cells) neutralizes formula cells', () => {
    const tsv = toTsv([{ name: 's', numeric: false }, { name: 'n', numeric: true }], evil.map((v) => [v, 1]), 'en');
    const first = tsv.split('\r\n').slice(1).map((l) => l.split('\t')[0].replace(/^"|"$/g, ''));
    for (const c of first) expect(c.startsWith("'")).toBe(true);
  });

  it('numbers, plain text and a single copied cell are unchanged', () => {
    expect(toCsv([{ name: 'n' }], [['-5'], ['+3.5'], ['-1e3'], ['hello'], [-7]])).toBe('n\r\n-5\r\n+3.5\r\n-1e3\r\nhello\r\n-7');
    expect(toTsv([{ name: 'n', numeric: true }, { name: 's', numeric: false }], [['-5', 'a-b']], 'en')).toBe('n\ts\r\n-5\ta-b');
    expect(toTsv([{ name: 's', numeric: false }], [['=1+1']], 'en')).toBe('=1+1');
  });
});
