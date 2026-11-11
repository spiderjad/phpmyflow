import { expect, test, type Page } from '@playwright/test';
import { login, pickDb } from './helpers';

/** Phase B: views, procedures (run with parameters), triggers, events. */

async function api(page: Page, action: string, data: Record<string, unknown>) {
  const session = await (await page.request.get('api.php?a=session')).json();
  return (await page.request.post(`api.php?a=${action}`, { headers: { 'X-CSRF-Token': session.csrf }, data })).json();
}
const sql = (page: Page, statement: string) => api(page, 'query', { db: 'shop', sql: statement, confirm: true });

async function cleanup(page: Page) {
  for (const s of [
    'DROP VIEW IF EXISTS v_paid_orders',
    'DROP PROCEDURE IF EXISTS p_orders_of',
    'DROP TRIGGER IF EXISTS trg_e2e_touch',
    'DROP TABLE IF EXISTS e2e_items',
    'DROP EVENT IF EXISTS ev_e2e_cleanup',
  ])
    await sql(page, s);
}

/** Replace the body editor's text (CodeMirror). */
async function setBody(page: Page, text: string) {
  const editor = page.locator('.codebox .cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(text);
  await page.keyboard.press('Escape');
}

async function createNew(page: Page, id: string) {
  await page.locator('.db-head .more').click();
  await page.locator('[data-id="createNew"]').click();
  await page.locator(`[data-id="${id}"]`).click();
}

async function reviewAndSave(page: Page) {
  await page.getByRole('button', { name: 'Review and save' }).click();
  const dlg = page.getByRole('dialog', { name: /^Save / });
  await expect(dlg.locator('pre')).toBeVisible();
  await dlg.getByRole('button', { name: 'Run and save' }).click();
  await expect(dlg).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await login(page);
  await cleanup(page);
});
test.afterEach(async ({ page }) => cleanup(page));

test('create a view, test it, save it and find it in the sidebar', async ({ page }) => {
  await createNew(page, 'newView');
  await page.getByLabel('Name', { exact: true }).fill('v_paid_orders');
  await setBody(page, "SELECT id, status, ordered_at\nFROM orders\nWHERE status = 'paid'");
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(page.locator('.rt tbody tr').first()).toContainText('paid');
  await reviewAndSave(page);
  await expect(page.locator('#obj-title')).toHaveText('v_paid_orders');
  await expect(page.locator('nav.tables button[data-table="v_paid_orders"]')).toBeVisible();
  const r = await sql(page, 'SELECT COUNT(*) FROM v_paid_orders');
  expect(r.rows[0][0]).toBeGreaterThan(0);

  // Switching to another kind of object shows that object, not the view's data.
  await createNew(page, 'newProcedure');
  await expect(page.locator('#obj-title')).toHaveText('New Procedure');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: '+ Parameter' })).toBeVisible();
});

test('create a procedure with parameters and run it (RecordPicker for customer_id)', async ({ page }) => {
  await createNew(page, 'newProcedure');
  await page.getByLabel('Name', { exact: true }).fill('p_orders_of');
  await page.getByRole('button', { name: '+ Parameter' }).click();
  await page.getByLabel('Name', { exact: true }).nth(0).fill('p_orders_of'); // keep the routine name
  const rows = page.locator('.prow');
  await rows.nth(0).getByLabel('Name').fill('p_customer_id');
  await page.getByRole('button', { name: '+ Parameter' }).click();
  await rows.nth(1).getByLabel('Mode').selectOption('OUT');
  await rows.nth(1).getByLabel('Name').fill('p_count');
  await page.getByLabel('Data access').selectOption('READS SQL DATA');
  await setBody(page, 'BEGIN\n  SELECT id, status FROM orders WHERE customer_id = p_customer_id;\n  SELECT COUNT(*) INTO p_count FROM orders WHERE customer_id = p_customer_id;\nEND');
  await reviewAndSave(page);
  await expect(page.locator('nav.tables button[data-object="p_orders_of"]')).toBeVisible();

  await page.getByRole('button', { name: '▶ Run…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Run p_orders_of' });
  const picker = dlg.getByRole('combobox', { name: 'p_customer_id' });
  await picker.fill('Marco');
  await dlg.getByRole('option', { name: /Marco Rossi/ }).click();
  await dlg.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(dlg.locator('.out')).toContainText('p_count');
  const expected = (await sql(page, "SELECT COUNT(*) FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.name = 'Marco Rossi'")).rows[0][0];
  await expect(dlg.locator('.out dd')).toHaveText(String(expected));
  await expect(dlg.locator('.rt').first()).toBeVisible();
});

test('a trigger from the Structure tab fills updated_at', async ({ page }) => {
  await sql(page, 'CREATE TABLE e2e_items (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(40) NOT NULL, updated_at DATETIME NULL)');
  await sql(page, "INSERT INTO e2e_items (name) VALUES ('a')");
  await page.reload();
  await pickDb(page, 'shop');
  await page.locator('nav.tables button[data-table="e2e_items"]').click();
  await page.getByRole('button', { name: 'Structure', exact: true }).click();
  await page.locator('#trg-title').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: '+ Trigger' }).click();
  await page.getByLabel('Name', { exact: true }).fill('trg_e2e_touch');
  await expect(page.getByRole('combobox', { name: 'Table', exact: true })).toHaveValue('e2e_items');
  await page.getByRole('button', { name: 'BEFORE', exact: true }).click();
  await page.getByRole('button', { name: 'UPDATE', exact: true }).click();
  await setBody(page, 'SET NEW.updated_at = NOW()');
  await reviewAndSave(page);
  await expect(page.locator('nav.tables button[data-object="trg_e2e_touch"]')).toBeVisible();
  await sql(page, "UPDATE e2e_items SET name = 'b' WHERE id = 1");
  const r = await sql(page, 'SELECT updated_at IS NOT NULL FROM e2e_items WHERE id = 1');
  expect(Number(r.rows[0][0])).toBe(1);
});

test('create an event; the scheduler status is shown', async ({ page }) => {
  await createNew(page, 'newEvent');
  const scheduler = (await (await page.request.get('api.php?a=db_objects&db=shop')).json()).scheduler;
  if (scheduler !== 'ON') await expect(page.getByText(/The event scheduler is/)).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('ev_e2e_cleanup');
  await page.getByLabel('Every').fill('1');
  await page.getByLabel('Unit').selectOption('DAY');
  await page.getByLabel('Enabled').uncheck();
  await setBody(page, "DELETE FROM activity_log WHERE created_at < NOW() - INTERVAL 5 YEAR");
  await reviewAndSave(page);
  await expect(page.locator('nav.tables button[data-object="ev_e2e_cleanup"]')).toBeVisible();
  const info = await (await page.request.get('api.php?a=object_info&db=shop&kind=EVENT&name=ev_e2e_cleanup')).json();
  expect(info.schedule).toMatchObject({ type: 'every', value: 1, unit: 'DAY' });
  expect(info.enabled).toBe(false);
});
