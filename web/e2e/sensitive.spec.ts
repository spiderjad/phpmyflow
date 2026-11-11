import { expect, test, type Page } from '@playwright/test';
import { login, pickDb } from './helpers';

/** Sensitive columns: hidden until revealed; copy keeps the real value and warns. */

const HASH = '$2y$10$abcdefghijklmnopqrstuuJ4H7u8Z7mvx0hNnTq0LZ1y2x3c4d5e6';

async function sql(page: Page, statement: string) {
  const session = await (await page.request.get('api.php?a=session')).json();
  return (await page.request.post('api.php?a=query', { headers: { 'X-CSRF-Token': session.csrf }, data: { db: 'shop', sql: statement, confirm: true } })).json();
}

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.beforeEach(async ({ page }) => {
  await login(page);
  await sql(page, 'DROP TABLE IF EXISTS e2e_secrets');
  await sql(page, 'CREATE TABLE e2e_secrets (id INT PRIMARY KEY, name VARCHAR(40), password VARCHAR(100), api_key VARCHAR(60), passenger VARCHAR(40))');
  await sql(page, `INSERT INTO e2e_secrets VALUES (1, 'Ana', '${HASH}', 'sk_live_123456789', 'Luis'), (2, 'Bea', NULL, '', 'Eva')`);
  await page.reload();
  await pickDb(page, 'shop');
  await page.locator('nav.tables button[data-table="e2e_secrets"]').click();
  await expect(page.locator('table.dg')).toBeVisible();
});
test.afterEach(async ({ page }) => {
  await sql(page, 'DROP TABLE IF EXISTS e2e_secrets');
});

const cell = (page: Page, r: number, c: number) => page.locator(`table.dg td[data-r="${r}"][data-c="${c}"]`);

test('password is hidden; the eye reveals it; Ctrl+C copies the real value and warns', async ({ page }) => {
  // password (2) and api_key (3) hidden; passenger (4) is not a password.
  await expect(cell(page, 0, 2)).toHaveText('••••••••');
  await expect(cell(page, 0, 2)).toHaveAttribute('aria-label', 'hidden value');
  await expect(cell(page, 0, 3)).toHaveText('••••••••');
  await expect(cell(page, 0, 4)).toHaveText('Luis');
  // NULL and empty reveal nothing: shown as they are.
  await expect(cell(page, 1, 2)).toHaveText('NULL');
  await expect(cell(page, 1, 3)).toHaveText('empty');

  await cell(page, 0, 2).click();
  await page.keyboard.press('Control+C');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(HASH);
  await expect(page.locator('.toast', { hasText: 'Contains a sensitive value' })).toBeVisible();

  // One cell: the eye in the cell.
  await cell(page, 0, 2).hover();
  await cell(page, 0, 2).getByRole('button', { name: 'Show value' }).click();
  await expect(cell(page, 0, 2)).toHaveText(HASH);
  await expect(cell(page, 0, 3)).toHaveText('••••••••');

  // The whole column: the eye in the header (kept for the session).
  await page.getByRole('button', { name: 'Show the values of api_key (this session)' }).click();
  await expect(cell(page, 0, 3)).toHaveText('sk_live_123456789');
  await page.locator('nav.tables button[data-table="customers"]').click();
  await page.locator('nav.tables button[data-table="e2e_secrets"]').click();
  await expect(cell(page, 0, 3)).toHaveText('sk_live_123456789');
  await expect(cell(page, 0, 2)).toHaveText('••••••••');
});

test('the row detail hides it too', async ({ page }) => {
  await page.locator('table.dg tbody tr').first().hover();
  await page.getByRole('button', { name: 'Show row 1 details' }).click();
  const detail = page.locator('aside.detail, aside').filter({ hasText: 'password' }).last();
  await expect(detail.getByLabel('hidden value')).toHaveCount(2);
  await detail.getByRole('button', { name: 'Show value' }).first().click();
  await expect(detail).toContainText(HASH);
});
