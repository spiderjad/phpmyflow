// Minimal i18n: flat JSON dictionaries, `{name}` placeholders, English fallback.
// Adding a language = add locales/xx.json and one line in LOCALES.
import en from '../locales/en.json';
import es from '../locales/es.json';
import it from '../locales/it.json';
import fr from '../locales/fr.json';

type Dict = Record<string, string>;

export const LOCALES = {
  en: { label: 'English', dict: en as Dict },
  es: { label: 'Español', dict: es as Dict },
  it: { label: 'Italiano', dict: it as Dict },
  fr: { label: 'Français', dict: fr as Dict },
} as const;

export type Locale = keyof typeof LOCALES;

const STORAGE_KEY = 'pmf_lang';

function detect(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in LOCALES) return saved as Locale;
  } catch {
    /* storage blocked: fall through */
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split('-')[0];
    if (base in LOCALES) return base as Locale;
  }
  return 'en';
}

export const i18n = $state({ locale: detect() });

export function setLocale(locale: Locale) {
  i18n.locale = locale;
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  // Singular: "{count} rows" has a "<key>.one" variant used when count is 1.
  if ('count' in params && String(params.count).replace(/[^\d]/g, '') === '1' && `${key}.one` in LOCALES.en.dict) key = `${key}.one`;
  const text = LOCALES[i18n.locale].dict[key] ?? LOCALES.en.dict[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => (name in params ? String(params[name]) : `{${name}}`));
}

/** Locale-aware number formatting (1.234 vs 1,234). */
export function n(value: number): string {
  return new Intl.NumberFormat(i18n.locale).format(value);
}

document.documentElement.lang = i18n.locale;
