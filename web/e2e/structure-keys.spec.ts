import { expect, test, type Page } from '@playwright/test';
import { login, pickDb } from './helpers';

/**
 * Structure tab, "Key" column and Indexes, reproduced on a table shaped like
 * the real `usuarios`: composite unique (tenant_id, email), a plain index on
 * email, a redundant one on tenant_id, FULLTEXT on bio, a yes/no column.
 */

async function sql(page: Page, statement: string) {
  const session = await (await page.request.get('api.php?a=session')).json();
  const r = await page.request.post('api.php?a=query', { headers: { 'X-CSRF-Token': session.csrf }, data: { db: 'shop', sql: statement, confirm: true } });
  return r.json();
}

test.beforeEach(async ({ page }) => {
  await login(page);
  await sql(page, 'DROP TABLE IF EXISTS e2e_usuarios');
  await sql(
    page,
    `CREATE TABLE e2e_usuarios (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT UNSIGNED NOT NULL,
      email VARCHAR(190) NOT NULL,
      name VARCHAR(100) NOT NULL,
      bio TEXT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      credits INT NOT NULL DEFAULT 0,
      UNIQUE KEY uq_tenant_email (tenant_id, email),
      KEY idx_email (email),
      KEY idx_tenant (tenant_id),
      FULLTEXT KEY ft_bio (bio)
    ) ENGINE=InnoDB`,
  );
  await sql(page, "INSERT INTO e2e_usuarios (tenant_id, email, name) VALUES (1,'a@x.io','Ana'),(1,'b@x.io','Ana'),(2,'a@x.io','Luis')");
  await page.reload();
  await pickDb(page, 'shop');
  await page.locator('nav.tables button[data-table="e2e_usuarios"]').click();
  await page.getByRole('button', { name: 'Structure', exact: true }).click();
  await page.locator('#idx-title').waitFor();
});
test.afterEach(async ({ page }) => {
  await sql(page, 'DROP TABLE IF EXISTS e2e_usuarios');
});

const row = (page: Page, col: string) => page.locator(`.col-row[data-col="${col}"]`);

test('Key column: every index of a column, with its position in composite ones', async ({ page }) => {
  const keys = row(page, 'email').locator('.c-keys .key');
  await expect(keys).toHaveText(['U 2/2', 'I']);
  await expect(keys.first()).toHaveAttribute('aria-label', 'Unique index uq_tenant_email, column 2 of 2');
  await expect(keys.first()).toHaveAttribute('title', '2nd column of uq_tenant_email (tenant_id, email)');
  await expect(row(page, 'tenant_id').locator('.key')).toHaveText(['U 1/2', 'I']);
  await expect(row(page, 'bio').locator('.key')).toHaveText(['FT']);
  // "+ index" also on a column that already has one (discreet): preselects it.
  await row(page, 'email').hover();
  await row(page, 'email').locator('.add-index').click();
  const form = page.getByRole('group', { name: 'New index' });
  await expect(form.locator('.selected li')).toHaveText([/email/]);
  // Clicking a badge scrolls to that index and highlights it.
  await keys.first().click();
  await expect(page.locator('.idx-row.flash')).toContainText('uq_tenant_email');
});

