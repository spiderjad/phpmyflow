// Public website of phpMyFlow. Static: `npm run build` writes site/dist/
// (HTML, CSS, JS, images and fonts), ready to upload. docs/site-deploy.md.
import { defineConfig } from 'astro/config';
import { SITE_URL } from './src/config.ts';

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  // /es/ → dist/es/index.html: works on any Apache / LiteSpeed host without rewrites.
  trailingSlash: 'ignore',
  build: { format: 'directory', inlineStylesheets: 'never' },
  // AVIF / WebP in several widths, made by sharp at build time (src/components/Shot.astro).
  image: { service: { entrypoint: 'astro/assets/services/sharp' } },
  devToolbar: { enabled: false },
  vite: {
    // No inlined scripts or assets: the page's Content-Security-Policy allows only 'self'.
    build: { assetsInlineLimit: 0 },
  },
});
