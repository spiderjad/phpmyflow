import { expect, test, type Page } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { login, pickDb } from './helpers';

/**
 * Phase A, database tools: export / import round trip, copy a table with
 * data, create and drop a database, new table from a template.
 */

const SHOP_TABLES = ['customers', 'orders', 'order_items', 'products', 'reviews', 'order_notes', 'activity_log'];

async function api(page: Page, action: string, data: Record<string, unknown>) {
  const session = await (await page.request.get('api.php?a=session')).json();
  const r = await page.request.post(`api.php?a=${action}`, { headers: { 'X-CSRF-Token': session.csrf }, data });
  return r.json();
}
const sql = (page: Page, db: string, statement: string) => api(page, 'query', { db, sql: statement, confirm: true });
async function count(page: Page, db: string, table: string): Promise<number> {
  return (await (await page.request.get(`api.php?a=count&db=${db}&table=${table}`)).json()).total;
}
async function dropDbQuietly(page: Page, db: string) {
  await sql(page, 'shop', `DROP DATABASE IF EXISTS \`${db}\``);
}

/** Open the database menu from the sidebar "⋯" and pick an entry (by data-id). */
async function dbMenu(page: Page, id: string, sub?: string) {
  await page.locator('.db-head .more').click();
  if (sub) {
    await page.locator(`[data-id="${id}"]`).click();
    await page.locator(`[data-id="${sub}"]`).click();
  } else await page.locator(`[data-id="${id}"]`).click();
}

async function waitJob(page: Page, title: RegExp) {
  const job = page.locator('.job', { hasText: title }).first();
  await expect(job).toHaveClass(/done/, { timeout: 30_000 });
  return job;
}

test.beforeEach(async ({ page }) => {
  await login(page);
  await dropDbQuietly(page, 'e2e_copy');
  await dropDbQuietly(page, 'e2e_new');
});

test.afterEach(async ({ page }) => {
  await dropDbQuietly(page, 'e2e_copy');
  await dropDbQuietly(page, 'e2e_new');
  await sql(page, 'shop', 'DROP TABLE IF EXISTS orders_copy');
  await sql(page, 'shop', 'DROP TABLE IF EXISTS e2e_people');
});

test('create and drop a database (typed confirmation)', async ({ page }) => {
  await dbMenu(page, 'createNew', 'newDb');
  const dlg = page.getByRole('dialog', { name: 'New database' });
  await dlg.getByLabel('Name').fill('e2e_new');
  await dlg.getByRole('button', { name: 'Create database' }).click();
  await expect(page.locator('#db-select')).toContainText('e2e_new ·');
  await expect(page.locator('#ov-title')).toHaveText('e2e_new');

  await dbMenu(page, 'dropDb');
  const drop = page.getByRole('dialog', { name: 'Drop the database e2e_new?' });
  const btn = drop.getByRole('button', { name: 'Drop database' });
  await expect(btn).toBeDisabled();
  await drop.getByLabel('Type e2e_new to confirm').fill('e2e_new');
  await btn.click();
  await expect(page.locator('#db-select option[value="e2e_new"]')).toHaveCount(0);
});

