import { expect, test, type Page } from '@playwright/test';
import { login, pickDb } from './helpers';

/** Key icons in the grid header (and the same ones in Structure). */

async function sql(page: Page, statement: string) {
  const session = await (await page.request.get('api.php?a=session')).json();
  return (await page.request.post('api.php?a=query', { headers: { 'X-CSRF-Token': session.csrf }, data: { db: 'shop', sql: statement, confirm: true } })).json();
}

test.beforeEach(async ({ page }) => {
  await login(page);
  await sql(page, 'DROP TABLE IF EXISTS e2e_keys');
  await sql(page, `CREATE TABLE e2e_keys (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    email VARCHAR(120) NOT NULL,
    customer_id INT UNSIGNED NULL,
    note VARCHAR(20) NULL,
    UNIQUE KEY uq_tenant_email (tenant_id, email),
    KEY idx_email (email),
    CONSTRAINT fk_e2e_keys_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
  ) ENGINE=InnoDB`);
  await sql(page, "INSERT INTO e2e_keys (tenant_id, email, customer_id) VALUES (1, 'a@x.com', 1)");
  await page.reload();
  await pickDb(page, 'shop');
});
test.afterEach(async ({ page }) => {
  await sql(page, 'DROP TABLE IF EXISTS e2e_keys');
});

const header = (page: Page, column: string) => page.locator('table.dg thead th').filter({ has: page.getByRole('button', { name: `Select column ${column}` }) });

test('PK, U, I and FK icons with their tooltip; a click opens the index in Structure', async ({ page }) => {
  await page.locator('nav.tables button[data-table="e2e_keys"]').click();
  await expect(page.locator('table.dg')).toBeVisible();

  const id = header(page, 'id').locator('.th-key');
  await expect(id).toHaveText(['PK']);
  await expect(id.first()).toHaveAttribute('title', 'Primary key');

  const email = header(page, 'email').locator('.th-key');
  await expect(email).toHaveText(['U 2/2', 'I']);
  await expect(email.first()).toHaveAttribute('title', 'Unique: uq_tenant_email, column 2 of 2 (tenant_id, email)');
  await expect(email.nth(1)).toHaveAttribute('title', 'Index: idx_email');

  const customer = header(page, 'customer_id').locator('.th-key');
  await expect(customer.last()).toHaveText('customers');
  await expect(customer.last()).toHaveAttribute('title', 'Foreign key → customers.id (fk_e2e_keys_customer)');
  await expect(header(page, 'note').locator('.th-key')).toHaveCount(0);

  // Click: Structure, with that index shown and focused.
  await email.first().click();
  await expect(page.getByRole('button', { name: 'Structure' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.idx-row:focus')).toContainText('uq_tenant_email');
  // The same icons in the Structure column table.
  await expect(page.locator('[data-col="email"] .c-keys .key')).toHaveText(['U 2/2', 'I']);
  await expect(page.locator('[data-col="id"] .c-keys .key')).toHaveText(['PK']);
});

test('an inferred relation shows a dashed arrow (departamentos.id_planta → plantas)', async ({ page }) => {
  await page.locator('nav.tables button[data-table="departamentos"]').click();
  const k = header(page, 'id_planta').locator('.th-key');
  await expect(k).toHaveText(['plantas']);
  await expect(k.first()).toHaveAttribute('title', 'Inferred relation → plantas.id (from the column name, not declared)');
  await expect(k.first().locator('.ki-inferred')).toBeVisible();
});
