<script lang="ts">
  // Language of the interface (top bar): the spider-ui select, no native control.
  import { i18n, LOCALES, setLocale, t, type Locale } from '../lib/i18n.svelte';
  import Select from './ui/Select.svelte';
</script>

<span class="lang">
  <Select compact value={i18n.locale} label={t('common.language')} options={Object.entries(LOCALES).map(([value, l]) => ({ value, label: l.label }))} onchange={(v) => setLocale(v as Locale)} />
</span>
