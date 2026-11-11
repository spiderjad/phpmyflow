import { expect, type Page } from '@playwright/test';

/**
 * Sign in to the sample database. Defaults match docker/sample.sql
 * (root/root on the server whose label or host contains PMF_E2E_SERVER).
 */
export async function login(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  // The server picker is a listbox button (ui/Select), not a native <select>.
  // Wait for the form first: checking before it renders would skip the choice.
  await page.locator('input[autocomplete="username"]').waitFor();
  const server = page.locator('form button[aria-haspopup="listbox"]').first();
  if (await server.count()) {
    const wanted = process.env.PMF_E2E_SERVER ?? '3307';
    if (!((await server.textContent()) ?? '').includes(wanted)) {
      await server.click();
      await page.getByRole('listbox').waitFor();
      const option = page.getByRole('option').filter({ hasText: wanted }).first();
      if (await option.count()) {
        await option.click();
        await expect(server).toContainText(wanted);
      } else await page.keyboard.press('Escape');
    }
  }
  await page.locator('input[autocomplete="username"]').fill(process.env.PMF_E2E_USER ?? 'root');
  await page.locator('input[type="password"]').fill(process.env.PMF_E2E_PASSWORD ?? 'root');
  await page.locator('button[type="submit"]').click();
  await pickDb(page, 'shop');
  await expect(page.locator('nav.tables button[data-table="orders"]')).toBeVisible();
}

/** Replace the editor content and run it with Ctrl+Enter. */
export async function runSql(page: Page, sql: string) {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(sql);
  await page.keyboard.press('Escape'); // close autocomplete
  await page.keyboard.press('Control+Enter');
}

/** Choose a database in the sidebar (a spider-ui select: button + listbox). */
export async function pickDb(page: Page, name: string) {
  const btn = page.locator('#db-select');
  await btn.waitFor();
  if (((await btn.textContent()) ?? '').trim().startsWith(`${name} ·`)) return;
  await btn.click();
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('listbox').getByRole('option', { name: new RegExp(`^${esc} ·`) }).click();
  await expect(btn).toContainText(`${name} ·`);
}
