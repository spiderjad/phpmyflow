// schema.org data for the home page (SoftwareApplication).
import { AUTHOR, LICENSE, RELEASE_URL, REPO_URL, SITE_URL } from '../config';
import { homePath, localeInfo, messages, type Locale } from '../i18n';

export function softwareApplication(locale: Locale): object {
  const t = messages(locale);
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'phpMyFlow',
    url: new URL(homePath(locale), SITE_URL).href,
    description: t.meta.description,
    inLanguage: localeInfo(locale).hreflang,
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Database administration',
    operatingSystem: 'Any (web server with PHP 8.1+)',
    softwareRequirements: 'PHP 8.1+ with pdo_mysql and openssl; MySQL or MariaDB',
    softwareVersion: '0.1',
    downloadUrl: RELEASE_URL,
    codeRepository: REPO_URL,
    image: new URL(`/og/og-${locale}.png`, SITE_URL).href,
    screenshot: new URL(`/og/og-${locale}.png`, SITE_URL).href,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    author: { '@type': 'Person', name: AUTHOR.name, url: AUTHOR.url },
    ...(LICENSE ? { license: LICENSE.url } : {}),
  };
}
