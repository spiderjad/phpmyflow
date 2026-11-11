import type { APIRoute } from 'astro';
import { SITE_URL } from '../config';

// The demo (/demo/) is the app itself: nothing to index there.
export const GET: APIRoute = () =>
  new Response(`User-agent: *\nAllow: /\nDisallow: /demo/\n\nSitemap: ${new URL('/sitemap.xml', SITE_URL).href}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
