// Languages of the site. English lives at /, the others at /<code>/.
// To add Italian or French: write src/i18n/it.ts (same keys as en.ts, the
// compiler checks it), register it in MESSAGES (index.ts) and set
// `enabled: true` here. Pages, hreflang, the picker and the sitemap follow.

export type Locale = 'en' | 'es' | 'it' | 'fr';

export interface LocaleInfo {
  code: Locale;
  /** Native name for the language picker. */
  label: string;
  /** BCP 47 tag for <html lang> and hreflang. */
  hreflang: string;
  ogLocale: string;
  enabled: boolean;
}

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALES: LocaleInfo[] = [
  { code: 'en', label: 'English', hreflang: 'en', ogLocale: 'en_US', enabled: true },
  { code: 'es', label: 'Español', hreflang: 'es', ogLocale: 'es_ES', enabled: true },
  { code: 'it', label: 'Italiano', hreflang: 'it', ogLocale: 'it_IT', enabled: false },
  { code: 'fr', label: 'Français', hreflang: 'fr', ogLocale: 'fr_FR', enabled: false },
];

export const ENABLED_LOCALES = LOCALES.filter((l) => l.enabled);

export const localeInfo = (code: Locale): LocaleInfo => LOCALES.find((l) => l.code === code)!;

/** Home page path of a language: "/" for English, "/es/" for Spanish. */
export const homePath = (code: Locale): string => (code === DEFAULT_LOCALE ? '/' : `/${code}/`);
