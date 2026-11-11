import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * VERIFIED BEHAVIORS (see CLAUDE.md): these must never break.
 * Schema from docker/sample.sql: plantas, departamentos (id_planta),
 * catalogo (id_departamento), with NO declared foreign keys, so the
 * relations come from the inference of the id_xxx prefix style.
 */

async function sql(page: Page, statement: string) {
  const session = await (await page.request.get('api.php?a=session')).json();
  return (await page.request.post('api.php?a=query', { headers: { 'X-CSRF-Token': session.csrf }, data: { db: 'shop', sql: statement, confirm: true } })).json();
}

async function openTable(page: Page, table: string) {
  await page.locator(`nav.tables button[data-table="${table}"]`).click();
  await expect(page.locator('table.dg')).toBeVisible();
}

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.beforeEach(async ({ page }) => {
  await login(page);
  // Same data every run.
  await sql(page, "DELETE FROM catalogo WHERE name LIKE 'E2E %'");
  await sql(page, 'UPDATE departamentos SET id_planta = 1 WHERE id = 1');
});
test.afterEach(async ({ page }) => {
  await sql(page, "DELETE FROM catalogo WHERE name LIKE 'E2E %'");
  await sql(page, 'UPDATE departamentos SET id_planta = 1 WHERE id = 1');
});

test('1. New row in catalogo: id_departamento is a record picker; "mant" finds "3 · Mantenimiento" and saves 3', async ({ page }) => {
  await openTable(page, 'catalogo');
  await page.getByRole('button', { name: '+ Add row' }).click();
  const drawer = page.getByRole('dialog', { name: 'New row in catalogo' });
  await drawer.locator('#ins-1').fill('E2E picker');
  const picker = drawer.getByRole('combobox', { name: 'id_departamento: record of departamentos' });
  await expect(picker).toBeVisible();
  await picker.fill('mant');
  const option = drawer.getByRole('option', { name: /^3 · Mantenimiento/ });
  await expect(option).toBeVisible();
  await option.click();
  await expect(picker).toHaveValue('3 · Mantenimiento');
  await drawer.getByRole('button', { name: 'Save row' }).click();
  await expect(drawer).toHaveCount(0);
  const r = await sql(page, "SELECT id_departamento FROM catalogo WHERE name = 'E2E picker'");
  expect(Number(r.rows[0][0])).toBe(3);
});

test('2. departamentos grid shows "Planta Norte · 1"; double click opens the picker and changing the plant works', async ({ page }) => {
  await openTable(page, 'departamentos');
  const cell = page.locator('table.dg td[data-r="0"][data-c="2"]');
  await expect(cell).toContainText('Planta Norte · 1');
  // Copy keeps copying the id, not the name.
  await cell.click();
  await page.keyboard.press('Control+C');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('1');
  await cell.dblclick();
  const picker = page.getByRole('combobox', { name: 'id_planta: record of plantas' });
  await expect(picker).toBeFocused();
  await picker.fill('sur');
  await page.getByRole('option', { name: /^2 · Planta Sur/ }).click();
  await expect(cell).toContainText('Planta Sur · 2');
  const r = await sql(page, 'SELECT id_planta FROM departamentos WHERE id = 1');
  expect(Number(r.rows[0][0])).toBe(2);
});

test('3. New row in catalogo: is_active is on with "Default: Yes", sort_order says "Default: 0" without quotes', async ({ page }) => {
  await openTable(page, 'catalogo');
  await page.getByRole('button', { name: '+ Add row' }).click();
  const drawer = page.getByRole('dialog', { name: 'New row in catalogo' });
  const active = drawer.getByRole('switch', { name: 'is_active' });
  await expect(active).toHaveAttribute('aria-checked', 'true');
  await expect(drawer).toContainText('Default: Yes');
  await expect(drawer.locator('#ins-4')).toHaveAttribute('placeholder', 'Default: 0');
});

test('4. Loading a page of the grid makes exactly one lookup_many call', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('a=lookup_many')) calls.push(r.url());
  });
  await openTable(page, 'departamentos');
  await expect(page.locator('table.dg td[data-r="0"][data-c="2"]')).toContainText('Planta Norte');
  await page.waitForTimeout(800); // nothing else may arrive
  expect(calls).toHaveLength(1);
});
