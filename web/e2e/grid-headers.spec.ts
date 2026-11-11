import { expect, test, type Page } from '@playwright/test';
import { login, pickDb } from './helpers';

/** Grid headers: full type without cutting (comfortable), one badge per key category, the ⋯ menu. */

async function sql(page: Page, statement: string) {
  const session = await (await page.request.get('api.php?a=session')).json();
  return (await page.request.post('api.php?a=query', { headers: { 'X-CSRF-Token': session.csrf }, data: { db: 'shop', sql: statement, confirm: true } })).json();
}

test.beforeEach(async ({ page }) => {
  await login(page);
  await sql(page, 'DROP TABLE IF EXISTS e2e_heads');
  await sql(page, `CREATE TABLE e2e_heads (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(190) NOT NULL,
    amount DECIMAL(12,4) UNSIGNED NULL,
    created_at DATETIME(6) NULL,
    note VARCHAR(20) NULL,
    KEY idx_a (email), KEY idx_b (email, note), KEY idx_c (email, amount)
  )`);
  await sql(page, "INSERT INTO e2e_heads (email, amount, created_at, note) VALUES ('a@x.com', 1.5, NOW(), 'x')");
  await page.reload();
  await pickDb(page, 'shop');
  await page.locator('nav.tables button[data-table="e2e_heads"]').click();
  await expect(page.locator('table.dg')).toBeVisible();
});
test.afterEach(async ({ page }) => {
  await page.evaluate(() => localStorage.removeItem('pmf_prefs'));
  await sql(page, 'DROP TABLE IF EXISTS e2e_heads');
});

const head = (page: Page, column: string) => page.locator('table.dg thead th').filter({ has: page.getByRole('button', { name: `Select column ${column}`, exact: true }) });

test('comfortable: the full type sits under the name and is never cut; compact: only in the tooltip', async ({ page }) => {
  await page.getByRole('button', { name: 'Comfortable' }).click();
  const types = page.locator('table.dg thead .th-type');
  await expect(types).toHaveText(['int(10) unsigned', 'varchar(190)', 'decimal(12,4) unsigned', 'datetime(6)', 'varchar(20)']);
  const cut = await types.evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > (e.closest('th') as HTMLElement).getBoundingClientRect().right).map((e) => e.textContent));
  expect(cut).toEqual([]);

  await page.getByRole('button', { name: 'Compact' }).click();
  await expect(types).toHaveCount(0);
  await expect(head(page, 'email')).toHaveAttribute('title', /^varchar\(190\)/);
});

test('three indexes on a column show as "I ×3" with every name in the tooltip', async ({ page }) => {
  const badges = head(page, 'email').locator('.th-key');
  await expect(badges).toHaveText(['I ×3']);
  const tip = (await badges.first().getAttribute('title')) ?? '';
  for (const n of ['idx_a', 'idx_b', 'idx_c']) expect(tip).toContain(n);
});

test('⋯ menu: hide a column and show it again; pin one to the left', async ({ page }) => {
  await head(page, 'amount').hover();
  await head(page, 'amount').getByRole('button', { name: 'Options for amount' }).click();
  const menu = page.getByRole('menu', { name: 'Options for amount' });
  await menu.getByRole('menuitem', { name: 'Hide column' }).click();
  await expect(head(page, 'amount')).toHaveCount(0);
  await page.getByRole('button', { name: '1 hidden column · show' }).click();
  await expect(head(page, 'amount')).toHaveCount(1);

  await head(page, 'note').hover();
  await head(page, 'note').getByRole('button', { name: 'Options for note' }).click();
  await page.getByRole('menu', { name: 'Options for note' }).getByRole('menuitem', { name: 'Pin to the left' }).click();
  const names = await page.locator('table.dg thead .th-name').allTextContents();
  expect(names[0]).toBe('note');
  // Pinned columns stay in place while scrolling sideways.
  await expect(head(page, 'note')).toHaveClass(/sticky-1/);
});
