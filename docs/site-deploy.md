# Public website: build and deploy

The website at <https://phpmyflow.spiderjad.com> lives in `site/`. It is a
static [Astro](https://astro.build) site: the build writes plain HTML, CSS, JS,
images and fonts to `site/dist/`. No server code, no database, no cookies.

It is **not** part of the phpMyFlow release (that is only `server/`).

## Build

Requirements on your computer only: Node.js 22 LTS or newer and npm.

```bash
cd site
npm ci
npm run build      # → site/dist/
npm run preview    # optional: http://127.0.0.1:4322
```

Or, on Windows, one step that also makes the zip to upload:

```powershell
.\scripts\build-site.ps1    # → site-dist.zip at the repository root
```

The zip contains the **contents** of `site/dist/` (`index.html` at its root,
plus the hidden `.htaccess` and `.well-known/`) and never a `demo/` folder.

## Upload to Hostinger

The subdomain `phpmyflow.spiderjad.com` must point to `public_html/phpmyflow/`
(hPanel → Domains → Subdomains) and have SSL enabled (hPanel → Security → SSL).
The `.htaccess` forces HTTPS, so without a certificate the site won't load.

1. hPanel → **Files → File Manager** → open `public_html/phpmyflow/`.
2. **Do not touch the `demo/` subfolder** if it exists: it is the live demo.
3. Optional cleanup of the previous version: delete the old `_astro/` folder
   (only the site's hashed CSS, JS, fonts and images; the demo keeps its own
   files inside `demo/`). Without this, old files simply pile up.
4. Upload `site-dist.zip`, right-click it → **Extract** → into the current
   folder (`public_html/phpmyflow/`), overwriting existing files.
5. Delete `site-dist.zip` from the server.
6. Hidden files: turn on "Show hidden files" in the File Manager settings and
   check that `.htaccess` and `.well-known/security.txt` are there.

Without the zip: upload everything **inside** `site/dist/` (not the folder
itself), including `.htaccess`, `_astro/` and `.well-known/`.

### Check after uploading

- <https://phpmyflow.spiderjad.com/> and <https://phpmyflow.spiderjad.com/es/> open, with images, in light and dark.
- `http://phpmyflow.spiderjad.com/` redirects to `https://`.
- <https://phpmyflow.spiderjad.com/no-such-page> shows the 404 page.
- <https://phpmyflow.spiderjad.com/.well-known/security.txt>, `/sitemap.xml` and `/robots.txt` answer.
- Headers: `curl -sI https://phpmyflow.spiderjad.com/_astro/<any file>` shows
  `Cache-Control: public, max-age=31536000, immutable`; the HTML shows `no-cache`.
- If `/demo/` exists, it still works.
- Scores: <https://pagespeed.web.dev/> with the public URL (mobile and desktop).

### What the `.htaccess` does

- Forces HTTPS (301), sets `Strict-Transport-Security`, `nosniff`,
  `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN` and `Permissions-Policy`.
- 404 → `/404.html`; no directory listings.
- Cache: HTML, `sitemap.xml`, `robots.txt` revalidate every time (`no-cache`),
  so a new upload shows at once; icons and social images one week;
  `_astro/` (file names change with their content) one year, immutable,
  through `_astro/.htaccess`.
- These rules also reach `demo/` (HTTPS, generic headers). The site's
  Content-Security-Policy is a `<meta>` tag inside its pages, so it never
  applies to the demo.

## Turn on the demo

The demo link is controlled in one place: `site/src/config.ts`.

```ts
export const DEMO_URL = 'https://phpmyflow.spiderjad.com/demo/';
export const DEMO_ENABLED = false;
```

While `DEMO_ENABLED` is `false`, the hero shows **"Demo · coming soon"**
("Demo · próximamente") as a disabled button. To turn it on:

1. Install the demo in `public_html/phpmyflow/demo/`: a phpMyFlow release with
   a `config.php` that lists only the demo server, `'read_only' => true`,
   `'allow_custom_host' => false`, and a MySQL user with read-only grants
   (like `demo` in `docker/sample.sql`). Never real data.
2. Set `DEMO_ENABLED = true` (and `DEMO_URL` if the address changes).
3. Rebuild (`npm run build` or `scripts/build-site.ps1`) and upload as above.

The button then becomes the link "Try the demo" / "Probar la demo".

## Edit the site

| What | Where |
|---|---|
| Texts (every section, both languages) | `site/src/i18n/en.ts`, `site/src/i18n/es.ts` (`astro check` fails if a key is missing) |
| URLs, demo, contact, license, analytics | `site/src/config.ts` |
| Sections and markup | `site/src/components/Home.astro` |
| Styles (spider-ui tokens + `ws-` layout) | `site/src/styles/site.css` |
| Server rules | `site/public/.htaccess`, `site/public/_astro/.htaccess` |

When the license is chosen, set `LICENSE` in `config.ts`: the footer and the
JSON-LD pick it up (the footer says "License: TBD" until then).

### Add Italian or French

1. Copy `site/src/i18n/en.ts` to `it.ts` and translate it (same keys).
2. Register it in `MESSAGES` in `site/src/i18n/index.ts` and in `scripts/og.mjs`.
3. Set `enabled: true` for `it` in `site/src/i18n/locales.ts`.
4. `node scripts/og.mjs` (social image) and build: `/it/`, the language
   picker, hreflang and the sitemap follow.

### Screenshots and the social image

Screenshots come **only** from the sample database (`docker/sample.sql`),
never from real data:

```bash
docker run -d --name pmf-site-shots -e MARIADB_ROOT_PASSWORD=root -p 127.0.0.1:3310:3306 \
  -v "$PWD/docker/sample.sql:/docker-entrypoint-initdb.d/01-sample.sql:ro" mariadb:11
cd server && php -S 127.0.0.1:8090        # another terminal (needs allow_custom_host)
cd site && npm run shots                  # → src/assets/shots/<id>-light|dark.png
npm run og                                # → public/og/og-<lang>.png (1200×630)
docker rm -f pmf-site-shots
```

`node scripts/preview-shots.mjs <folder>` (with `npm run preview` running)
captures the built site at 1280 and 375 px, light and dark, in every language,
and reports console errors and horizontal overflow.

### Analytics (none today)

The site has no trackers and sets no cookies. To add a privacy-friendly,
cookieless script later (for example a self-hosted Plausible or Umami), set
`ANALYTICS` in `site/src/config.ts` and add its origin to `CSP_SCRIPT_EXTRA`
(and `CSP_CONNECT_EXTRA` if it sends data to another host). `Base.astro`
loads it with `defer` on every page. Anything that sets cookies would need a
consent banner first.

### security.txt

`/.well-known/security.txt` (RFC 9116) is generated at build time with
`Expires` one year later. **Rebuild and upload the site at least once a year**
so it never expires. It lists `contacto@spiderjad.com`, GitHub's private
vulnerability reporting and `SECURITY.md` as the policy.
