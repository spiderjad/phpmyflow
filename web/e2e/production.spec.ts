import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/** A production connection shows its stripe and label, and asks before writing. */

async function sql(page: Page, statement: string) {
  const session = await (await page.request.get('api.php?a=session')).json();
  return (await page.request.post('api.php?a=query', { headers: { 'X-CSRF-Token': session.csrf }, data: { db: 'shop', sql: statement, confirm: true } })).json();
}

test.beforeEach(async ({ page }) => {
  await login(page);
  await sql(page, "UPDATE plantas SET nombre = 'Planta Sur' WHERE id = 2");
});
test.afterEach(async ({ page }) => {
  await page.evaluate(() => localStorage.removeItem('pmf.connections'));
  await sql(page, "UPDATE plantas SET nombre = 'Planta Sur' WHERE id = 2");
});

test('marking the connection as production: stripe + label, and a cell edit asks first', async ({ page }) => {
  await expect(page.locator('.conn-stripe')).toHaveCount(0);
  await page.keyboard.press('Control+,');
  const dlg = page.getByRole('dialog', { name: 'Settings' });
  await dlg.getByRole('navigation').getByRole('button', { name: 'Connections' }).click();
  // The current connection is first; it has no environment yet.
  const first = dlg.locator('.st-conn').first();
  await expect(first).toContainText('Current');
  await expect(first.getByRole('button', { name: /^Suggested: Local/ })).toBeVisible();
  await first.getByRole('button', { name: /^Environment of/ }).click();
  await page.getByRole('option', { name: 'Production' }).click();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();

  await expect(page.locator('.conn-stripe')).toBeVisible();
  await expect(page.locator('header .env-tag')).toHaveText('Production');

  await page.locator('nav.tables button[data-table="plantas"]').click();
  const cell = page.locator('table.dg td[data-r="1"][data-c="1"]');
  await expect(cell).toHaveText('Planta Sur');

  // Cancel: nothing is written.
  await cell.dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Planta Sur (prod)');
  await page.keyboard.press('Enter');
  const confirm = page.getByRole('dialog', { name: /You are on PRODUCTION/ });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('This changes a value in a row.');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  let r = await sql(page, 'SELECT nombre FROM plantas WHERE id = 2');
  expect(r.rows[0][0]).toBe('Planta Sur');

  // Confirm: written.
  await cell.dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Planta Sur (prod)');
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: /You are on PRODUCTION/ }).getByRole('button', { name: 'Yes, continue' }).click();
  await expect(cell).toHaveText('Planta Sur (prod)');
  r = await sql(page, 'SELECT nombre FROM plantas WHERE id = 2');
  expect(r.rows[0][0]).toBe('Planta Sur (prod)');

  // Reading never asks.
  await page.getByRole('button', { name: 'SQL' }).click();
});
