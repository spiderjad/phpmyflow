import { expect, test } from '@playwright/test';
import { login, runSql } from './helpers';

const queries = [
  { sql: 'SELECT id, name FROM customers ORDER BY id', title: 'SELECT customers', firstCell: '1' },
  { sql: 'SELECT id, status FROM orders WHERE id = 2', title: 'SELECT orders', firstCell: '2' },
  { sql: 'SELECT COUNT(*) AS n FROM order_items', title: 'SELECT order_items', firstCell: '7' },
];

test('each tab keeps its own SQL and result, and tabs survive a reload', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'SQL', exact: true }).click();

  for (const [i, q] of queries.entries()) {
    if (i > 0) await page.getByRole('button', { name: 'New tab' }).click();
    await runSql(page, q.sql);
    await expect(page.getByRole('tab', { selected: true })).toContainText(q.title);
    await expect(page.locator('table.dg td[data-r="0"][data-c="0"]')).toHaveText(q.firstCell);
  }
  await expect(page.getByRole('tab')).toHaveCount(3);

  // Switch back and forth: SQL and result follow the tab.
  for (const [i, q] of [...queries.entries()].reverse()) {
    await page.getByRole('tab').nth(i).click();
    await expect(page.locator('.cm-content')).toHaveText(q.sql);
    await expect(page.locator('table.dg td[data-r="0"][data-c="0"]')).toHaveText(q.firstCell);
  }

  // Reload: tabs and SQL come back, results do not.
  await page.waitForTimeout(700); // debounced save
  await page.reload();
  await expect(page.getByRole('tab')).toHaveCount(3);
  for (const [i, q] of queries.entries()) {
    await page.getByRole('tab').nth(i).click();
    await expect(page.locator('.cm-content')).toHaveText(q.sql);
    await expect(page.getByText('Run to see results')).toBeVisible();
  }
});

test('Ctrl+click on a table opens a new tab that already ran', async ({ page }) => {
  await login(page);
  await page.locator('nav.tables button[data-table="products"]').click({ modifiers: ['Control'] });
  await expect(page.getByRole('tab', { selected: true })).toContainText('SELECT products');
  await expect(page.locator('.cm-content')).toHaveText('SELECT * FROM `products` LIMIT 100');
  await expect(page.locator('table.dg tbody tr[aria-rowindex]')).toHaveCount(5);
});

test('closing a tab with content can be undone', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'SQL', exact: true }).click();
  await runSql(page, 'SELECT 1 AS one');
  await page.getByRole('button', { name: 'New tab' }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.getByRole('tab').first().click();
  await page.keyboard.press('Alt+w');
  await expect(page.getByRole('tab')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('tab', { selected: true })).toContainText('SELECT 1');
});
