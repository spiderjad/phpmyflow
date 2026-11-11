import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { login } from './helpers';

/** Importing a dump made in another database (WordPress from a host) into the one you choose. */

const DUMP = `-- phpMyAdmin SQL Dump
-- version 5.2.1
-- Servidor: 127.0.0.1
-- Base de datos: \`e2e_src_wp\`
--

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";

CREATE DATABASE IF NOT EXISTS \`e2e_src_wp\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE \`e2e_src_wp\`;

CREATE TABLE \`wp_options\` (
  \`option_id\` bigint(20) UNSIGNED NOT NULL PRIMARY KEY,
  \`option_name\` varchar(191) NOT NULL DEFAULT '',
  \`option_value\` longtext NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO \`wp_options\` (\`option_id\`, \`option_name\`, \`option_value\`) VALUES
(1, 'siteurl', 'https://byt.example.com'),
(2, 'home', 'https://byt.example.com'),
(3, 'blogname', 'Note: \`e2e_src_wp\`.\`wp_posts\` stays in this text');

CREATE TABLE \`e2e_src_wp\`.\`wp_posts\` (\`ID\` bigint(20) UNSIGNED NOT NULL PRIMARY KEY, \`post_title\` text NOT NULL) ENGINE=InnoDB;
INSERT INTO \`e2e_src_wp\`.\`wp_posts\` VALUES (1, 'Hola mundo');
`;

async function api(page: Page, action: string, data: Record<string, unknown>) {
  const session = await (await page.request.get('api.php?a=session')).json();
  return (await page.request.post(`api.php?a=${action}`, { headers: { 'X-CSRF-Token': session.csrf }, data })).json();
}
async function sql(page: Page, statement: string) {
  return api(page, 'query', { db: 'shop', sql: statement, confirm: true });
}
async function dropAll(page: Page) {
  for (const d of ['e2e_src_wp', 'e2e_import_target', 'e2e_new_from_modal']) await sql(page, `DROP DATABASE IF EXISTS \`${d}\``);
}

test.beforeEach(async ({ page }) => {
  await login(page);
  await dropAll(page);
});
test.afterEach(async ({ page }) => dropAll(page));

async function openImport(page: Page) {
  await page.locator('.db-head .more').click();
  await page.locator('[data-id="import"]').click();
  return page.getByRole('dialog', { name: 'Import SQL' });
}

test('create a new database from the import modal: it is created and chosen', async ({ page }) => {
  const imp = await openImport(page);
  await imp.getByRole('button', { name: 'Into database' }).click();
  await page.getByRole('listbox').getByRole('option', { name: 'Create new database…' }).click();
  await imp.getByLabel('Name of the new database').fill('e2e_new_from_modal');
  await imp.getByRole('button', { name: 'Create and use it' }).click();
  await expect(imp.getByRole('button', { name: 'Into database' })).toContainText('e2e_new_from_modal');
  const r = await sql(page, "SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = 'e2e_new_from_modal'");
  expect(r.rows[0][0]).toBe('utf8mb4_unicode_ci');
});

test('a dump with USE and CREATE DATABASE goes entirely into the chosen database', async ({ page }) => {
  await api(page, 'db_create', { name: 'e2e_import_target', charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' });
  await page.reload();
  const file = join(tmpdir(), 'e2e_src_wp.sql');
  writeFileSync(file, DUMP);
  const imp = await openImport(page);
  await imp.locator('input[type=file]').setInputFiles(file);
  await expect(imp).toContainText('e2e_src_wp.sql');
  await expect(imp).toContainText('SQL');
  await imp.getByRole('button', { name: 'Into database' }).click();
  await page.getByRole('listbox').getByRole('option', { name: 'e2e_import_target', exact: true }).click();

  await expect(imp.getByRole('status').filter({ hasText: 'The file is from e2e_src_wp and you will import into e2e_import_target' })).toBeVisible();
  await expect(imp.getByLabel(/Import everything into the chosen database/)).toBeChecked();
  await expect(imp).toContainText('WordPress: remember to update siteurl and home in wp_options if the domain changes.');

  await imp.getByRole('button', { name: 'Import', exact: true }).click();
  const panel = page.getByRole('article', { name: /Import e2e_src_wp\.sql → e2e_import_target/ });
  await expect(panel).toContainText('Tables created: 2', { timeout: 30_000 });

  // Everything is in the chosen database; the source database was never created.
  const tables = await sql(page, "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'e2e_import_target' ORDER BY 1");
  expect(tables.rows.map((r: string[]) => r[0])).toEqual(['wp_options', 'wp_posts']);
  const src = await sql(page, "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = 'e2e_src_wp'");
  expect(Number(src.rows[0][0])).toBe(0);
  const post = await sql(page, 'SELECT post_title FROM e2e_import_target.wp_posts');
  expect(post.rows[0][0]).toBe('Hola mundo');
  const note = await sql(page, "SELECT option_value FROM e2e_import_target.wp_options WHERE option_name = 'blogname'");
  expect(note.rows[0][0]).toBe('Note: `e2e_src_wp`.`wp_posts` stays in this text'); // strings are never rewritten

  // "See those rows": wp_options filtered to siteurl and home.
  await panel.getByRole('button', { name: 'See those rows (wp_options)' }).click();
  await expect(page.locator('.crumbs')).toContainText('wp_options');
  await expect(page.locator('table.dg tbody tr:not(.spacer)')).toHaveCount(2);
  await expect(page.locator('table.dg')).toContainText('siteurl');
  await expect(page.locator('table.dg')).toContainText('home');
});