test('index list: aligned grid, "Primary key", redundant suggestion, edit and invisible', async ({ page }) => {
  const rows = page.locator('.idx-grid .idx-row');
  await expect(rows.first()).toContainText('Primary key');
  await expect(rows.first()).not.toContainText('PRIMARY PRIMARY');
  await expect(page.locator('.redundant')).toContainText('idx_tenant');
  await page.getByRole('button', { name: 'Drop redundant idx_tenant' }).click();
  await expect(page.locator('.idx-row.dropped')).toContainText('idx_tenant');

  // Edit = DROP + ADD in the same ALTER.
  const email = page.locator('.idx-row', { hasText: 'idx_email' });
  await email.hover();
  await email.getByRole('button', { name: 'Edit idx_email' }).click();
  const form = page.getByRole('group', { name: 'Edit index idx_email' });
  await form.getByRole('button', { name: 'name', exact: true }).click();
  await form.getByRole('button', { name: 'Save index' }).click();
  // Invisible without rebuilding: ALTER INDEX ... IGNORED (MariaDB) / INVISIBLE (MySQL).
  const uq = page.locator('.idx-row', { hasText: 'uq_tenant_email' });
  await uq.hover();
  await uq.getByRole('button', { name: 'Make invisible' }).click();
  await expect(uq).toContainText(/ignored|invisible/);
  await page.getByRole('button', { name: 'Review and apply' }).click();
  await page.getByRole('checkbox', { name: 'Show SQL' }).check();
  const sqlText = page.locator('.drawer pre');
  await expect(sqlText).toContainText(/ALTER INDEX `uq_tenant_email` (IGNORED|INVISIBLE)/);
  await expect(sqlText).toContainText('DROP INDEX `idx_email`');
  await expect(sqlText).toContainText('ADD INDEX `idx_email_name` (`email`, `name`)');
});

test('new index form: segmented type, disabled options with reason, compatible columns, auto name, duplicates', async ({ page }) => {
  await page.getByRole('button', { name: '+ New index' }).click();
  const form = page.getByRole('group', { name: 'New index' });
  const type = form.getByRole('radiogroup', { name: 'Index type' });
  await expect(type.getByRole('radio', { name: 'INDEX' })).toBeChecked();
  const primary = type.getByRole('radio', { name: 'PRIMARY' });
  await expect(primary).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator(`#${await primary.getAttribute('aria-describedby')}`)).toContainText('The table already has a primary key');
  await expect(type.getByRole('radio', { name: 'SPATIAL' })).toHaveAttribute('aria-disabled', 'true');

  const add = form.getByRole('button', { name: 'Add index' });
  await expect(add).toBeDisabled();
  await expect(form).toContainText('Choose at least one column');

  // FULLTEXT: only text columns can be picked.
  await type.getByRole('radio', { name: 'FULLTEXT' }).click();
  await expect(form.locator('.pick[data-col="credits"]')).toBeDisabled();
  await form.locator('.pick[data-col="name"]').click();
  await expect(form.getByLabel('Index name')).toHaveValue('ft_name');
  // Switching to UNIQUE keeps name; bio (TEXT) would need a prefix.
  await type.getByRole('radio', { name: 'UNIQUE' }).click();
  await expect(form.getByLabel('Index name')).toHaveValue('uq_name');
  await expect(form).toContainText('2 rows share a value'); // "Ana" twice
  await expect(form.getByRole('button', { name: 'View rows' })).toBeVisible();
  await form.locator('.pick[data-col="bio"]').click();
  await expect(form).toContainText('needs a prefix length');

  // Order: Alt+↑ moves the focused column up; the auto name follows.
  await form.locator('.selected li').nth(1).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(form.locator('.selected li .nm')).toHaveText(['bio', 'name']);
  await expect(form.getByLabel('Index name')).toHaveValue('uq_bio_name');
});

test('other details: Yes/No default, exact row count, sticky header, no native selects', async ({ page }) => {
  await expect(row(page, 'is_active').locator('.c-default')).toContainText('Yes (1)');
  await expect(row(page, 'credits').locator('.c-default')).toContainText('0');
  await expect(row(page, 'credits').locator('.c-default')).not.toContainText("'0'");
  await expect(page.locator('.chip.rows')).toHaveText('3 rows'); // exact: small table, no "~"
  expect(await page.locator('.editor-view select').count()).toBe(0);

  // Scrolling a row into view must not leave it under the sticky header.
  const view = page.locator('.editor-view');
  await view.evaluate((el) => (el.scrollTop = 400));
  await page.waitForTimeout(300);
  await row(page, 'id').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
  const head = await page.locator('.cols-head').boundingBox();
  const first = await row(page, 'id').boundingBox();
  expect(first!.y).toBeGreaterThanOrEqual(head!.y + head!.height - 1);
});
