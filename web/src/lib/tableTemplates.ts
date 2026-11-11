// "New table" starting points. Structured specs only: the server builds the
// CREATE TABLE (Ddl::createTable). After creating, the table opens in the
// Structure tab to keep editing.
import { blankColumn, type ColumnDef } from './columnTypes';
import type { TableSpec } from './dbApi';

export type TemplateId = 'blank' | 'catalog' | 'people' | 'orders' | 'log' | 'link';
export const TEMPLATES: TemplateId[] = ['blank', 'catalog', 'people', 'orders', 'log', 'link'];

const col = (name: string, patch: Partial<ColumnDef>): ColumnDef => ({ ...blankColumn(name), ...patch });
const id = () => col('id', { type: 'int', length: null, unsigned: true, nullable: false, autoIncrement: true });
const ref = (name: string, nullable = false) => col(name, { type: 'int', length: null, unsigned: true, nullable });
const text = (name: string, length = 255, nullable = false) => col(name, { type: 'varchar', length, nullable });
const createdAt = () => col('created_at', { type: 'timestamp', length: null, nullable: false, default: { kind: 'now' } });
const updatedAt = () => col('updated_at', { type: 'timestamp', length: null, nullable: true, default: { kind: 'null' }, onUpdateNow: true });
const bool = (name: string, on: boolean) => col(name, { type: 'tinyint', length: 1, nullable: false, default: { kind: 'value', value: on ? '1' : '0' } });

/**
 * Build the spec for a template. `a` and `b` are the two linked tables of the
 * N:M template (each with an `id` primary key).
 */
export function templateSpec(tpl: TemplateId, name: string, link?: { a: string; b: string }): TableSpec {
  const base: TableSpec = { name, columns: [id()], primary: ['id'], indexes: [], foreignKeys: [], engine: 'InnoDB' };
  switch (tpl) {
    case 'blank':
      return base;
    case 'catalog':
      return {
        ...base,
        columns: [id(), text('name', 150), col('description', { type: 'text', length: null, nullable: true, default: { kind: 'null' } }), bool('is_active', true), col('sort_order', { type: 'int', length: null, nullable: false, default: { kind: 'value', value: '0' } }), createdAt(), updatedAt()],
        indexes: [{ kind: 'UNIQUE', name: 'uq_name', columns: ['name'] }],
      };
    case 'people':
      return {
        ...base,
        columns: [id(), text('name', 150), text('email', 190), text('phone', 30, true), bool('is_active', true), createdAt(), updatedAt()],
        indexes: [{ kind: 'UNIQUE', name: 'uq_email', columns: ['email'] }],
      };
    case 'orders':
      return {
        ...base,
        columns: [
          id(),
          ref('customer_id'),
          col('status', { type: 'enum', length: null, values: ['draft', 'paid', 'shipped', 'cancelled'], nullable: false, default: { kind: 'value', value: 'draft' } }),
          col('total', { type: 'decimal', length: 12, scale: 2, nullable: false, default: { kind: 'value', value: '0' } }),
          col('notes', { type: 'text', length: null, nullable: true, default: { kind: 'null' } }),
          createdAt(),
          updatedAt(),
        ],
        indexes: [
          { kind: 'INDEX', name: 'idx_customer_id', columns: ['customer_id'] },
          { kind: 'INDEX', name: 'idx_status', columns: ['status'] },
        ],
      };
    case 'log':
      return {
        ...base,
        columns: [
          col('id', { type: 'bigint', length: null, unsigned: true, nullable: false, autoIncrement: true }),
          text('level', 10),
          text('message', 1000),
          col('context', { type: 'json', length: null, nullable: true, default: { kind: 'null' } }),
          col('created_at', { type: 'datetime', length: 3, nullable: false, default: { kind: 'now' } }),
        ],
        indexes: [{ kind: 'INDEX', name: 'idx_created_at', columns: ['created_at'] }],
      };
    case 'link': {
      const a = link?.a ?? 'a';
      const b = link?.b ?? 'b';
      const ca = `${singular(a)}_id`;
      const cb = `${singular(b)}_id`;
      return {
        name,
        columns: [ref(ca), ref(cb), createdAt()],
        primary: [ca, cb],
        indexes: [{ kind: 'INDEX', name: `idx_${cb}`.slice(0, 64), columns: [cb] }],
        foreignKeys: [
          { name: `fk_${name}_${ca}`.slice(0, 64), columns: [ca], refTable: a, refColumns: ['id'], onDelete: 'CASCADE', onUpdate: 'CASCADE' },
          { name: `fk_${name}_${cb}`.slice(0, 64), columns: [cb], refTable: b, refColumns: ['id'], onDelete: 'CASCADE', onUpdate: 'CASCADE' },
        ],
        engine: 'InnoDB',
      };
    }
  }
}

/** customers -> customer, categories -> category (for link columns). */
export function singular(table: string): string {
  const s = table;
  if (/ies$/i.test(s)) return s.slice(0, -3) + 'y';
  if (/(ss|us)$/i.test(s)) return s;
  if (/(x|ch|sh)es$/i.test(s)) return s.slice(0, -2);
  if (/s$/i.test(s)) return s.slice(0, -1);
  return s;
}
