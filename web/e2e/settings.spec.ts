import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/** Settings: themes and modes apply live, persist, and paint before the app loads. */

// --sp-bg of each theme (styles/themes/*.css), as the browser reports it.
const BG: Record<string, { light: string; dark: string }> = {
  monochrome: { light: 'rgb(255, 255, 255)', dark: 'rgb(10, 10, 10)' },
  graphite: { light: 'rgb(253, 252, 251)', dark: 'rgb(20, 18, 16)' },
  slate: { light: 'rgb(255, 255, 255)', dark: 'rgb(11, 17, 32)' },
  spider: { light: 'rgb(255, 255, 255)', dark: 'rgb(13, 10, 20)' },
  forest: { light: 'rgb(255, 255, 255)', dark: 'rgb(10, 17, 13)' },
  contrast: { light: 'rgb(255, 255, 255)', dark: 'rgb(0, 0, 0)' },
};
const NAMES: Record<string, string> = { monochrome: 'Monochrome', graphite: 'Graphite', slate: 'Slate', spider: 'Spider', forest: 'Forest', contrast: 'High contrast' };

const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const html = (page: Page) => page.evaluate(() => ({ theme: document.documentElement.dataset.theme, mode: document.documentElement.dataset.mode }));

async function openSettings(page: Page) {
  await page.keyboard.press('Control+,');
  const dlg = page.getByRole('dialog', { name: 'Settings' });
  await expect(dlg).toBeVisible();
  return dlg;
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('the gear and Ctrl+, open Settings; sections and the live preview are there', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Settings' });
  await expect(dlg).toBeVisible();
  for (const s of ['Appearance', 'SQL editor', 'Data and grid', 'Connections', 'General']) await expect(dlg.getByRole('navigation').getByRole('button', { name: s })).toBeVisible();
  await expect(dlg.getByRole('figure', { name: 'Live preview' })).toBeVisible();
  await expect(dlg.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await openSettings(page);
});

test('every theme in light and dark applies without reloading and persists after a reload', async ({ page }) => {
  test.slow();
  const dlg = await openSettings(page);
  const modes = dlg.getByRole('radiogroup', { name: 'Mode' });
  const themes = dlg.getByRole('radiogroup', { name: 'Theme' });
  for (const theme of Object.keys(BG)) {
    for (const mode of ['light', 'dark'] as const) {
      await modes.getByRole('radio', { name: mode === 'light' ? 'Light' : 'Dark' }).click();
      await themes.getByRole('radio', { name: new RegExp(`^${NAMES[theme]}`) }).click();
      await expect(themes.getByRole('radio', { name: new RegExp(`^${NAMES[theme]}`) })).toHaveAttribute('aria-checked', 'true');
      expect(await html(page)).toEqual({ theme, mode });
      expect(await bodyBg(page)).toBe(BG[theme][mode]);
    }
  }
  // Last choice: High contrast / dark. A reload keeps it.
  await page.reload();
  expect(await html(page)).toEqual({ theme: 'contrast', mode: 'dark' });
  expect(await bodyBg(page)).toBe(BG.contrast.dark);
});

test('no flash: the saved theme is on <html> before the app script runs', async ({ page }) => {
  const dlg = await openSettings(page);
  await dlg.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Dark' }).click();
  await dlg.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: /^Slate/ }).click();
  // Hold the app bundle: whatever is painted meanwhile comes from the inline script + CSS.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/assets/*.js', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/', { waitUntil: 'commit' });
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme ?? null)).toBe('slate');
  await expect.poll(() => bodyBg(page)).toBe(BG.slate.dark);
  expect(await page.evaluate(() => document.getElementById('app')?.childElementCount ?? -1)).toBe(0); // app not mounted yet
  expect(await html(page)).toEqual({ theme: 'slate', mode: 'dark' });
  release();
  await expect(page.locator('#db-select')).toBeVisible();
});

test('reset section, data settings and the editor follow Settings', async ({ page }) => {
  const dlg = await openSettings(page);
  await dlg.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: /^Forest/ }).click();
  await dlg.getByRole('button', { name: 'Reset section' }).click();
  expect((await html(page)).theme).toBe('monochrome');

  await dlg.getByRole('navigation').getByRole('button', { name: 'Data and grid' }).click();
  await dlg.getByRole('radiogroup', { name: 'Related records' }).getByRole('radio', { name: 'Name only' }).click();
  await dlg.getByRole('radiogroup', { name: 'Date format' }).getByRole('radio', { name: 'ISO' }).click();
  await page.keyboard.press('Escape');
  await page.locator('nav.tables button[data-table="departamentos"]').click();
  const cell = page.locator('table.dg td[data-r="0"][data-c="2"]');
  await expect(cell).toHaveText('Planta Norte');
  await page.locator('nav.tables button[data-table="customers"]').click();
  await expect(page.locator('table.dg td', { hasText: '2026-01-12 10:00:00' })).toBeVisible();
});
