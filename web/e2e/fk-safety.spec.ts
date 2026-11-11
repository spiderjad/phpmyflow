import { expect, test, type Page } from '@playwright/test';
import { login, pickDb } from './helpers';

/**
 * Regression for a real GLPI case: a FK created from the UI on a column with
 * orphan rows reached MySQL and failed with 1452, with only a generic message.
 * Now the review blocks it, and a failed ALTER explains itself.
 */

/** Run one statement through the API (same session as the page). */
async function sql(page: Page, statement: string) {
  const session = await (await page.request.get('api.php?a=session')).json();
  const r = await page.request.post('api.php?a=query', {
    headers: { 'X-CSRF-Token': session.csrf },
    data: { db: 'shop', sql: statement, confirm: true },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
}

async function openStructure(page: Page, table: string) {
  await page.locator(`nav.tables button[data-table="${table}"]`).click();
  await page.getByRole('button', { name: 'Structure', exact: true }).click();
  await page.locator('#fk-title').waitFor();
}

/** "+ Foreign key" picks the first *_id column; choose the target table. */
async function addFkTo(page: Page, target: string) {
  await page.getByRole('button', { name: '+ Foreign key' }).first().click();
  const row = page.locator('.fk-grid [role=row]').last();
  await row.locator('.chips-btn').nth(1).click();
  await page.getByPlaceholder('Search table…').fill(target);
  await page.locator('.opt[role=option]', { hasText: target }).first().click();
}

test.beforeEach(async ({ page }) => {
  await login(page);
  await sql(page, 'DROP TABLE IF EXISTS e2e_fk_child');
  await sql(page, 'CREATE TABLE e2e_fk_child (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, product_id INT UNSIGNED NOT NULL) ENGINE=InnoDB');
  // Reload the schema so the sidebar lists the new table.
  await page.reload();
  await pickDb(page, 'shop');
});

test.afterEach(async ({ page }) => {
  await sql(page, 'DROP TABLE IF EXISTS e2e_fk_child');
});

test('polymorphic pair: shown in Relations with its types, never offered as a FK', async ({ page }) => {
  await page.locator('nav.tables button[data-table="activity_log"]').click();
  await page.getByRole('button', { name: 'Relations', exact: true }).click();
  const poly = page.locator('section.poly');
  await expect(poly).toContainText('Polymorphic: itemtype + items_id');
  await expect(poly.locator('.chip')).toHaveText(['Customer', 'Order', 'Product']);
  await expect(page.getByRole('button', { name: 'Create foreign key' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Structure', exact: true }).click();
  await page.locator('#fk-title').waitFor();
  await expect(page.getByRole('button', { name: 'Link to a table?' })).toHaveCount(0);
  await expect(page.getByText('See 1 suggested', { exact: false })).toHaveCount(0);
});

test('a FK with orphan rows keeps Apply disabled until there is a decision', async ({ page }) => {
  await sql(page, 'INSERT INTO e2e_fk_child (product_id) VALUES (1), (99), (98)');
  await openStructure(page, 'e2e_fk_child');
  await addFkTo(page, 'products');

  await page.getByRole('button', { name: 'Review and apply' }).click();
  const drawer = page.locator('.drawer');
  await expect(drawer).toContainText('2 rows of e2e_fk_child have product_id with no match in products.id. (e.g. 98, 99)');
  const apply = drawer.getByRole('button', { name: /^Apply/ });
  await expect(apply).toBeDisabled();
  await expect(drawer.getByRole('button', { name: 'Set NULL on those rows' })).toBeDisabled(); // NOT NULL column

  await drawer.getByRole('button', { name: 'Remove this FK from the changes' }).click();
  await expect(page.locator('.fk-grid')).toHaveCount(0);
});

test('a failed ALTER says nothing was applied, and "remove this change and retry" keeps the rest', async ({ page }) => {
  await sql(page, 'INSERT INTO e2e_fk_child (product_id) VALUES (1), (2)');
  await openStructure(page, 'e2e_fk_child');
  await page.getByLabel('Table description').fill('Child rows');
  await page.getByLabel('Table description').press('Tab');
  await addFkTo(page, 'products');

  // The review re-validates when the draft changes (debounced 300 ms): wait until
  // no preview is pending, so the orphan below lands after the last check.
  let pending = 0;
  page.on('request', (r) => { if (r.url().includes('a=alter_preview')) pending++; });
  page.on('requestfinished', (r) => { if (r.url().includes('a=alter_preview')) pending--; });
  await page.getByRole('button', { name: 'Review and apply' }).click();
  const drawer = page.locator('.drawer');
  const apply = drawer.getByRole('button', { name: /^Apply/ });
  await expect(apply).toBeEnabled();
  await page.waitForTimeout(700);
  await expect.poll(() => pending).toBe(0);
  await expect(apply).toBeEnabled();

  // Someone writes an orphan row between the review and Apply: MySQL answers 1452.
  await sql(page, 'INSERT INTO e2e_fk_child (product_id) VALUES (777)');
  await apply.click();
  const failure = drawer.locator('.failure');
  await expect(failure).toContainText('No change was applied');
  await expect(failure).toContainText('Your pending changes are still here');
  await expect(failure).toContainText('1 row of e2e_fk_child has product_id with no match in products.id. (e.g. 777)');
  await expect(failure.getByRole('button', { name: 'View rows' })).toBeVisible();

  await failure.getByRole('button', { name: /Remove this change \(fk_.*\) and retry/ }).click();
  await expect(page.getByText('Table updated')).toBeVisible();

  // The description was applied; the FK was not.
  const info = await (await page.request.get('api.php?a=table_info&db=shop&table=e2e_fk_child')).json();
  expect(info.table.comment).toBe('Child rows');
  expect(info.foreignKeys).toEqual([]);
});
