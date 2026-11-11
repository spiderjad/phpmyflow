<script lang="ts">
  // Charset + collation with a search box (a server lists hundreds of collations).
  import type { Charsets } from '../../lib/dbApi';
  import { t } from '../../lib/i18n.svelte';

  let { data, charset = $bindable(), collation = $bindable() }: { data: Charsets; charset: string; collation: string } = $props();

  let search = $state('');
  const cs = $derived(data.charsets.find((c) => c.name === charset));
  const list = $derived((cs?.collations ?? []).filter((c) => !search.trim() || c.toLowerCase().includes(search.trim().toLowerCase())));
  const uid = Math.random().toString(36).slice(2, 7);

  function setCharset(v: string) {
    charset = v;
    collation = data.charsets.find((c) => c.name === v)?.default ?? '';
    search = '';
  }
</script>

<div class="row2">
  <label class="field">
    <span>{t('dbform.charset')}</span>
    <select class="v-input" value={charset} onchange={(e) => setCharset((e.currentTarget as HTMLSelectElement).value)}>
      {#each data.charsets as c}<option value={c.name}>{c.name} — {c.description}</option>{/each}
    </select>
  </label>
  <div class="field">
    <label for="coll-search-{uid}"><span>{t('dbform.collation')}</span></label>
    <input id="coll-search-{uid}" class="v-input" type="search" bind:value={search} placeholder={t('dbform.searchCollation')} aria-controls="coll-list-{uid}" />
    <select id="coll-list-{uid}" class="v-input mono" size="6" bind:value={collation} aria-label={t('dbform.collation')}>
      {#each list as c}<option value={c}>{c}{c === cs?.default ? ` (${t('dbform.default')})` : ''}</option>{/each}
    </select>
  </div>
</div>

<style>
  select[size] {
    height: auto;
    padding: 2px;
    font-size: 12px;
  }
</style>
