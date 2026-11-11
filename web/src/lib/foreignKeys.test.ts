import { describe, expect, it } from 'vitest';
import { fkSignature, polymorphicIds } from './foreignKeys';

const fk = { columns: ['items_id'], refTable: 'glpi_apiclients', refColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'CASCADE' };

describe('fkSignature (live checks only trust results for the FK as it is now)', () => {
  it('changes when the target, columns, rules or local column type change', () => {
    const base = fkSignature(fk, { items_id: { type: 'int', unsigned: true } });
    expect(fkSignature({ ...fk, refTable: 'glpi_users' }, { items_id: { type: 'int', unsigned: true } })).not.toBe(base);
    expect(fkSignature({ ...fk, refColumns: [] }, { items_id: { type: 'int', unsigned: true } })).not.toBe(base);
    expect(fkSignature({ ...fk, onDelete: 'CASCADE' }, { items_id: { type: 'int', unsigned: true } })).not.toBe(base);
    expect(fkSignature(fk, { items_id: { type: 'bigint', unsigned: true } })).not.toBe(base);
    expect(fkSignature({ ...fk }, { items_id: { type: 'int', unsigned: true }, other: 1 })).toBe(base);
  });
});

describe('polymorphicIds', () => {
  it('lists the id columns of one table', () => {
    const list = [
      { table: 'glpi_alerts', typeColumn: 'itemtype', idColumn: 'items_id' },
      { table: 'glpi_logs', typeColumn: 'itemtype', idColumn: 'items_id' },
    ];
    expect([...polymorphicIds(list, 'glpi_alerts')]).toEqual(['items_id']);
    expect(polymorphicIds(list, 'orders').size).toBe(0);
  });
});
