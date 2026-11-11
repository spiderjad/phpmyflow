import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/** RecordPicker against a related table with 1,500 rows: never the whole table. */

async function sql(page: Page, statement: string) {
  const session = await (await page.request.get('api.php?a=session')).json();
  return (await page.request.post('api.php?a=query', { headers: { 'X-CSRF-Token': session.csrf }, data: { db: 'shop', sql: statement, confirm: true } })).json();
}

test.beforeEach(async ({ page }) => {
  await login(page);
  await sql(page, 'DROP TABLE IF EXISTS articulos');
  await sql(page, 'DROP TABLE IF EXISTS sectores');
  await sql(page, 'CREATE TABLE sectores (id INT UNSIGNED PRIMARY KEY, nombre VARCHAR(80) NOT NULL, codigo VARCHAR(20) NULL, KEY (nombre))');
  const values = Array.from({ length: 1500 }, (_, i) => `(${i + 1}, 'Sector ${i + 1}', 'S-${i + 1}')`);
  values.push("(2001, 'Mantenimiento', 'MNT-01')", "(2002, 'Jefe de mantenimiento', 'JM-01')");
  await sql(page, `INSERT INTO sectores VALUES ${values.join(',')}`);
  await sql(page, 'CREATE TABLE articulos (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(40) NOT NULL, id_sector INT UNSIGNED NULL)');
  await page.reload();
});
test.afterEach(async ({ page }) => {
  await sql(page, 'DROP TABLE IF EXISTS articulos');
  await sql(page, 'DROP TABLE IF EXISTS sectores');
});

test('1,500 related rows: 20 shown with "more", prefix first, exact id first, search by code', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('a=lookup&')) calls.push(r.url());
  });
  await page.locator('nav.tables button[data-table="articulos"]').click();
  await page.getByRole('button', { name: '+ Add row' }).click();
  const drawer = page.getByRole('dialog', { name: 'New row in articulos' });
  const picker = drawer.getByRole('combobox', { name: 'id_sector: record of sectores' });
  await picker.click();
  const options = drawer.getByRole('option');
  await expect(options).toHaveCount(21); // "None (NULL)" + 20
  await expect(drawer.getByRole('status')).toContainText('More than 20 matches');

  await picker.fill('mant');
  await expect(options).toHaveCount(3);
  await expect(options.nth(1)).toContainText('2001 · Mantenimiento');
  await expect(options.nth(2)).toContainText('2002 · Jefe de mantenimiento');
  await expect(drawer.getByRole('status')).toHaveCount(0);

  await picker.fill('150');
  await expect(options.nth(1)).toContainText('150 · Sector 150');

  await picker.fill('JM-');
  await expect(options).toHaveCount(2);
  await expect(options.nth(1)).toContainText('2002 · Jefe de mantenimiento JM-01');
  await options.nth(1).click();
  await drawer.locator('#ins-1').fill('E2E');
  await drawer.getByRole('button', { name: 'Save row' }).click();
  await expect(drawer).toHaveCount(0);
  const r = await sql(page, "SELECT id_sector FROM articulos WHERE name = 'E2E'");
  expect(Number(r.rows[0][0])).toBe(2002);
  // Every search is server-side and small: no request asks for more than 20.
  expect(calls.every((u) => !/limit=\d{3,}/.test(u))).toBe(true);
});
