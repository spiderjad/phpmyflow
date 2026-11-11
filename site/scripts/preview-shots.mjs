// Full-page screenshots of the built site (desktop 1280 and mobile 375, light
// and dark, every language) and any console error (CSP violations included).
//   npm run build && npm run preview   (another terminal)
//   node scripts/preview-shots.mjs <output folder> [base URL]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'preview-shots';
const base = process.argv[3] ?? 'http://127.0.0.1:4322';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
let errors = 0;
for (const [lang, path] of [['en', '/'], ['es', '/es/']]) {
  for (const [device, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 375, height: 812 }]]) {
    for (const mode of ['light', 'dark']) {
      const page = await browser.newPage({ viewport, colorScheme: mode, deviceScaleFactor: device === 'mobile' ? 2 : 1 });
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') {
          errors++;
          console.log(`[${lang} ${device} ${mode}] ${m.type()}: ${m.text()}`);
        }
      });
      page.on('pageerror', (e) => {
        errors++;
        console.log(`[${lang} ${device} ${mode}] pageerror: ${e.message}`);
      });
      await page.goto(base + path, { waitUntil: 'networkidle' });
      // Lazy images: scroll through the page so every one is loaded before the capture.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 60));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForLoadState('networkidle');
      // Capture with a viewport as tall as the page (not fullPage stitching): the
      // sticky header stays on top and the responsive images are already chosen.
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: viewport.width, height });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) console.log(`[${lang} ${device} ${mode}] horizontal overflow: ${overflow}px`);
      await page.screenshot({ path: join(out, `site-${lang}-${device}-${mode}.png`), });
      await page.close();
    }
  }
}
await browser.close();
console.log(`done, ${errors} console errors/warnings`);
