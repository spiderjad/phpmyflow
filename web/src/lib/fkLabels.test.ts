import { describe, expect, it } from 'vitest';
import { applyLabels, cellLabel, collectRefs, type Link } from './fkLabels';

const planta: Link = { to: 'plantas', toColumn: 'id', kind: 'inferred' };
const depto: Link = { to: 'departamentos', toColumn: 'id', kind: 'inferred' };

describe('collectRefs: one request per page', () => {
  it('distinct ids per related column, nulls skipped, same target shared', () => {
    const rows = [
      [1, 'Producción', 1, 3],
      [2, 'Calidad', 1, null],
      [3, 'Mantenimiento', 2, 3],
      [4, 'Otro', null, 4],
    ];
    const links = [undefined, undefined, planta, depto];
    expect(collectRefs(rows, links)).toEqual([
      { table: 'plantas', column: 'id', ids: ['1', '2'] },
      { table: 'departamentos', column: 'id', ids: ['3', '4'] },
    ]);
    // Two columns to the same table.column: one ref with both sets of ids.
    expect(collectRefs([[1, 2]], [planta, planta])).toEqual([{ table: 'plantas', column: 'id', ids: ['1', '2'] }]);
    expect(collectRefs([[1]], [undefined])).toEqual([]);
  });
  it('caps ids at 500 per column', () => {
    const rows = Array.from({ length: 700 }, (_, i) => [i + 1]);
    expect(collectRefs(rows, [planta])[0].ids).toHaveLength(500);
  });
});

describe('labels in cells', () => {
  const cols = applyLabels([undefined, planta], { 'plantas.id': { '1': { label: 'Planta Norte' } } });
  it('"Planta Norte · 1", a broken reference, or the raw value', () => {
    expect(cellLabel(1, cols[1])).toEqual({ kind: 'label', label: 'Planta Norte', id: '1' });
    expect(cellLabel(99, cols[1])).toEqual({ kind: 'broken', id: '99' });
    expect(cellLabel(null, cols[1])).toEqual({ kind: 'raw' });
    expect(cellLabel(1, cols[0])).toEqual({ kind: 'raw' });
    // Not resolved yet: show the id meanwhile.
    expect(cellLabel(1, { done: false, map: {} })).toEqual({ kind: 'raw' });
  });
});
