// Text for a change description: rule names (RESTRICT, CASCADE…) become words.
import { t } from './i18n.svelte';
import type { Description } from './tableDraft';

export function describeText(d: Description): string {
  const p = { ...d.params };
  for (const k of ['onDelete', 'onUpdate']) if (p[k]) p[k] = t(`fk.word.${p[k].replace(' ', '_').toLowerCase()}`);
  return t(d.key, p);
}
