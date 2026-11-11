import { expect, test, type Page } from '@playwright/test';
import { login, pickDb } from './helpers';

/** Phase C: server-wide search, test data with a foreign key, OPTIMIZE. */

async function sql(page: Page, statement: string) {
  const session = await (await page.request.get('api.php?a=session')).json();
  return (await page.request.post('api.php?a=query', { headers: { 'X-CSRF-Token': session.csrf }, data: { db: 'shop', sql: statement, confirm: true } })).json();
}

test.beforeEach(async ({ page }) => {
  await login(page);
  await sql(page, 'DROP TABLE IF EXISTS e2e_gen');
});
test.afterEach(async ({ page }) => {
  await sql(page, 'DROP TABLE IF EXISTS e2e_gen');
});

test('search "Rossi" in the whole server, open the table filtered', async ({ page }) => {
  await page.keyboard.press('Control+Shift+F');
  await expect(page.getByRole('heading', { name: 'Search text' })).toBeVisible();
  await page.getByLabel('Text to search').fill('Rossi');
  await page.getByLabel('The whole server').check();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  // Wait until every table was searched (the whole server can take a while).
  await expect(page.locator('.sv .status')).toContainText(/matches in \d+ tables/, { timeout: 60_000 });
  const hit = page.locator('.hit', { hasText: 'shop.customers' });
  await expect(hit).toContainText('name');
  await expect(hit).toContainText('1 row');
  await hit.getByRole('button', { name: 'Open filtered' }).click();
  await expect(page.locator('table.dg td', { hasText: 'Marco Rossi' })).toBeVisible();
});

test('generate 500 rows in a table with a foreign key', async ({ page }) => {
  await sql(page, `CREATE TABLE e2e_gen (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, customer_id INT UNSIGNED NOT NULL, email VARCHAR(80) NOT NULL UNIQUE,
    amount DECIMAL(8,2) NOT NULL, status ENUM('new','paid') NOT NULL, created_at DATETIME NOT NULL,
    CONSTRAINT fk_e2e_gen_customer FOREIGN KEY (customer_id) REFERENCES customers (id)) ENGINE=InnoDB`);
  await page.reload();
  await pickDb(page, 'shop');
  await page.locator('nav.tables button[data-table="e2e_gen"]').click({ button: 'right' });
  await page.locator('[data-id="generate"]').click();
  const dlg = page.getByRole('dialog', { name: 'Generate test data in shop' });
  await expect(dlg.locator('.rt tbody tr')).toHaveCount(10); // preview
  await expect(dlg.getByRole('button', { name: 'Generator for customer_id' })).toContainText('Existing id → customers.id');
  await dlg.getByLabel('Rows (1 to 100,000)').fill('500');
  await dlg.getByRole('button', { name: 'Insert 500 rows' }).click();
  await expect(page.locator('.job', { hasText: 'Generate 500 rows in e2e_gen' })).toHaveClass(/done/, { timeout: 30_000 });
  const r = await sql(page, 'SELECT COUNT(*), COUNT(DISTINCT email), SUM(customer_id NOT IN (SELECT id FROM customers)) FROM e2e_gen');
  expect(r.rows[0].map(Number)).toEqual([500, 500, 0]);
});

test('OPTIMIZE two tables shows a result per table', async ({ page }) => {
  await page.locator('.db-head .more').click();
  await page.locator('[data-id="maintenance"]').click();
  const dlg = page.getByRole('dialog', { name: 'Maintenance in shop' });
  await dlg.getByRole('radio', { name: 'OPTIMIZE' }).click();
  await expect(dlg).toContainText('rebuilds the table');
  await dlg.getByLabel('orders', { exact: true }).check();
  await dlg.getByLabel('customers', { exact: true }).check();
  await dlg.getByRole('button', { name: 'Run OPTIMIZE' }).click();
  const job = page.locator('.job', { hasText: 'OPTIMIZE on 2 tables' });
  await expect(job).toHaveClass(/done/, { timeout: 30_000 });
  const rows = job.locator('.rtable tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('OK');
});
