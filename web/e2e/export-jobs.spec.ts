import { expect, test, type Page } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { login, pickDb } from './helpers';

/**
 * Export / import jobs against their own `php -S` (one request at a time,
 * this machine's php.ini), which the tests stop and start again. Uses the
 * ~50 MB pmf_big fixture (tests/php/fixtures/make_big_db.php), dropped after.
 */

const PORT = 8095;
// Playwright runs from web/.
const ROOT = resolve(process.cwd(), '..');
const DB = (process.env.PMF_TEST_DB ?? '127.0.0.1:3307:root:root').split(':');
let server: ChildProcess | null = null;

// Short steps: a fast machine exports ~20 MB per second, and the progress test needs several.
function startServer() {
  server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', join(ROOT, 'server')], { env: { ...process.env, PMF_JOB_STEP_SECONDS: '0.3' }, stdio: 'ignore' });
}
async function waitServer() {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/api.php?a=session`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('php -S did not start');
}
function stopServer() {
  if (!server) return;
  if (process.platform === 'win32' && server.pid) execFileSync('taskkill', ['/F', '/T', '/PID', String(server.pid)], { stdio: 'ignore' });
  else server.kill('SIGKILL');
  server = null;
}
function sql(statement: string) {
  return execFileSync('php', ['-r', `$p = new PDO('mysql:host=${DB[0]};port=${DB[1]}', '${DB[2]}', '${DB[3]}'); echo json_encode($p->query(${JSON.stringify(statement)})->fetchAll(PDO::FETCH_NUM));`]).toString();
}

test.describe.configure({ mode: 'serial' });
test.use({ baseURL: `http://127.0.0.1:${PORT}/` });

test.beforeAll(async () => {
  test.setTimeout(180_000);
  execFileSync('php', [join(ROOT, 'tests/php/fixtures/make_big_db.php'), DB.join(':'), '50'], { stdio: 'ignore' });
  startServer();
  await waitServer();
});
test.afterAll(() => {
  stopServer();
  execFileSync('php', ['-r', `(new PDO('mysql:host=${DB[0]};port=${DB[1]}', '${DB[2]}', '${DB[3]}'))->exec('DROP DATABASE IF EXISTS pmf_big');`]);
});

async function exportBig(page: Page) {
  await login(page);
  await pickDb(page, 'pmf_big');
  await expect(page.locator('nav.tables button[data-table="wp_posts"]')).toBeVisible();
  await page.locator('.db-head .more').click();
  await page.locator('[data-id="export"]').click();
  await page.getByRole('dialog', { name: 'Export from pmf_big' }).getByRole('button', { name: 'Export', exact: true }).click();
  const panel = page.getByRole('article', { name: 'Export pmf_big' });
  await expect(panel).toBeVisible();
  return panel;
}

test('exporting ~50 MB shows real progress (percentage, table, rows, MB) and ends with a download', async ({ page }) => {
  test.setTimeout(240_000);
  const panel = await exportBig(page);
  const bar = panel.getByRole('progressbar');
  // The percentage goes up in several steps, with the current table and counters.
  const seen = new Set<number>();
  let sawTable = false;
  let sawCounts = false;
  await expect(async () => {
    seen.add(Number(await bar.getAttribute('aria-valuenow')));
    const text = (await panel.textContent()) ?? '';
    if (/Current table\s*wp_/.test(text)) sawTable = true;
    if (/Tables\s*\d+ \/ 142/.test(text) && /File\s*[\d.,]+ MB/.test(text)) sawCounts = true;
    expect(seen.size).toBeGreaterThanOrEqual(4);
    expect(sawTable && sawCounts).toBe(true);
  }).toPass({ timeout: 120_000, intervals: [250] });

  await expect(panel).toContainText('Tables: 142', { timeout: 180_000 });
  await expect(bar).toHaveAttribute('aria-valuenow', '100');
  await expect(panel).toContainText(/Rows: 20[,.]?760/);
  const dl = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download' }).click();
  const file = join(tmpdir(), (await dl).suggestedFilename());
  await (await dl).saveAs(file);
  expect(statSync(file).size).toBeGreaterThan(40 * 1048576);
  // The download is served once; the button goes away.
  await expect(panel.getByRole('button', { name: 'Download' })).toHaveCount(0);
});

test('a step that hangs shows "Looks stopped"; "Retry this step" sends it again', async ({ page }) => {
  test.setTimeout(180_000);
  let hung = false;
  await page.route('**/api.php?a=export_step*', async (route) => {
    if (!hung) {
      hung = true;
      return; // never answered: the step hangs
    }
    await route.continue();
  });
  const panel = await exportBig(page);
  await expect(panel).toContainText('Looks stopped: no progress in 20 s.', { timeout: 40_000 });
  await expect(panel.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await panel.getByRole('button', { name: 'Retry this step' }).click();
  await expect(panel).not.toContainText('Looks stopped');
  await expect(panel).toContainText('Tables: 142', { timeout: 150_000 });
});

test('the server dies half way: the reason, how much was done, and "Resume from <table>" finish the same file', async ({ page }) => {
  test.setTimeout(300_000);
  // The export is fast locally: slow each step's answer so the server can be killed half way.
  await page.route('**/api.php?a=export_step*', async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.continue().catch(() => {});
  });
  const panel = await exportBig(page);
  const bar = panel.getByRole('progressbar');
  await expect(async () => expect(Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(5)).toPass({ timeout: 120_000 });
  expect(Number(await bar.getAttribute('aria-valuenow'))).toBeLessThan(100);
  stopServer();
  await expect(panel.getByRole('alert')).toContainText('Can’t reach the server', { timeout: 30_000 });
  await expect(panel.getByRole('alert')).toContainText(/\d+ of 142 tables were exported\./);
  const resume = panel.getByRole('button', { name: /^Resume from wp_/ });
  await expect(resume).toBeVisible();

  startServer();
  await waitServer();
  await resume.click();
  await expect(panel).toContainText('Tables: 142', { timeout: 240_000 });
  const dl = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download' }).click();
  const file = join(tmpdir(), 'resumed-' + (await dl).suggestedFilename());
  await (await dl).saveAs(file);
  // Every row exactly once: one line per row in the dump.
  const dump = readFileSync(file, 'utf8');
  const rows = (dump.match(/^\(/gm) ?? []).length;
  const expected = JSON.parse(sql("SELECT SUM(n) FROM (SELECT COUNT(*) n FROM pmf_big.wp_posts UNION ALL SELECT COUNT(*) FROM pmf_big.wp_postmeta UNION ALL SELECT COUNT(*) FROM pmf_big.wp_options UNION ALL SELECT COUNT(*) FROM pmf_big.wp_plugin_log UNION ALL SELECT 274) t"))[0][0];
  expect(rows).toBe(Number(expected));
});
