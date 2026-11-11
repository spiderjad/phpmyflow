// /.well-known/security.txt (RFC 9116). Expires is one year after the build:
// rebuild and upload the site at least once a year (docs/site-deploy.md).
import type { APIRoute } from 'astro';
import { CONTACT_EMAIL, REPO_URL, SECURITY_URL, SITE_URL } from '../../config';

export const GET: APIRoute = () => {
  const expires = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  expires.setUTCHours(0, 0, 0, 0);
  const body = [
    `Contact: mailto:${CONTACT_EMAIL}`,
    `Contact: ${REPO_URL}/security/advisories/new`,
    `Expires: ${expires.toISOString()}`,
    `Policy: ${SECURITY_URL}`,
    'Preferred-Languages: en, es',
    `Canonical: ${new URL('/.well-known/security.txt', SITE_URL).href}`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
