<script lang="ts">
  // Settings (gear icon / Ctrl+,): native <dialog> with section navigation.
  // Every change applies at once and is saved per user@host (no Save button).
  import { tick } from 'svelte';
  import { i18n, LOCALES, setLocale, t, type Locale } from '../../lib/i18n.svelte';
  import { app } from '../../lib/state.svelte';
  import {
    DATES, EDITOR_FONT_SIZES, exportSettings, importSettings, PER_PAGE, RELATIONS, resetSection, settings, settingsMeta, START_TABS, SYNTAX, update, resetConnections, type Section,
  } from '../../lib/settings.svelte';
  import { FONT_SIZES } from '../../lib/theme';
  import { formatDate } from '../../lib/grid';
  import { toast } from '../../lib/ui.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Select from '../ui/Select.svelte';
  import Switch from '../structure/Switch.svelte';
  import AccentPicker from './AccentPicker.svelte';
  import ConnectionsSection from './ConnectionsSection.svelte';
  import LivePreview from './LivePreview.svelte';
  import ThemeCards from './ThemeCards.svelte';

  type Tab = Section | 'connections';
  const TABS: Tab[] = ['appearance', 'editor', 'data', 'connections', 'general'];

  let dlg: HTMLDialogElement | undefined = $state();
  let tab = $state<Tab>('appearance');
  let fileInput: HTMLInputElement | undefined = $state();
  let newPattern = $state('');
  function addPattern(e: SubmitEvent) {
    e.preventDefault();
    const v = newPattern.trim().toLowerCase();
    if (v && !settings.data.sensitive.includes(v)) update('data', { sensitive: [...settings.data.sensitive, v] });
    newPattern = '';
  }
  const locked = $derived(settingsMeta.locked);

  export async function open(section?: Tab) {
    if (section) tab = section;
    dlg?.showModal();
    await tick();
    document.getElementById(`st-nav-${tab}`)?.focus();
  }

  function reset() {
    if (tab === 'connections') resetConnections();
    else resetSection(tab);
    toast(t('settings.resetDone', { section: t(`settings.tab.${tab}`) }), 'success', 2500);
  }

  function download() {
    const blob = new Blob([exportSettings()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'phpmyflow-settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function upload(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const r = importSettings(await file.text());
    if (r.ok) toast(t('settings.imported'), 'success');
    else toast(t(`settings.importError.${r.error}`), 'error');
  }

  function navKey(e: KeyboardEvent, i: number) {
    const j = e.key === 'ArrowDown' ? (i + 1) % TABS.length : e.key === 'ArrowUp' ? (i - 1 + TABS.length) % TABS.length : -1;
    if (j < 0) return;
    e.preventDefault();
    tab = TABS[j];
    void tick().then(() => document.getElementById(`st-nav-${TABS[j]}`)?.focus());
  }

  const seg = <T extends string | number>(values: readonly T[], key: (v: T) => string) => values.map((v) => ({ value: String(v) as `${T}`, label: key(v) }));
  const sample = '-- ' + 'orders of this year\nSELECT o.id, c.name, SUM(i.qty * i.price) AS total\nFROM orders o JOIN customers c ON c.id = o.customer_id\nWHERE o.created_at >= \'2026-01-01\' AND o.status = 1';
</script>

<dialog bind:this={dlg} class="v-app v-dialog st" aria-labelledby="st-title">
  <header class="v-card__header st-head">
    <h2 class="v-card__title" id="st-title">{t('settings.title')}</h2>
    <div class="st-head-actions">
      <button class="v-btn-secondary v-btn--sm" onclick={download}>{t('settings.export')}</button>
      <button class="v-btn-secondary v-btn--sm" onclick={() => fileInput?.click()}>{t('settings.import')}</button>
      <input bind:this={fileInput} type="file" accept="application/json,.json" hidden onchange={upload} />
      <button class="v-btn-icon" aria-label={t('common.close')} onclick={() => dlg?.close()}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
      </button>
    </div>
  </header>

  <div class="st-body" class:with-preview={tab === 'appearance'}>
    <nav class="st-nav" aria-label={t('settings.sections')}>
      {#each TABS as s, i}
        <button id="st-nav-{s}" class:active={tab === s} aria-current={tab === s ? 'page' : undefined} onclick={() => (tab = s)} onkeydown={(e) => navKey(e, i)}>
          {t(`settings.tab.${s}`)}
        </button>
      {/each}
    </nav>

    <section class="st-main" aria-labelledby="st-sec-title">
      <div class="st-sec-head">
        <h3 id="st-sec-title">{t(`settings.tab.${tab}`)}</h3>
        <button class="v-btn-ghost v-btn--sm" onclick={reset} disabled={tab === 'appearance' && locked}>{t('settings.reset')}</button>
      </div>

      {#if tab === 'appearance'}
        {#if locked}<p class="v-banner v-banner--info">{t('settings.locked')}</p>{/if}
        <fieldset class="st-fs" disabled={locked}>
          <div class="st-row">
            <span class="st-lbl">{t('settings.mode')}</span>
            <Segmented label={t('settings.mode')} value={settings.appearance.mode} options={[{ value: 'light', label: t('theme.light') }, { value: 'dark', label: t('theme.dark') }, { value: 'system', label: t('theme.system') }]} onchange={(v) => update('appearance', { mode: v })} />
          </div>
          <div class="st-block">
            <span class="st-lbl">{t('settings.theme')}</span>
            <ThemeCards value={settings.appearance.theme} disabled={locked} onchange={(v) => update('appearance', { theme: v })} />
          </div>
          <div class="st-block">
            <span class="st-lbl">{t('settings.accent')}</span>
            <AccentPicker value={settings.appearance.accent} disabled={locked} onchange={(v) => update('appearance', { accent: v })} />
          </div>
          <div class="st-row">
            <span class="st-lbl">{t('settings.density')}</span>
            <Segmented label={t('settings.density')} value={settings.appearance.density} options={[{ value: 'compact', label: t('grid.compact') }, { value: 'comfortable', label: t('grid.comfortable') }]} onchange={(v) => update('appearance', { density: v })} />
          </div>
          <div class="st-row">
            <span class="st-lbl">{t('settings.radius')}</span>
            <Segmented label={t('settings.radius')} value={settings.appearance.radius} options={[{ value: 'sharp', label: t('settings.radius.sharp') }, { value: 'soft', label: t('settings.radius.soft') }, { value: 'round', label: t('settings.radius.round') }]} onchange={(v) => update('appearance', { radius: v })} />
          </div>
          <div class="st-row">
            <span class="st-lbl">{t('settings.fontSize')}</span>
            <Segmented label={t('settings.fontSize')} value={String(settings.appearance.fontSize)} options={seg(FONT_SIZES, (v) => `${v} px`)} onchange={(v) => update('appearance', { fontSize: Number(v) as 13 })} />
          </div>
        </fieldset>
      {:else if tab === 'editor'}
        <div class="st-row">
          <span class="st-lbl">{t('settings.editorFont')}</span>
          <Segmented label={t('settings.editorFont')} value={String(settings.editor.fontSize)} options={seg(EDITOR_FONT_SIZES, (v) => `${v}`)} onchange={(v) => update('editor', { fontSize: Number(v) as 13 })} />
        </div>
        <div class="st-block">
          <div class="st-row flat">
            <span class="st-lbl">{t('settings.syntax')}</span>
            <Segmented label={t('settings.syntax')} value={settings.editor.syntax} options={seg(SYNTAX, (v) => t(`settings.syntax.${v}`))} onchange={(v) => update('editor', { syntax: v })} />
          </div>
          <pre class="st-code" aria-label={t('settings.syntaxSample')}><span class="c">{sample.split('\n')[0]}</span>
<span class="k">SELECT</span> o.id, c.name, <span class="ty">SUM</span>(i.qty * i.price) <span class="k">AS</span> total
<span class="k">FROM</span> orders o <span class="k">JOIN</span> customers c <span class="k">ON</span> c.id = o.customer_id
<span class="k">WHERE</span> o.created_at &gt;= <span class="s">'2026-01-01'</span> <span class="k">AND</span> o.status = <span class="n">1</span></pre>
        </div>
        <div class="st-row">
          <span class="st-lbl">{t('settings.upperKeywords')}<span class="v-help">{t('settings.upperKeywordsHelp')}</span></span>
          <Switch checked={settings.editor.upperKeywords} label={t('settings.upperKeywords')} onchange={(v) => update('editor', { upperKeywords: v })} />
        </div>
        <div class="st-row">
          <span class="st-lbl">{t('settings.lint')}<span class="v-help">{t('settings.lintHelp')}</span></span>
          <Switch checked={settings.editor.lint} label={t('settings.lint')} onchange={(v) => update('editor', { lint: v })} />
        </div>
        <div class="st-row">
          <span class="st-lbl">{t('settings.wrap')}</span>
          <Switch checked={settings.editor.wrap} label={t('settings.wrap')} onchange={(v) => update('editor', { wrap: v })} />
        </div>
      {:else if tab === 'data'}
        <div class="st-row">
          <span class="st-lbl">{t('settings.perPage')}</span>
          <Segmented label={t('settings.perPage')} value={String(settings.data.perPage)} options={seg(PER_PAGE, (v) => String(v))} onchange={(v) => update('data', { perPage: Number(v) as 100 })} />
        </div>
        <div class="st-row">
          <span class="st-lbl">{t('settings.relations')}<span class="v-help">{t('settings.relationsHelp')}</span></span>
          <Segmented label={t('settings.relations')} value={settings.data.relations} options={seg(RELATIONS, (v) => t(`settings.relations.${v}`))} onchange={(v) => update('data', { relations: v })} />
        </div>
        <div class="st-row">
          <span class="st-lbl">{t('settings.zebra')}</span>
          <Switch checked={settings.data.zebra} label={t('settings.zebra')} onchange={(v) => update('data', { zebra: v })} />
        </div>
        <div class="st-row">
          <span class="st-lbl">{t('settings.hideSensitive')}<span class="v-help">{t('settings.hideSensitiveHelp')}</span></span>
          <Switch checked={settings.data.hideSensitive} label={t('settings.hideSensitive')} onchange={(v) => update('data', { hideSensitive: v })} />
        </div>
        <div class="st-block">
          <span class="st-lbl" id="st-sens-lbl">{t('settings.sensitivePatterns')}<span class="v-help">{t('settings.sensitivePatternsHelp')}</span></span>
          <ul class="st-chips" aria-labelledby="st-sens-lbl">
            {#each settings.data.sensitive as pat (pat)}
              <li class="st-chip mono">{pat}<button aria-label={t('settings.removePattern', { pattern: pat })} title={t('settings.removePattern', { pattern: pat })} onclick={() => update('data', { sensitive: settings.data.sensitive.filter((x) => x !== pat) })}>×</button></li>
            {/each}
          </ul>
          <form class="st-add" onsubmit={addPattern}>
            <input class="v-input mono" bind:value={newPattern} placeholder="pin_code" aria-label={t('settings.addPattern')} disabled={!settings.data.hideSensitive} />
            <button class="v-btn-secondary v-btn--sm" type="submit" disabled={!newPattern.trim() || !settings.data.hideSensitive}>{t('settings.addPattern')}</button>
          </form>
        </div>
        <div class="st-row">
          <span class="st-lbl">{t('settings.dates')}<span class="v-help">{settings.data.dates === 'iso' ? '2026-03-22 18:30:00' : formatDate('2026-03-22 18:30:00', 'datetime', i18n.locale)}</span></span>
          <Segmented label={t('settings.dates')} value={settings.data.dates} options={seg(DATES, (v) => t(`settings.dates.${v}`))} onchange={(v) => update('data', { dates: v })} />
        </div>
      {:else if tab === 'connections'}
        <ConnectionsSection />
      {:else}
        <div class="st-row">
          <span class="st-lbl">{t('common.language')}</span>
          <Select id="st-lang" value={i18n.locale} label={t('common.language')} options={Object.entries(LOCALES).map(([value, l]) => ({ value, label: l.label }))} onchange={(v) => setLocale(v as Locale)} />
        </div>
        <div class="st-row">
          <span class="st-lbl">{t('settings.confirmWhere')}<span class="v-help">{t('settings.confirmWhereHelp')}</span></span>
          <Switch checked={settings.general.confirmWhere} label={t('settings.confirmWhere')} onchange={(v) => update('general', { confirmWhere: v })} />
        </div>
        <div class="st-row">
          <span class="st-lbl">{t('settings.startTab')}</span>
          <Segmented label={t('settings.startTab')} value={settings.general.startTab} options={seg(START_TABS, (v) => t(`nav.${v}`))} onchange={(v) => update('general', { startTab: v })} />
        </div>
      {/if}
    </section>

    {#if tab === 'appearance'}
      <aside class="st-aside"><LivePreview /></aside>
    {/if}
  </div>
  <p class="st-foot v-help">{t('settings.savedFor', { who: app.session?.auth ? `${app.session.auth.user}@${app.session.auth.host}` : '' })}</p>
</dialog>

<style>
  /* Settings dialog (components/settings/). */
  .st {
    width: min(1180px, calc(100vw - 32px));
    max-width: none;
    height: min(820px, calc(100vh - 32px));
    padding: 0;
    display: none;
    flex-direction: column;
  }
  .st[open] {
    display: flex;
  }
  .st-head {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .st-head-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .st-body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
  }
  .st-body.with-preview {
    grid-template-columns: 180px minmax(0, 1fr) 320px;
  }
  .st-nav {
    display: grid;
    align-content: start;
    gap: 2px;
    padding: 12px 8px;
    border-right: 1px solid var(--sp-border);
    background: var(--sp-bg-subtle);
  }
  .st-nav button {
    padding: 7px 10px;
    border: 0;
    border-radius: var(--sp-radius);
    background: none;
    color: var(--sp-text-secondary);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .st-nav button:hover {
    background: var(--sp-bg-muted);
    color: var(--sp-text-primary);
  }
  .st-nav button.active {
    background: var(--sp-bg-muted);
    color: var(--sp-text-primary);
    font-weight: 600;
  }
  .st-nav button:focus-visible {
    outline: 2px solid var(--sp-focus);
    outline-offset: -2px;
  }
  .st-main {
    overflow: auto;
    padding: 16px 24px 24px;
  }
  .st-sec-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .st-sec-head h3 {
    margin: 0;
    font-size: 16px;
  }
  .st-fs {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  .st-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 0;
    border-bottom: 1px solid var(--sp-border);
    flex-wrap: wrap;
  }
  .st-row.flat {
    padding: 0 0 10px;
    border: 0;
  }
  .st-block {
    display: grid;
    gap: 10px;
    padding: 12px 0;
    border-bottom: 1px solid var(--sp-border);
  }
  .st-lbl {
    display: grid;
    gap: 2px;
    font-size: 13px;
    font-weight: 500;
  }
  .st-lbl :global(.v-help) {
    margin: 0;
    font-weight: 400;
  }
  .st-code {
    margin: 0;
    padding: 10px 12px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
    background: var(--sp-bg);
    color: var(--syn-ident);
    font: var(--editor-font, 13px) / 1.6 var(--sp-font-mono);
    white-space: pre-wrap;
  }
  .st-code .k {
    color: var(--syn-keyword);
    font-weight: 500;
  }
  .st-code .s {
    color: var(--syn-string);
  }
  .st-code .n {
    color: var(--syn-number);
  }
  .st-code .c {
    color: var(--syn-comment);
    font-style: italic;
  }
  .st-code .ty {
    color: var(--syn-type);
  }
  .st-aside {
    overflow: auto;
    padding: 16px;
    border-left: 1px solid var(--sp-border);
    background: var(--sp-canvas);
  }
  .st-foot {
    margin: 0;
    padding: 8px 16px;
    border-top: 1px solid var(--sp-border);
  }
  @media (max-width: 1000px) {
    .st-body.with-preview {
      grid-template-columns: 160px minmax(0, 1fr);
    }
    .st-aside {
      display: none;
    }
  }
  @media (max-width: 640px) {
    .st {
      width: 100vw;
      height: 100dvh;
      max-height: none;
      border-radius: 0;
    }
    .st-body,
    .st-body.with-preview {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
    }
    .st-nav {
      display: flex;
      overflow-x: auto;
      border-right: 0;
      border-bottom: 1px solid var(--sp-border);
    }
    .st-nav button {
      white-space: nowrap;
    }
    .st-main {
      padding: 12px 16px 20px;
    }
  }
  .st-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .st-chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 4px 2px 8px;
    border: 1px solid var(--sp-border);
    border-radius: 999px;
    background: var(--sp-bg-subtle);
    font-size: 12px;
  }
  .st-chip button {
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--sp-text-secondary);
    cursor: pointer;
  }
  .st-chip button:hover {
    background: var(--sp-bg-muted);
    color: var(--sp-text-primary);
  }
  .st-chip button:focus-visible {
    outline: 2px solid var(--sp-focus);
  }
  .st-add {
    display: flex;
    gap: 6px;
    max-width: 360px;
  }
</style>
