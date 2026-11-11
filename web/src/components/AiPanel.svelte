<script lang="ts">
  import { untrack } from 'svelte';
  import type { AiMemory } from '../lib/tabs.svelte';
  import { api, ApiError, type AiMode, type AiResult } from '../lib/api';
  import { friendlyError } from '../lib/errors';
  import { i18n, t } from '../lib/i18n.svelte';
  import { app } from '../lib/state.svelte';

  interface Props {
    db: string;
    sql: string;
    lastError: string;
    /** Per-tab memory: mode, prompt and last answer survive tab switches. */
    memory: AiMemory;
    onuse: (sql: string, how: 'replace' | 'append' | 'newtab') => void;
    onclose: () => void;
  }
  let { db, sql, lastError, memory, onuse, onclose }: Props = $props();

  let mode = $state<AiMode>(untrack(() => memory.mode));
  let prompt = $state(untrack(() => memory.prompt));
  let busy = $state(false);
  let result = $state<AiResult | null>(untrack(() => memory.result));
  $effect(() => {
    memory.mode = mode;
    memory.prompt = prompt;
    memory.result = result;
  });
  let error = $state('');

  const enabled = $derived(app.session?.ai ?? false);
  const modes: AiMode[] = ['generate', 'explain', 'fix', 'optimize'];
  const canRun = $derived(
    enabled && !busy && !!db && (mode === 'generate' ? prompt.trim() !== '' : mode === 'fix' ? sql.trim() !== '' && lastError !== '' : sql.trim() !== ''),
  );

  // A fresh error in the editor makes "Fix" the obvious next step.
  $effect(() => {
    if (lastError) mode = 'fix';
  });

  export async function runMode(m: AiMode) {
    mode = m;
    await submit();
  }

  async function submit() {
    if (!canRun) return;
    busy = true;
    error = '';
    result = null;
    try {
      result = await api.ai({ db, mode, lang: i18n.locale, prompt, sql, error: lastError });
    } catch (err) {
      error = err instanceof ApiError ? friendlyError(err).title : String(err);
    } finally {
      busy = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }
</script>

<aside class="ai" aria-label={t('ai.title')}>
  <header>
    <h2><span class="spark" aria-hidden="true">✦</span> {t('ai.title')}</h2>
    <button class="v-btn-ghost v-btn--sm" onclick={onclose} aria-label={t('common.close')}>✕</button>
  </header>

  {#if !enabled}
    <div class="body">
      <p>{t('ai.disabled')}</p>
      <pre class="mono">'ai' => [
  'enabled' => true,
  'provider' => 'anthropic',
  'api_key' => 'sk-ant-…',
],</pre>
      <p class="dim">{t('ai.disabledHelp')}</p>
    </div>
  {:else}
    <div class="body">
      <div class="modes" role="tablist">
        {#each modes as m}
          <button role="tab" aria-selected={mode === m} class:active={mode === m} onclick={() => (mode = m)}>{t(`ai.mode.${m}`)}</button>
        {/each}
      </div>

      {#if mode === 'generate'}
        <textarea
          class="v-input"
          rows="4"
          bind:value={prompt}
          onkeydown={onKey}
          placeholder={t('ai.placeholder')}
          aria-label={t('ai.promptLabel')}
        ></textarea>
      {:else}
        <p class="dim small">{t(`ai.help.${mode}`)}</p>
        {#if mode === 'fix' && lastError}
          <p class="err-quote mono">{lastError}</p>
        {/if}
      {/if}

      <button class="v-btn-ai" onclick={submit} disabled={!canRun}>
        {busy ? t('ai.thinking') : t(`ai.run.${mode}`)}
        {#if !busy && mode === 'generate'}<kbd class="v-kbd">Ctrl ↵</kbd>{/if}
      </button>

      {#if error}<p class="error" role="alert">{error}</p>{/if}

      {#if result}
        <div class="result">
          {#if result.explanation}<p class="explanation">{result.explanation}</p>{/if}
          {#if result.warnings.length}
            <ul class="warnings">
              {#each result.warnings as w}<li>{w}</li>{/each}
            </ul>
          {/if}
          {#if result.sql}
            <pre class="mono sql">{result.sql}</pre>
            <div class="use">
              <button class="v-btn-primary v-btn--sm" onclick={() => onuse(result!.sql, 'replace')}>{t('ai.replace')}</button>
              <button class="v-btn-secondary v-btn--sm" onclick={() => onuse(result!.sql, 'append')}>{t('ai.append')}</button>
              <button class="v-btn-secondary v-btn--sm" onclick={() => onuse(result!.sql, 'newtab')}>{t('ai.newTab')}</button>
            </div>
            <p class="dim small">{t('ai.neverRuns')}</p>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .ai {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: 1px solid var(--sp-border);
    background: var(--sp-bg);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 8px 8px 16px;
    border-bottom: 1px solid var(--sp-border);
  }
  h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }
  .spark {
    color: var(--ai);
  }
  .body {
    padding: 14px 16px;
    display: grid;
    gap: 12px;
    overflow: auto;
    align-content: start;
  }
  .modes {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--sp-bg-muted);
    border-radius: var(--sp-radius);
  }
  .modes button {
    flex: 1;
    border: 0;
    background: none;
    padding: 5px 6px;
    font-size: 12px;
    border-radius: 4px;
    color: var(--sp-text-secondary);
    cursor: pointer;
  }
  .modes button.active {
    background: var(--sp-bg);
    color: var(--sp-text-primary);
    font-weight: 500;
    box-shadow: var(--sp-shadow);
  }
  textarea {
    resize: vertical;
    min-height: 84px;
    font-size: 13.5px;
  }
  .dim {
    color: var(--sp-text-tertiary);
  }
  .small {
    font-size: 12px;
    margin: 0;
  }
  .err-quote {
    margin: 0;
    padding: 8px 10px;
    border-left: 3px solid var(--sp-danger);
    background: var(--sp-danger-light);
    border-radius: 4px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .error {
    margin: 0;
    color: var(--sp-danger);
    font-size: 13px;
  }
  .result {
    display: grid;
    gap: 10px;
    padding-top: 4px;
    border-top: 1px solid var(--sp-border);
  }
  .explanation {
    margin: 8px 0 0;
    white-space: pre-line;
    font-size: 13.5px;
    line-height: 1.55;
  }
  .warnings {
    margin: 0;
    padding: 8px 10px 8px 26px;
    background: var(--sp-warning-light);
    color: var(--sp-warning);
    border-radius: var(--sp-radius);
    font-size: 12.5px;
  }
  pre {
    margin: 0;
    padding: 10px 12px;
    background: var(--sp-bg-subtle);
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
    overflow: auto;
    white-space: pre-wrap;
  }
  .use {
    display: flex;
    gap: 8px;
  }
</style>
