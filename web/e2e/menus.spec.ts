import { expect, test } from '@playwright/test';
import { login } from './helpers';

/** Menus (ui/Menu): keyboard, submenus, destructive entries last; selects without native controls. */

test.beforeEach(async ({ page }) => {
  await login(page);
  await page.locator('nav.tables button[data-table="customers"]').click();
  await expect(page.locator('table.dg')).toBeVisible();
});

test('grid context menu: arrows, a letter jumps, → opens a submenu, ← and Esc go back', async ({ page }) => {
  const cell = page.locator('table.dg td[data-r="0"][data-c="1"]');
  await cell.click();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Cell actions' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem').first()).toBeFocused(); // Copy
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Copy as' })).toBeFocused();

  // → opens "Copy as" with the focus inside.
  await page.keyboard.press('ArrowRight');
  const sub = page.getByRole('menu', { name: 'Copy as' });
  await expect(sub).toBeVisible();
  await expect(sub.getByRole('menuitem', { name: 'JSON' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(sub.getByRole('menuitem', { name: 'CSV' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(sub).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Copy as' })).toBeFocused();

  // A letter jumps to the next entry starting with it.
  await page.keyboard.press('f');
  await expect(menu.getByRole('menuitem', { name: /^Filter by this value/ })).toBeFocused();

  // Icons and shortcuts; Esc closes and gives the focus back to the cell.
  await expect(menu.getByRole('menuitem').first().locator('.mi-icon svg')).toHaveCount(1);
  await expect(menu.getByRole('menuitem').first().locator('kbd')).toHaveText(['Ctrl', 'C']);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(cell).toBeFocused();
});

test('table menu: Empty and Drop are last and in red', async ({ page }) => {
  await page.locator('nav.tables button[data-table="customers"]').click({ button: 'right' });
  const items = page.getByRole('menu').first().getByRole('menuitem');
  const labels = await items.allTextContents();
  expect(labels.slice(-2).map((l) => l.trim())).toEqual(['Empty…', 'Drop…']);
  await expect(items.last()).toHaveClass(/danger/);
});

test('rows per page and language use the spider-ui select (no native <select>)', async ({ page }) => {
  await expect(page.locator('.pager select, header select')).toHaveCount(0);
  await page.getByRole('button', { name: 'Rows per page' }).click();
  await page.getByRole('listbox').getByRole('option', { name: '25', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rows per page' })).toContainText('25');
  await page.getByRole('button', { name: 'Language' }).click();
  await page.getByRole('listbox').getByRole('option', { name: 'Español' }).click();
  await expect(page.getByRole('button', { name: 'Idioma' })).toContainText('Español');
  await page.getByRole('button', { name: 'Idioma' }).click();
  await page.getByRole('listbox').getByRole('option', { name: 'English' }).click();
});
