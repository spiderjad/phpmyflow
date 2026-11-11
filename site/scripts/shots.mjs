// Screenshots of the app for the website, in light and dark, from the sample
// database only (docker/sample.sql). Never point this at real data.
//
//   1. A fresh MariaDB with the sample (port 3310 by default):
//        docker run -d --name pmf-site-shots -e MARIADB_ROOT_PASSWORD=root -p 127.0.0.1:3310:3306 \
//          -v "$PWD/docker/sample.sql:/docker-entrypoint-initdb.d/01-sample.sql:ro" mariadb:11
//   2. The app:  cd server && php -S 127.0.0.1:8090   (allow_custom_host on, as in development)
//   3. cd site && npm run shots   → src/assets/shots/<id>-<light|dark>.png  and public/og/
//
// Env: SHOTS_APP (default http://127.0.0.1:8090/), SHOTS_DB (host:port:user:password, default 127.0.0.1:3310:root:root).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/assets/shots');
const APP = process.env.SHOTS_APP ?? 'http://127.0.0.1:8090/';
const [host, port, user, password] = (process.env.SHOTS_DB ?? '127.0.0.1:3310:root:root').split(':');
const only = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });

const settle = (page, ms = 400) => page.waitForTimeout(ms);

// Sign in through the API before the app loads (a session request still in
// flight from the app would bring back the old cookie), then open the app.
async function signIn(page) {
  const session = await (await page.request.get(`${APP}api.php?a=session`)).json();
  const r = await page.request.post(`${APP}api.php?a=login`, {
    headers: { 'X-CSRF-Token': session.csrf },
    data: { host, port: Number(port), user, password },
  });
  if (!r.ok()) throw new Error(`login failed: ${await r.text()}`);
  await page.goto(APP);
  await page.locator('#db-select').waitFor();
  const db = page.locator('#db-select');
  if (!((await db.textContent()) ?? '').trim().startsWith('shop ·')) {
    await db.click();
    await page.getByRole('listbox').getByRole('option', { name: /^shop ·/ }).click();
  }
  await page.locator('nav.tables button[data-table="orders"]').waitFor();
}

const table = async (page, name) => {
  await page.locator(`nav.tables button[data-table="${name}"]`).click();
  await page.locator('table.dg td[data-r="0"]').first().waitFor();
};
const view = (page, name) => page.locator('header').getByRole('button', { name, exact: true }).click();

/** id → steps that leave the app showing what the screenshot is about. */
const SHOTS = {
  hero: async (page) => {
    await table(page, 'orders');
    await page.locator('table.dg td[data-r="1"][data-c="2"]').click();
    await page.getByRole('button', { name: 'Show row 2 details' }).click();
    await page.waitForTimeout(500);
  },
  grid: async (page) => {
    // The record picker on a related column: names instead of ids.
    await table(page, 'departamentos');
    await page.locator('table.dg td[data-r="2"][data-c="2"]').dblclick();
    await page.getByRole('listbox').first().waitFor();
    await page.waitForTimeout(500);
  },
  sql: async (page) => {
    await view(page, 'SQL');
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('SELECT c.name, COUNT(o.id) AS orders\nFROM custmers c\nLEFT JOIN orders o ON o.customer_id = c.id\nGROUP BY c.id\nORDER BY orders DESC;', { delay: 5 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500); // lint (schema + EXPLAIN)
    await page.locator('.cm-lintRange-error, .cm-lintRange-warning').first().hover();
    await page.waitForTimeout(600);
  },
  structure: async (page) => {
    await table(page, 'products');
    await view(page, 'Structure');
    await page.waitForTimeout(800);
  },
  relations: async (page) => {
    await table(page, 'orders');
    await view(page, 'Relations');
    await page.waitForTimeout(1500);
  },
  export: async (page) => {
    await page.locator('.db-head .more').click();
    await page.locator('[data-id="export"]').click();
    await page.getByRole('dialog').first().waitFor();
    await page.waitForTimeout(400);
  },
  monitor: async (page) => {
    await view(page, 'Monitor');
    await page.waitForTimeout(7000); // a few samples for the charts
  },
};

const browser = await chromium.launch();
for (const mode of ['light', 'dark']) {
  for (const [id, steps] of Object.entries(SHOTS)) {
    if (only.length && !only.includes(id)) continue;
    // A fresh browser for each one: same starting point, nothing left from the previous shot.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, colorScheme: mode, locale: 'en-US', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await signIn(page);
    await steps(page);
    await settle(page);
    const file = join(OUT, `${id}-${mode}.png`);
    await page.screenshot({ path: file });
    console.log('wrote', file);
    await ctx.close();
  }
}
await browser.close();
