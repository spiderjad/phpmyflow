// sitemap.xml: the home page in every enabled language, with hreflang alternates.
import type { APIRoute } from 'astro';
import { SITE_URL } from '../config';
import { DEFAULT_LOCALE, ENABLED_LOCALES, homePath } from '../i18n';

export const GET: APIRoute = () => {
  const abs = (p: string) => new URL(p, SITE_URL).href;
  const alternates = [
    ...ENABLED_LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l.hreflang}" href="${abs(homePath(l.code))}"/>`),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${abs(homePath(DEFAULT_LOCALE))}"/>`,
  ].join('\n');
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = ENABLED_LOCALES.map(
    (l) => `  <url>\n    <loc>${abs(homePath(l.code))}</loc>\n    <lastmod>${lastmod}</lastmod>\n${alternates}\n  </url>`,
  ).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
