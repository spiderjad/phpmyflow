import { describe, expect, it } from 'vitest';
import { clone, diff, revertChange, type TableModel } from './tableDraft';

const col = (name: string, extra: Partial<TableModel['columns'][number]> = {}) =>
  ({
    id: `c_${name}`,
    orig: name,
    name,
    type: 'int',
    length: null,
    scale: null,
    unsigned: true,
    nullable: false,
    default: { kind: 'none' },
    autoIncrement: false,
    collation: null,
    comment: '',
    generated: null,
    values: [],
    ...extra,
  }) as unknown as TableModel['columns'][number];

function original(): TableModel {
  return {
    name: 'glpi_alerts',
    comment: '',
    engine: 'InnoDB',
    collation: 'utf8mb4_unicode_ci',
    autoIncrement: null,
    columns: [col('id'), col('items_id'), col('type')],
    indexes: [{ id: 'i1', orig: 'type', name: 'type', kind: 'INDEX', columns: ['type'] }],
    fks: [],
    checks: [{ id: 'k1', orig: 'chk_type', name: 'chk_type', expr: 'type >= 0' }],
  };
}

describe('revertChange (remove the change that failed, keep the rest)', () => {
  it('removes a new FK and leaves the other pending changes', () => {
    const o = original();
    const d = clone(o);
    d.comment = 'Alerts';
    d.fks.push({ id: 'f1', orig: null, name: 'fk_alerts_items_id', columns: ['items_id'], refTable: 'glpi_apiclients', refColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
    expect(revertChange(d, o, { kind: 'fk', name: 'FK_ALERTS_ITEMS_ID' })).toBe(true);
    expect(d.fks).toEqual([]);
    const c = diff(o, d);
    expect(c.foreignKeys).toEqual([]);
    expect(c.table.comment).toBe('Alerts');
  });

  it('puts a modified check or column back to its original', () => {
    const o = original();
    const d = clone(o);
    d.checks[0].expr = 'type > 100';
    d.columns[2].nullable = true;
    expect(revertChange(d, o, { kind: 'check', name: 'chk_type' })).toBe(true);
    expect(d.checks[0]).toEqual(o.checks[0]);
    expect(revertChange(d, o, { kind: 'column', name: 'type' })).toBe(true);
    expect(d.columns[2]).toEqual(o.columns[2]);
  });

  it('removes a new index and reports unknown names', () => {
    const o = original();
    const d = clone(o);
    d.indexes.push({ id: 'i2', orig: null, name: 'uq_items', kind: 'UNIQUE', columns: ['items_id'] });
    expect(revertChange(d, o, { kind: 'index', name: 'uq_items' })).toBe(true);
    expect(d.indexes.map((i) => i.name)).toEqual(['type']);
    expect(revertChange(d, o, { kind: 'fk', name: 'nope' })).toBe(false);
  });
});
