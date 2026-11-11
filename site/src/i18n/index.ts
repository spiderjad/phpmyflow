import { en } from './en';
import { es } from './es';
import type { Locale } from './locales';
import type { Messages } from './types';

export * from './locales';
export type { Messages } from './types';

// Add it / fr here when their files exist (and enable them in locales.ts).
const MESSAGES: Partial<Record<Locale, Messages>> = { en, es };

export function messages(locale: Locale): Messages {
  const m = MESSAGES[locale];
  if (!m) throw new Error(`No messages for "${locale}": add src/i18n/${locale}.ts to MESSAGES`);
  return m;
}
