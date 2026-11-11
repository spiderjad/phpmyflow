import { expect, test } from '@playwright/test';

/** Login screen: recent connections fill the form in one click. */

const SERVER = process.env.PMF_E2E_SERVER ?? '3307';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate((port) => {
    localStorage.clear();
    localStorage.setItem(
      'pmf.login.recent',
      JSON.stringify([
        { host: '127.0.0.1', port: Number(port), user: 'root', ssl: null, label: null, at: 2 },
        { host: '127.0.0.1', port: Number(port), user: 'demo', ssl: null, label: null, at: 1 },
      ]),
    );
  }, SERVER);
  await page.reload();
});

test('a recent connection fills server and user and focuses the password; signing in keeps it first', async ({ page }) => {
  const cards = page.getByRole('region', { name: 'Recent connections' }).getByRole('button', { name: /^Sign in as/ });
  await expect(cards).toHaveCount(2);
  // The newest one is preselected; pick the other one.
  await expect(page.locator('#lg-user')).toHaveValue('root');
  await page.locator('#lg-user').fill('');
  await cards.nth(1).click();
  await expect(page.locator('#lg-user')).toHaveValue('demo');
  await expect(page.locator('#lg-pw')).toBeFocused();
  await expect(page.locator('#lg-server')).toContainText(SERVER);

  // Reachable with Tab: the first card, then its "forget" button.
  await cards.first().focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /^Forget root/ })).toBeFocused();

  await cards.first().click();
  await page.locator('#lg-pw').fill('root');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#db-select')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pmf.login.recent') ?? '[]'));
  expect(saved.map((r: { user: string }) => r.user)).toEqual(['root', 'demo']);
});

test('"×" forgets a recent connection; a wrong password marks the fields', async ({ page }) => {
  await page.getByRole('button', { name: /^Forget demo/ }).click();
  await expect(page.getByRole('region', { name: 'Recent connections' }).getByRole('button', { name: /^Sign in as/ })).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pmf.login.recent') ?? '[]').length)).toBe(1);

  await page.locator('#lg-pw').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Wrong user, password or server');
  await expect(page.locator('#lg-pw')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#lg-user')).toHaveAttribute('aria-invalid', 'true');
});

test('"Other server…" shows host and port; theme buttons are a radio group', async ({ page }) => {
  await page.locator('#lg-server').click();
  await page.getByRole('option', { name: 'Other server…' }).click();
  await expect(page.locator('#lg-host')).toBeVisible();
  await expect(page.locator('#lg-port')).toBeVisible();
  const modes = page.getByRole('radiogroup', { name: 'Theme' });
  await modes.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  await page.keyboard.press('ArrowRight'); // → System
  await expect(modes.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
});
