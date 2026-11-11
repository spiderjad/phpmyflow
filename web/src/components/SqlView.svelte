<script lang="ts">
  import { settings } from '../lib/settings.svelte';
  import { writesWithWhere } from '../lib/sqlKind';
  import { tick, untrack } from 'svelte';
  import { api, ApiError } from '../lib/api';
  import { friendlyError } from '../lib/errors';
  import { copyAs, exportAs } from '../lib/gridExport';
  import { addRun, historyKey, loadHistory, saveHistory, type HistoryEntry } from '../lib/history';
  import { n, t } from '../lib/i18n.svelte';
  import { clearServerLintCache, type Problem } from '../lib/sqlLint';
  import { applyFix, explainSyntaxError, type RuleFix } from '../lib/sqlRules';
  import { statementAt } from '../lib/sqlText';
  import { app, isMariaDb, refreshSchema, selectDb } from '../lib/state.svelte';
  import { tabs, type SqlTab } from '../lib/tabs.svelte';
  import { confirmAction, toast } from '../lib/ui.svelte';
  import AiPanel from './AiPanel.svelte';
  import ContextMenu, { type MenuItem } from './ui/Menu.svelte';
  import DataGrid from './DataGrid.svelte';
  import DensityToggle from './DensityToggle.svelte';
  import HistoryPanel from './HistoryPanel.svelte';
  import ProblemsPanel from './ProblemsPanel.svelte';
  import SqlEditor from './SqlEditor.svelte';
  import SqlTabs from './SqlTabs.svelte';

  // Everything below reads from the active tab (lib/tabs.svelte.ts).
  const tab = $derived(tabs.active);
  const panelId = 'sql-tabpanel';
  let ai: AiPanel | undefined = $state();
  let editor: SqlEditor | undefined = $state();
  let problems = $state<Problem[]>([]);

  // Save on every edit of the active tab (debounced inside the store).
  $effect(() => {
    void tab.sql;
    void tab.editorHeight;
    untrack(() => tabs.save());
  });

  // The tab's database drives the sidebar: switching tabs switches the
  // database; picking another database in the sidebar updates the tab.
  let lastTabId = '';
  $effect(() => {
    const id = tabs.activeId;
    const db = app.db;
    untrack(() => {
      const current = tabs.active;
      if (id !== lastTabId) {
        lastTabId = id;
        if (current.db && current.db !== db && app.databases.some((d) => d.name === current.db)) selectDb(current.db);
        else if (current.db !== db) current.db = db;
      } else if (current.db !== db) {
        current.db = db;
        tabs.save();
      }
    });
  });

  // Tabs opened from the sidebar (Ctrl+click) run as soon as they show up.
  $effect(() => {
    const current = tab;
    if (!current.autorun) return;
    untrack(() => {
      current.autorun = false;
      tick().then(() => run(current, current.sql, current.sql.length, ''));
    });
  });

  // --- history: every run, dated, per user@host (lib/history.ts) ---
  const histKey = $derived(historyKey(app.session?.auth));
  let history = $state<HistoryEntry[]>([]);
  let historyOpen = $state(false);
  $effect(() => {
    history = loadHistory(localStorage, histKey);
  });
  function remember(entry: Omit<HistoryEntry, 'id' | 'count'>) {
    history = addRun(history, entry);
    saveHistory(localStorage, histKey, history);
  }
  async function pickHistory(e: HistoryEntry, newTab: boolean) {
    historyOpen = false;
    const db = e.db && app.databases.some((d) => d.name === e.db) ? e.db : app.db;
    if (newTab) {
      if (!tabs.create({ sql: e.sql, db })) toast(t('tabs.limit', { max: 30 }), 'error');
      return;
    }
    if (db !== app.db) await selectDb(db);
    tabs.active.sql = e.sql;
  }
  function removeHistory(id: string) {
    history = history.filter((e) => e.id !== id);
    saveHistory(localStorage, histKey, history);
  }
  async function clearHistory() {
    const ok = await confirmAction({ title: t('history.clearTitle'), body: t('history.clearBody'), confirmLabel: t('history.clear'), danger: true });
    if (!ok) return;
    history = [];
    saveHistory(localStorage, histKey, history);
  }
  function closeHistoryOutside(e: PointerEvent) {
    if (historyOpen && !(e.target as HTMLElement).closest('.hist')) historyOpen = false;
  }

  const DDL = /^\s*(CREATE|ALTER|DROP|RENAME|TRUNCATE)\b/i;
  const reasonKey: Record<string, string> = {
    drop: 'sql.confirm.drop',
    truncate: 'sql.confirm.truncate',
    no_where: 'sql.confirm.noWhere',
    alter_drop: 'sql.confirm.alterDrop',
  };

  /** Run in a given tab: the result lands there even if you switch tabs meanwhile. */
  async function run(target: SqlTab, doc: string, cursor: number, selection: string, checkProblems = false) {
    const stmt = statementAt(doc, cursor);
    const sql = selection.trim() || stmt?.text || '';
    if (!sql || target.running) return;
    if (checkProblems) {
      // Errors the editor already shows in this statement: warn before running.
      const from = selection.trim() ? doc.indexOf(selection.trim()) : (stmt?.from ?? 0);
      const to = from + sql.length;
      const errs = problems.filter((p) => p.severity === 'error' && p.from < to && p.to > from);
      if (errs.length) {
        const ok = await confirmAction({
          title: t('problems.runTitle', { count: errs.length }),
          body: errs.slice(0, 3).map((p) => '• ' + p.message).join('\n') + (errs.length > 3 ? '\n…' : ''),
          confirmLabel: t('problems.runAnyway'),
        });
        if (!ok) return;
      }
    }
    // Settings › General: ask also for UPDATE / DELETE that have a WHERE
    // (the server already asks when they have none).
    if (settings.general.confirmWhere) {
      const verb = writesWithWhere(sql);
      if (verb) {
        const body = t('sql.confirm.where') + '\n\n' + sql.slice(0, 300);
        const ok = await confirmAction({ title: t('sql.confirm.title', { verb }), body, confirmLabel: t('sql.confirm.run'), danger: true });
        if (!ok) return;
      }
    }
    const db = target.db || app.db;
    target.running = true;
    target.failure = null;
    target.failureRule = null;
    target.resultSql = sql;
    const started = Date.now();
    try {
      let res = await api.query({ db, sql });
      if ('needsConfirm' in res) {
        const ok = await confirmAction({
          title: t('sql.confirm.title', { verb: res.verb }),
          body: t(reasonKey[res.reason] ?? 'sql.confirm.generic') + '\n\n' + sql.slice(0, 300),
          confirmLabel: t('sql.confirm.run'),
          danger: true,
        });
        if (!ok) return;
        res = await api.query({ db, sql, confirm: true });
        if ('needsConfirm' in res) return;
      }
      target.result = res;
      target.lastRunSql = doc;
      remember({ sql, db, at: Date.now(), ok: true, ms: res.timeMs, rows: res.type === 'resultset' ? res.rows.length : res.affected });
      if (DDL.test(sql)) {
        clearServerLintCache();
        await refreshSchema();
      }
    } catch (err) {
      target.result = null;
      target.lastRunSql = doc;
      target.failure = err instanceof ApiError ? friendlyError(err, app.schema) : { title: String(err), hint: null, suggestion: null, raw: String(err) };
      // A generic "syntax error near…" is better explained by a rule when one matches.
      if (target.failure.mysqlCode === 1064) target.failureRule = explainSyntaxError(sql, target.failure.near ?? '', { schema: app.schema });
      remember({ sql, db, at: Date.now(), ok: false, error: err instanceof ApiError ? err.code : 'unknown', ms: Date.now() - started });
    } finally {
      target.running = false;
      tabs.save();
    }
  }

  function runFromEditor(doc: string, cursor: number, selection: string) {
    run(tabs.active, doc, cursor, selection, true);
  }

  function runFromButton() {
    // From the toolbar: the statement at the saved cursor.
    run(tab, tab.sql, tab.cursor || tab.sql.length, '', true);
  }

  /** Apply a rule quick fix from the result panel to the statement that ran. */
  function applyRuleFix(fix: RuleFix) {
    const at = tab.sql.indexOf(tab.resultSql);
    if (at === -1) return;
    tab.sql = tab.sql.slice(0, at) + applyFix(tab.resultSql, fix) + tab.sql.slice(at + tab.resultSql.length);
    tab.failure = null;
    tab.failureRule = null;
    editor?.goto(at);
  }

  function applySuggestion() {
    const failure = tab.failure;
    if (!failure?.suggestion) return;
    const name = failure.raw.match(/'([^']+)'/)?.[1]?.split('.').pop();
    if (!name) return;
    tab.sql = tab.sql.replace(new RegExp(`(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`), failure.suggestion);
    tab.failure = null;
  }

  function useAi(sql: string, how: 'replace' | 'append' | 'newtab') {
    if (how === 'newtab') {
      if (!tabs.create({ sql, db: tab.db })) toast(t('tabs.limit', { max: 30 }), 'error');
      return;
    }
    tab.sql = how === 'replace' ? sql : tab.sql.trimEnd() + (tab.sql.trim() ? ';\n\n' : '') + sql;
  }

  function fixWithAi() {
    tab.ai.open = true;
    queueMicrotask(() => ai?.runMode('fix'));
  }

  // Drag handle between editor and results (height is per tab).
  function startResize(e: PointerEvent) {
    const target = tab;
    const startY = e.clientY;
    const startH = target.editorHeight;
    const move = (ev: PointerEvent) => (target.editorHeight = Math.min(window.innerHeight - 200, Math.max(100, startH + ev.clientY - startY)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function resizeKey(e: KeyboardEvent) {
    if (e.key === 'ArrowUp') tab.editorHeight = Math.max(100, tab.editorHeight - 20);
    if (e.key === 'ArrowDown') tab.editorHeight += 20;
  }

  const placeholder = $derived(t('sql.placeholder'));

  function downloadCsv() {
    const result = tab.result;
    if (result?.type === 'resultset') exportAs('csv', result.columns, result.rows, 'result');
  }

  // "Copy result" dropdown: the whole result, for people who don't right-click.
  let copyMenu = $state<{ x: number; y: number } | null>(null);
  let copyBtn: HTMLButtonElement | undefined = $state();
  function openCopyMenu() {
    const r = copyBtn?.getBoundingClientRect();
    if (r) copyMenu = { x: r.left, y: r.bottom + 4 };
  }
  const copyItems = $derived.by((): MenuItem[] => {
    const result = tab.result;
    if (result?.type !== 'resultset') return [];
    const all = () => [result.columns, result.rows] as const;
    return [
      { label: t('copy.excel'), action: () => copyAs('tsv', ...all()) },
      { label: 'JSON', action: () => copyAs('json', ...all()) },
      { label: 'CSV', action: () => copyAs('csv', ...all()) },
      { label: 'Markdown', action: () => copyAs('markdown', ...all()) },
      'sep',
      { label: t('export.xlsx'), action: () => exportAs('xlsx', result.columns, result.rows, 'result') },
      { label: t('export.json'), action: () => exportAs('json', result.columns, result.rows, 'result') },
    ];
  });
</script>

<svelte:window onpointerdown={closeHistoryOutside} />

{#if copyMenu && copyItems.length}
  <ContextMenu
    x={copyMenu.x}
    y={copyMenu.y}
    items={copyItems}
    label={t('copy.result')}
    onclose={(refocus) => {
      copyMenu = null;
      if (refocus) copyBtn?.focus();
    }}
  />
{/if}

<div class="sql" class:with-ai={tab.ai.open}>
  <section class="main">
    <div class="toolbar">
      <button class="v-btn-primary v-btn--sm" onclick={runFromButton} disabled={tab.running || !tab.sql.trim()}>
        {tab.running ? t('sql.running') : t('sql.run')} <kbd class="v-kbd k">Ctrl ↵</kbd>
      </button>
      <div class="hist">
        <button class="v-btn-ghost v-btn--sm" onclick={() => (historyOpen = !historyOpen)} aria-expanded={historyOpen} disabled={!history.length}>
          {t('sql.history')}
        </button>
        {#if historyOpen}
          <HistoryPanel entries={history} onpick={pickHistory} onremove={removeHistory} onclear={clearHistory} onclose={() => (historyOpen = false)} />
        {/if}
      </div>
      <span class="spacer"></span>
      <span class="hint">{t('sql.hint')}</span>
      <button class="v-btn-ai v-btn--sm" onclick={() => (tab.ai.open = !tab.ai.open)} aria-pressed={tab.ai.open}>✦ {t('ai.open')}</button>
    </div>

    <SqlTabs {panelId} />

    <div class="panel" id={panelId} role="tabpanel" aria-labelledby="tab-{tab.id}">
      <div class="editor" style:height="{tab.editorHeight}px">
        <SqlEditor
          bind:this={editor}
          bind:value={tabs.active.sql}
          docId={tab.id}
          cursor={tab.cursor}
          oncursor={(pos) => {
            tabs.active.cursor = pos;
            tabs.save();
          }}
          onlint={(count) => (tabs.active.lintErrors = count)}
          ondiagnostics={(list) => (problems = list)}
          db={tab.db || app.db}
          schema={app.schema}
          relations={app.relations}
          mariadb={isMariaDb()}
          {placeholder}
          onrun={runFromEditor}
        />
      </div>

      <ProblemsPanel {problems} ongoto={(p) => editor?.goto(p.from, p.to)} onfix={(p, i) => editor?.applyFix(p.id, i)} />

      <!-- Focusable separator = ARIA "window splitter" pattern, keyboard resizable. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div class="handle" role="separator" aria-orientation="horizontal" aria-label={t('sql.resize')} aria-valuenow={tab.editorHeight} aria-valuemin={100} tabindex="0" onpointerdown={startResize} onkeydown={resizeKey}></div>

      <div class="results">
        {#if tab.failure}
          {@const failure = tab.failure}
          {@const rule = tab.failureRule}
          <div class="failure" role="alert">
            {#if rule}
              <strong>{t(rule.key, rule.params)}</strong>
              <p>{t('rules.serverAgrees')}</p>
            {:else}
              <strong>{failure.title}</strong>
              {#if failure.hint}<p>{failure.hint}</p>{/if}
            {/if}
            {#if failure.raw && failure.raw !== failure.title}<p class="raw mono">{failure.raw}</p>{/if}
            <div class="fix">
              {#if rule}
                {#each rule.fixes as fix}
                  <button class="v-btn-primary v-btn--sm" onclick={() => applyRuleFix(fix)}>{t(fix.key, fix.params ?? {})}</button>
                {/each}
              {/if}
              {#if failure.suggestion}
                <button class="v-btn-secondary v-btn--sm" onclick={applySuggestion}>{t('sql.useSuggestion', { suggestion: failure.suggestion })}</button>
              {/if}
              {#if app.session?.ai}
                <button class="v-btn-ai v-btn--sm" onclick={fixWithAi}>✦ {t('ai.fixThis')}</button>
              {/if}
            </div>
          </div>
        {:else if tab.result?.type === 'resultset'}
          {@const result = tab.result}
          <div class="res-bar">
            <span>{t('sql.resultRows', { count: n(result.rows.length) })}{result.truncated ? ' ' + t('sql.truncated', { max: n(result.maxRows) }) : ''}</span>
            <span class="dim">{t('common.ms', { ms: result.timeMs })}</span>
            <span class="spacer"></span>
            <DensityToggle />
            <button class="v-btn-ghost v-btn--sm" onclick={downloadCsv}>{t('sql.exportCsv')}</button>
            <button class="v-btn-ghost v-btn--sm" bind:this={copyBtn} onclick={openCopyMenu} aria-haspopup="menu" aria-expanded={!!copyMenu}>
              {t('copy.result')} <span aria-hidden="true">▾</span>
            </button>
          </div>
          {#key tab.id}
            <DataGrid columns={result.columns} rows={result.rows} label={t('sql.resultLabel')} emptyText={t('sql.noRows')} />
          {/key}
        {:else if tab.result?.type === 'affected'}
          <p class="ok">{t('sql.affected', { verb: tab.result.verb, count: n(tab.result.affected) })} <span class="dim">{t('common.ms', { ms: tab.result.timeMs })}</span></p>
        {:else if tab.running}
          <div class="empty"><p class="dim">{t('sql.running')}</p></div>
        {:else if tab.sql.trim()}
          <div class="empty">
            <p>{t('tabs.runToSee')}</p>
            <p class="dim">{t('sql.emptyHelp')}</p>
          </div>
        {:else}
          <div class="empty">
            <p>{t('sql.emptyTitle')}</p>
            <p class="dim">{t('sql.emptyHelp')}</p>
          </div>
        {/if}
      </div>
    </div>
  </section>

  {#if tab.ai.open}
    {#key tab.id}
      <AiPanel
        bind:this={ai}
        memory={tab.ai}
        db={tab.db || app.db}
        sql={tab.resultSql && tab.failure ? tab.resultSql : tab.sql}
        lastError={tab.failure?.raw ?? ''}
        onuse={useAi}
        onclose={() => (tab.ai.open = false)}
      />
    {/key}
  {/if}
</div>

<style>
  .sql {
    display: grid;
    grid-template-columns: 1fr;
    height: 100%;
    min-height: 0;
  }
  .sql.with-ai {
    grid-template-columns: 1fr minmax(300px, 380px);
  }
  .main {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--sp-border);
  }
  .k {
    border-color: transparent;
    background: color-mix(in srgb, var(--sp-on-inverse) 18%, transparent);
    color: inherit;
  }
  .spacer {
    flex: 1;
  }
  .hint {
    font-size: 12px;
    color: var(--sp-text-tertiary);
  }
  .hist {
    position: relative;
  }
  .editor {
    min-height: 100px;
    border-bottom: 1px solid var(--sp-border);
  }
  .handle {
    height: 6px;
    margin-top: -3px;
    cursor: row-resize;
    position: relative;
    z-index: 2;
  }
  .handle:hover,
  .handle:focus-visible {
    background: color-mix(in srgb, var(--sp-text-primary) 15%, transparent);
    outline: none;
  }
  .results {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .res-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--sp-border);
    font-size: 12.5px;
  }
  .dim {
    color: var(--sp-text-tertiary);
  }
  .failure {
    margin: 12px;
    padding: 12px 14px;
    border: 1px solid color-mix(in srgb, var(--sp-danger) 40%, transparent);
    border-left: 3px solid var(--sp-danger);
    border-radius: var(--sp-radius);
    background: var(--sp-danger-light);
  }
  .failure strong {
    color: var(--sp-danger);
  }
  .failure p {
    margin: 6px 0 0;
    color: var(--sp-text-secondary);
  }
  .raw {
    opacity: 0.8;
    word-break: break-word;
  }
  .fix {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  .fix:empty {
    display: none;
  }
  .ok {
    margin: 12px;
    color: var(--sp-success);
  }
  .empty {
    padding: 24px 16px;
  }
  .empty p {
    margin: 0 0 4px;
  }
  @media (max-width: 900px) {
    .sql.with-ai {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr auto;
    }
    .hint {
      display: none;
    }
  }
</style>
