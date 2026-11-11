import { describe, expect, it } from 'vitest';
import { checkStatement, tableRefs } from '../sqlRules';

const errors = (sql: string) => checkStatement(sql).filter((d) => d.severity === 'error').map((d) => d.rule);

describe('sqlRules: aliases', () => {
  it('parenthesized joins define their aliases (MariaDB stored view bodies)', () => {
    const body = "select `o`.`id` AS `id`,`c`.`name` AS `customer` from (`orders` `o` join `customers` `c` on(`c`.`id` = `o`.`customer_id`)) where `o`.`status` = 'paid'";
    expect(errors(body)).toEqual([]);
    expect(tableRefs(body)).toEqual([
      { table: 'orders', alias: 'o' },
      { table: 'customers', alias: 'c' },
    ]);
  });
  it('derived tables keep working', () => {
    expect(errors('SELECT x.id FROM (SELECT id FROM orders) AS x')).toEqual([]);
    expect(errors('SELECT y.id FROM (SELECT id FROM orders) AS x')).toContain('unknown-alias');
  });
});
