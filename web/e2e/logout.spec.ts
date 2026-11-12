import { expect, test } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import { login } from './helpers';

/** Sign out with a modal; inactivity warning a minute before the session expires. */

test('"Sign out" with a modified SQL tab warns; Cancel keeps the session', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'SQL', exact: true }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.type('SELECT 1');
  await page.getByRole('button', { name: 'Sign out' }).click();
  const dlg = page.getByRole('dialog', { name: 'Sign out?' });
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('root@127.0.0.1');
  await expect(dlg).toContainText('1 SQL tab with changes not run');
  await expect(dlg).not.toContainText('will be lost');
  await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeFocused();
  // Nothing is lost (tabs are kept): the sign out button is not red.
  await expect(dlg.getByRole('button', { name: 'Sign out' })).toHaveClass(/v-btn-primary/);
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('#db-select')).toBeVisible();

  // Sign out for real, forgetting the connection.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await dlg.getByLabel('Forget this connection: recent list, SQL history and tabs in this browser').check();
  await dlg.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pmf.login.recent') ?? '[]').length)).toBe(0);
  // Its SQL history and saved tabs are gone from this browser too.
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /^pmf_(history|tabs):root@/.test(k)))).toEqual([]);
});

test.describe('inactivity', () => {
  const PORT = 8093;
  let server: ChildProcess | null = null;
  test.use({ baseURL: `http://127.0.0.1:${PORT}/` });
  test.beforeAll(async () => {
    server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', join(resolve(process.cwd(), '..'), 'server')], { env: { ...process.env, PMF_SESSION_IDLE_SECONDS: '120' }, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
      try {
        await fetch(`http://127.0.0.1:${PORT}/api.php?a=session`);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  });
  test.afterAll(() => {
    if (server?.pid && process.platform === 'win32') execFileSync('taskkill', ['/F', '/T', '/PID', String(server.pid)], { stdio: 'ignore' });
    else server?.kill('SIGKILL');
  });

  test('a minute before the 2-minute limit: countdown; "Stay signed in" renews it on the server', async ({ page }) => {
    // A login request answered after the clock jump counts as activity (and renews the
    // session): count the API requests in flight and jump only when none is left.
    let inflight = 0;
    const done = (r: { url(): string }) => r.url().includes('api.php') && inflight--;
    page.on('request', (r) => r.url().includes('api.php') && inflight++);
    page.on('requestfinished', done);
    page.on('requestfailed', done);
    await page.clock.install();
    await login(page);
    const dlg = page.getByRole('dialog', { name: 'Still there?' });
    await expect(dlg).toBeHidden();
    await expect(page.locator('nav.tables button[data-table="customers"]')).toBeVisible();
    await expect.poll(() => inflight, { intervals: [100] }).toBe(0);
    await page.clock.fastForward(61_000);
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText(/Your session will end in 0:5\d for inactivity/);
    await expect(dlg.getByRole('button', { name: 'Stay signed in' })).toBeFocused();
    // The time left is announced every 15 s, not every second.
    const live = dlg.locator('[aria-live="polite"]');
    const first = await live.textContent();
    await page.clock.fastForward(5_000);
    expect(await live.textContent()).toBe(first);

    const renewed = page.waitForResponse((r) => r.url().includes('a=keepalive') && r.status() === 200);
    await dlg.getByRole('button', { name: 'Stay signed in' }).click();
    expect((await (await renewed).json()).idleSeconds).toBe(120);
    await expect(dlg).toBeHidden();
    await expect(page.locator('#db-select')).toBeVisible();
  });
});