test('export shop to SQL, import it into a copy, drop a table there and import again', async ({ page }) => {
  test.slow(); // whole database export + two imports
  // Export the whole database (SQL, defaults: DROP TABLE IF EXISTS, no CREATE DATABASE).
  await dbMenu(page, 'export');
  const exp = page.getByRole('dialog', { name: 'Export from shop' });
  await exp.getByRole('button', { name: 'Export', exact: true }).click();
  // The server writes the file in steps; the download is a separate request at the end.
  const job = await waitJob(page, /Export shop/);
  const downloadP = page.waitForEvent('download');
  await job.getByRole('button', { name: 'Download' }).click();
  const download = await downloadP;
  expect(download.suggestedFilename()).toMatch(/^shop-.*\.sql$/);
  const file = join(tmpdir(), download.suggestedFilename());
  await download.saveAs(file);

  // A new empty database, then import the file into it.
  await api(page, 'db_create', { name: 'e2e_copy', charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' });
  const importInto = async () => {
    await dbMenu(page, 'import');
    const imp = page.getByRole('dialog', { name: 'Import SQL' });
    await imp.locator('input[type=file]').setInputFiles(file!);
    await imp.getByRole('button', { name: 'Into database' }).click();
    await page.getByRole('listbox').getByRole('option', { name: 'e2e_copy', exact: true }).click();
    await imp.getByRole('button', { name: 'Import', exact: true }).click();
    const job = await waitJob(page, /Import shop-.* → e2e_copy/);
    await expect(job).toContainText('Errors: 0');
    await job.getByRole('button', { name: 'Close' }).click();
  };
  await page.reload();
  await pickDb(page, 'shop');
  await importInto();
  for (const t of SHOP_TABLES) expect(await count(page, 'e2e_copy', t), t).toBe(await count(page, 'shop', t));

  // Drop a table in the copy from the UI, import again: it comes back.
  await pickDb(page, 'e2e_copy');
  await page.locator('nav.tables button[data-table="reviews"]').click({ button: 'right' });
  await page.locator('[data-id="drop"]').click();
  const drop = page.getByRole('dialog', { name: 'Drop the table reviews?' });
  await drop.getByLabel('Type reviews to confirm').fill('reviews');
  await drop.getByRole('button', { name: 'Drop', exact: true }).click();
  await expect(page.locator('nav.tables button[data-table="reviews"]')).toHaveCount(0);
  await importInto();
  expect(await count(page, 'e2e_copy', 'reviews')).toBe(await count(page, 'shop', 'reviews'));
});

test('copy a table with its data', async ({ page }) => {
  await page.locator('nav.tables button[data-table="orders"]').click({ button: 'right' });
  await page.locator('[data-id="copy"]').click();
  const dlg = page.getByRole('dialog', { name: 'Copy orders' });
  await expect(dlg.getByLabel('New name')).toHaveValue('orders_copy');
  await dlg.getByLabel('Structure and data').check();
  await dlg.getByRole('button', { name: 'Copy', exact: true }).click();
  await waitJob(page, /Copy orders → shop\.orders_copy/);
  expect(await count(page, 'shop', 'orders_copy')).toBe(await count(page, 'shop', 'orders'));
  await expect(page.locator('nav.tables button[data-table="orders_copy"]')).toBeVisible();
});

test('new table from a template opens in Structure', async ({ page }) => {
  await page.getByRole('button', { name: '+ Table' }).click();
  const dlg = page.getByRole('dialog', { name: 'New table in shop' });
  await dlg.getByLabel('Table name').fill('e2e_people');
  await dlg.getByText('People', { exact: true }).click();
  await expect(dlg).toContainText('id, name, email, phone, is_active, created_at, updated_at');
  await dlg.getByRole('button', { name: 'Create table' }).click();
  await expect(page.locator('#fk-title')).toBeVisible();
  await expect(page.locator('.crumbs')).toContainText('e2e_people');
  const info = await (await page.request.get('api.php?a=table_info&db=shop&table=e2e_people')).json();
  expect(info.indexes.map((i: { name: string }) => i.name)).toContain('uq_email');
});

test('actions without privileges are disabled with the GRANT (read-only demo user)', async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto('/');
  // Server picker: listbox button (ui/Select), same as helpers.login().
  const server = page.locator('form button[aria-haspopup="listbox"]').first();
  if (await server.count()) {
    await server.click();
    const option = page.getByRole('option').filter({ hasText: process.env.PMF_E2E_SERVER ?? '3307' }).first();
    if (await option.count()) await option.click();
    else await page.keyboard.press('Escape');
  }
  await page.locator('input[autocomplete="username"]').fill('demo');
  await page.locator('input[type="password"]').fill('demo');
  await page.locator('button[type="submit"]').click();
  const caps = page.waitForResponse((r) => r.url().includes('a=db_caps&db=shop'));
  await pickDb(page, 'shop');
  await caps;
  // The menu is built when it opens: reopen until the privileges have arrived.
  const drop = page.locator('[data-id="dropDb"]');
  await expect(async () => {
    await page.keyboard.press('Escape');
    await page.locator('.db-head .more').click();
    await expect(drop).toHaveAttribute('aria-disabled', 'true', { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await expect(drop).toContainText('missing DROP privilege');
  await expect(drop).toHaveAttribute('title', /GRANT DROP ON `shop`\.\* TO 'demo'@'%';/);
  await expect(page.locator('[data-id="export"]')).not.toHaveAttribute('aria-disabled', 'true');
  await page.close();
});
