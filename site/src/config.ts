// Everything about the site that may change lives here: URLs, the demo switch,
// contact and license. Pages read these values; nothing is repeated elsewhere.

/** Public URL (canonical links, hreflang, sitemap, Open Graph). */
export const SITE_URL = 'https://phpmyflow.spiderjad.com';

export const REPO_URL = 'https://github.com/spiderjad/phpmyflow';
/** "Download" always points to the latest GitHub release. */
export const RELEASE_URL = `${REPO_URL}/releases/latest`;
export const SECURITY_URL = `${REPO_URL}/blob/main/SECURITY.md`;
export const CONTACT_EMAIL = 'contacto@spiderjad.com';
export const AUTHOR = { name: 'spiderjad', url: 'https://github.com/spiderjad' };

/**
 * Public demo. While DEMO_ENABLED is false the button reads "Demo · coming
 * soon" and is disabled. To turn it on: set it to true, rebuild and upload
 * (docs/site-deploy.md, "Turn on the demo").
 */
export const DEMO_URL = 'https://phpmyflow.spiderjad.com/demo/';
export const DEMO_ENABLED = false;

/** null until the license is chosen: the footer shows "License: TBD". */
export const LICENSE: { name: string; url: string } | null = null;

/**
 * Analytics: none, and no cookies. To add a privacy-friendly script later,
 * set its URL here (and allow its origin in CSP_SCRIPT_EXTRA); Base.astro
 * loads it with `defer` on every page. See docs/site-deploy.md.
 */
export const ANALYTICS: { src: string; attrs?: Record<string, string> } | null = null;
/** Extra origins for the Content-Security-Policy (an analytics host, for example). */
export const CSP_SCRIPT_EXTRA: string[] = [];
export const CSP_CONNECT_EXTRA: string[] = [];
