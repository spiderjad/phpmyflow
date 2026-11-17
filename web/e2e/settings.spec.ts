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

// The accent is what signals or is chosen, in the real app (not only the live preview):
// with Forest and the violet swatch, the active tab, the current sidebar row, the main
// button ("+ Add row") and the PK badge turn violet; "A" brings Forest's own colors back.
test('a custom accent colors the active tab, the current sidebar row, "+ Add row" and the key badges; "A" brings the theme back', async ({ page }) => {
  await page.locator('nav.tables button[data-table="customers"]').click();
  await expect(page.getByRole('button', { name: '+ Add row' })).toBeVisible();
  const pick = async (accentName: string) => {
    const dlg = await openSettings(page);
    await dlg.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Light' }).click();
    const themes = dlg.getByRole('radiogroup', { name: 'Theme' });
    if ((await themes.getByRole('radio', { name: /^Forest/ }).getAttribute('aria-checked')) !== 'true') await themes.getByRole('radio', { name: /^Forest/ }).click();
    await dlg.getByRole('radiogroup', { name: 'Accent color' }).getByRole('radio', { name: accentName, exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  };
  // Hue (0-360) of the first color in a computed value: rgb(...) or color(srgb ...).
  const hues = () =>
    page.evaluate(() => {
      const hue = (css: string) => {
        const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(css) ?? /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(css);
        if (!m) return -1;
        const k = css.includes('color(srgb') ? 255 : 1;
        const [r, g, b] = m.slice(1, 4).map((x) => Number(x) * k);
        const max = Math.max(r, g, b);
        const d = max - Math.min(r, g, b);
        if (!d) return -1;
        const h = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
        return Math.round(h < 0 ? h + 360 : h);
      };
      const tab = document.querySelector('nav.tabs button.active') as HTMLElement;
      const row = document.querySelector('nav.tables button[aria-current="page"]') as HTMLElement;
      const add = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '+ Add row') as HTMLElement;
      const pk = document.querySelector('table.dg thead .ki-pk') as HTMLElement;
      const raw = { tab: getComputedStyle(tab).boxShadow, row: getComputedStyle(row).backgroundColor, add: getComputedStyle(add).backgroundColor, pk: getComputedStyle(pk).color };
      return { tab: hue(raw.tab), row: hue(raw.row), add: hue(raw.add), pk: hue(raw.pk), raw };
    });
  const violet = (h: number) => h >= 230 && h <= 300;
  const green = (h: number) => h >= 100 && h <= 170;

  // Colors ease in (CSS transitions): wait until they settle.
  const settled = async (ok: (h: { tab: number; row: number; add: number; pk: number }) => boolean) => {
    await expect.poll(async () => ok(await hues()), { message: 'active tab, current sidebar row, "+ Add row" and PK badge in the accent' }).toBe(true);
  };
  await pick('Violet');
  await settled((h) => violet(h.tab) && violet(h.row) && violet(h.add) && violet(h.pk));

  // Forest's own: green signals; its PK badge is the theme's amber, not violet any more.
  await pick("The theme's (Forest)");
  await settled((h) => green(h.tab) && green(h.row) && green(h.add) && !violet(h.pk));
});
