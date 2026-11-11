// Social images (Open Graph / Twitter, 1200×630) for each language:
// public/og/og-<locale>.png, from the hero screenshot and the hero text.
//   npm run shots (once) && node scripts/og.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ENABLED_LOCALES } from '../src/i18n/locales.ts';
import { en } from '../src/i18n/en.ts';
import { es } from '../src/i18n/es.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MESSAGES = { en, es };
const url = (p) => pathToFileURL(join(ROOT, p)).href;
const OUT = join(ROOT, 'public/og');
mkdirSync(OUT, { recursive: true });

const page = (t) => `<!doctype html><html data-theme="light"><head><meta charset="utf-8">
<link rel="stylesheet" href="${url('node_modules/spider-ui/tokens.css')}">
<style>
  @font-face { font-family: 'Inter Variable'; font-weight: 100 900; src: url('${url('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')}') format('woff2'); }
  @font-face { font-family: 'Inter Variable'; font-weight: 100 900; src: url('${url('node_modules/@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2')}') format('woff2'); unicode-range: U+0100-024F; }
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
  body { position: relative; background: var(--sp-bg-subtle); font-family: var(--sp-font); color: var(--sp-text-primary); }
  .text { position: absolute; left: 72px; top: 76px; width: 470px; }
  .brand { display: flex; align-items: center; gap: 14px; font-size: 30px; font-weight: 650; letter-spacing: -0.02em; }
  .brand img { width: 52px; height: 52px; }
  h1 { margin: 44px 0 0; font-size: 60px; line-height: 1.03; font-weight: 700; letter-spacing: -0.045em; }
  p { margin: 24px 0 0; font-size: 24px; line-height: 1.4; color: var(--sp-text-secondary); }
  .eyebrow { margin-top: 40px; font-size: 15px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--sp-text-secondary); }
  .shot { position: absolute; left: 600px; top: 64px; width: 960px; border: 1px solid var(--sp-border); border-radius: var(--sp-radius-lg); overflow: hidden; box-shadow: var(--sp-shadow-lg); background: var(--sp-bg); }
  .shot img { display: block; width: 100%; }
</style></head><body>
  <div class="text">
    <div class="brand"><img src="${url('public/favicon.svg')}" alt="">phpMyFlow</div>
    <h1>${t.hero.title}</h1>
    <p>${t.hero.subtitle}</p>
    <div class="eyebrow">${t.hero.eyebrow}</div>
  </div>
  <div class="shot"><img src="${url('src/assets/shots/hero-light.png')}" alt=""></div>
</body></html>`;

const tmp = mkdtempSync(join(tmpdir(), 'pmf-og-'));
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const { code } of ENABLED_LOCALES) {
  const t = MESSAGES[code];
  if (!t) throw new Error(`og.mjs: add the ${code} messages`);
  // A file:// page (setContent can't load the local CSS, font and images).
  const html = join(tmp, `og-${code}.html`);
  writeFileSync(html, page(t));
  await tab.goto(pathToFileURL(html).href, { waitUntil: 'load' });
  await tab.evaluate(() => document.fonts.ready);
  await tab.screenshot({ path: join(OUT, `og-${code}.png`) });
  console.log(`wrote public/og/og-${code}.png`);
}
await browser.close();
rmSync(tmp, { recursive: true, force: true });
