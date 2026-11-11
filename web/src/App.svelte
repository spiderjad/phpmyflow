<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { api, ApiError, onSessionLost, setCsrf } from './lib/api';
  import { t } from './lib/i18n.svelte';
  import { app, loadDatabases, rememberView, type View } from './lib/state.svelte';
  import { prefs, savePrefs, setSidebarWidth, SIDEBAR_MAX, SIDEBAR_MIN } from './lib/prefs.svelte';
  import { tabs, tabsKey } from './lib/tabs.svelte';
  import { confirmAction, dismissToast, registerConfirm, toast, toasts } from './lib/ui.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import LangSwitch from './components/LangSwitch.svelte';
  import Login from './components/Login.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import SqlView from './components/SqlView.svelte';
  import RelationsView from './components/RelationsView.svelte';
  import MonitorView from './components/monitor/MonitorView.svelte';
  import { alertCount, resetMonitor } from './lib/monitorState.svelte';
  import StructureView from './components/StructureView.svelte';
  import TableView from './components/TableView.svelte';
  import DbDialogs from './components/db/DbDialogs.svelte';
  import DbOverview from './components/db/DbOverview.svelte';
  import ObjectView from './components/objects/ObjectView.svelte';
  import SearchView from './components/tools/SearchView.svelte';
  import { dbMenuItems, openMenu } from './lib/dbActions.svelte';
  import { dbTools, loadCaps } from './lib/dbTools.svelte';
  import { applyAppearance, normalizeAppearance, PALETTE, savedAppearance, startAppearance } from './lib/theme';
  import { connectionsVersion, loadSettings } from './lib/settings.svelte';
  import { connKey, connectionLook, forgetRecent } from './lib/connections';
  import { setWriteGuard, resetWriteApprovals } from './lib/writeGuard';
  import SettingsDialog from './components/settings/SettingsDialog.svelte';
  import LogoutDialog from './components/LogoutDialog.svelte';
  import IdleWarning from './components/IdleWarning.svelte';
  import { idle, markActivity } from './lib/idle.svelte';
  import { cancelJob, jobs } from './lib/jobs.svelte';

  let ready = $state(false);
  let fatal = $state('');
  let confirmDialog: ConfirmDialog | undefined = $state();
  let settingsDialog: SettingsDialog | undefined = $state();
  let logoutDialog: LogoutDialog | undefined = $state();

  /** From the logout modal: optionally forget the connection, cancel running exports, then sign out. */
  async function confirmLogout(forget: boolean) {
    const a = app.session?.auth;
    if (forget && a) forgetRecent({ host: a.host, port: a.port, user: a.user });
    for (const j of jobs) if (j.kind === 'export' && j.status === 'running') cancelJob(j);
    await logout();
  }
  let menuOpen = $state(false);

  // Errors that mean "the database server can't be used with this session"
  // (unreachable, password changed, SSL…): back to the login, with the reason.
  const CONNECT_ERRORS = ['login_failed', 'server_unreachable', 'host_not_found', 'not_mysql', 'client_not_allowed', 'auth_plugin_unsupported', 'connection_failed'];
  let loginError = $state<ApiError | null>(null);

  async function boot() {
    try {
      const s = await api.session();
      setCsrf(s.csrf);
      app.session = s;
      applyAppearance(startAppearance(s.ui, !!s.uiLocked, savedAppearance()));
      idle.seconds = s.idleSeconds ?? 3600;
      markActivity();
      if (s.auth) {
        try {
          await loadDatabases();
        } catch (err) {
          if (!(err instanceof ApiError) || !(CONNECT_ERRORS.includes(err.code) || err.code.startsWith('ssl_'))) throw err;
          await api.logout().catch(() => {});
          const fresh = await api.session();
          setCsrf(fresh.csrf);
          loginError = err;
          app.session = fresh;
        }
      }
    } catch (err) {
      fatal = String(err instanceof Error ? err.message : err);
    } finally {
      ready = true;
    }
  }

  onMount(() => {
    onSessionLost(() => {
      if (app.session?.auth) toast(t('error.not_authenticated'), 'error');
      boot();
    });
    boot();
  });

  $effect(() => {
    if (confirmDialog) registerConfirm((o) => confirmDialog!.ask(o));
  });

  // Settings belong to one user@host (config.php may lock the appearance).
  $effect(() => {
    const s = app.session;
    if (!s?.auth) return;
    const auth = s.auth;
    // Only the session decides when to load: reading settings here would reload on every change.
    untrack(() => {
      loadSettings(auth, s.uiLocked ? normalizeAppearance(s.ui ?? {}) : null);
      resetWriteApprovals();
    });
  });

  // Connection color and environment: stripe + label, production asks before writes.
  const look = $derived.by(() => {
    void connectionsVersion.n;
    const a = app.session?.auth;
    return a ? connectionLook(a.host, a.port, app.session!.servers) : null;
  });
  const connName = $derived.by(() => {
    const a = app.session?.auth;
    if (!a) return '';
    return app.session!.servers.find((s) => connKey(s.host, s.port) === connKey(a.host, a.port))?.label ?? a.host;
  });
  $effect(() => {
    const prod = look?.env === 'production';
    const name = connName;
    setWriteGuard(
      prod
        ? (action, payload) => {
            const what = t(`prod.do.${action}`);
            const sql = action === 'query' ? String(payload?.sql ?? '').slice(0, 300) : '';
            return confirmAction({
              title: t('prod.title', { name }),
              body: (what === `prod.do.${action}` ? t('prod.body') : what) + (sql ? '\n\n' + sql : ''),
              confirmLabel: t('prod.continue'),
              danger: true,
            });
          }
        : null,
    );
  });

  // SQL tabs belong to one user@host: switch sets on login/logout.
  const currentTabsKey = $derived(tabsKey(app.session?.auth));
  $effect(() => {
    tabs.load(currentTabsKey);
  });

  async function logout() {
    try {
      await api.logout();
    } finally {
      resetMonitor();
      dbTools.caps = null;
      dbTools.serverCaps = null;
      app.databases = [];
      app.db = '';
      app.table = '';
      app.tables = [];
      app.schema = {};
      await boot();
    }
  }

  const views: View[] = ['overview', 'data', 'structure', 'relations', 'sql', 'monitor'];
  const viewEnabled = (v: View) => (v === 'sql' || v === 'monitor' ? true : v === 'overview' ? !!app.db : !!app.table);

  $effect(() => rememberView(app.view));

  // Privileges (SHOW GRANTS) for the database actions.
  $effect(() => {
    const db = app.db;
    if (app.session?.auth) void loadCaps(db);
  });
  const alerts = $derived(alertCount());

  // Sidebar resize: drag the edge or use the arrow keys; width persists.
  let dragging: { x: number; w: number } | null = null;
  function startSideResize(e: PointerEvent) {
    e.preventDefault();
    dragging = { x: e.clientX, w: prefs.sidebarWidth };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function moveSideResize(e: PointerEvent) {
    if (dragging) setSidebarWidth(dragging.w + e.clientX - dragging.x);
  }
  function endSideResize() {
    if (!dragging) return;
    dragging = null;
    savePrefs();
  }
  function sideResizeKey(e: KeyboardEvent) {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowLeft') setSidebarWidth(prefs.sidebarWidth - step);
    else if (e.key === 'ArrowRight') setSidebarWidth(prefs.sidebarWidth + step);
    else return;
    e.preventDefault();
    savePrefs();
  }
</script>

{#if !ready}
  <div class="splash" aria-busy="true"></div>
{:else if fatal}
  <main class="splash"><p role="alert">{t('error.boot')}<br /><span class="mono">{fatal}</span></p></main>
{:else if !app.session?.auth}
  <Login onlogin={loadDatabases} initialError={loginError} />
{:else}
  {#if look?.color || look?.env}
    <!-- Always with the text label in the top bar (never color alone). -->
    <div class="conn-stripe" aria-hidden="true" style:--env-l={PALETTE[look.color ?? 'blue'].light} style:--env-d={PALETTE[look.color ?? 'blue'].dark}></div>
  {/if}
  <div class="shell" class:menu-open={menuOpen} style:--side-w="{prefs.sidebarWidth}px">
    <header class="top">
      <button class="v-btn-ghost v-btn--sm burger" onclick={() => (menuOpen = !menuOpen)} aria-label={t('sidebar.tables')}>☰</button>
      <div class="crumbs">
        <strong class="logo">phpMyFlow</strong>
        <span class="sep">/</span>
        {#if app.db}
          <button class="crumb mono" onclick={() => (app.view = 'overview')} oncontextmenu={(e) => openMenu(e, dbMenuItems(app.db), t('dbmenu.label', { db: app.db }))} title={t('dbmenu.crumbTip')}>{app.db}</button>
        {/if}
        {#if app.view === 'search'}
          <span class="sep">/</span><span>{t('search.title')}</span>
        {:else if app.view === 'object' && app.object}
          <span class="sep">/</span><span class="mono">{app.object.name ?? t('objects.newShort')}</span>
        {:else if app.table && app.view !== 'sql' && app.view !== 'overview'}
          <span class="sep">/</span><span class="mono">{app.table}</span>
        {/if}
      </div>
      <nav class="tabs" aria-label={t('nav.views')}>
        {#each views as v}
          <button class:active={app.view === v} aria-current={app.view === v ? 'page' : undefined} disabled={!viewEnabled(v)} onclick={() => (app.view = v)}>
            {t(`nav.${v}`)}
            {#if v === 'monitor' && (alerts.crit || alerts.warn)}
              <span class="v-badge {alerts.crit ? 'v-badge--danger' : 'v-badge--warning'} alert-badge" title={t('monitor.badge', { count: alerts.crit + alerts.warn })}>
                {alerts.crit ? '⛔' : '⚠'} {alerts.crit + alerts.warn}<span class="sr-only"> {t('monitor.badge', { count: alerts.crit + alerts.warn })}</span>
              </span>
            {/if}
          </button>
        {/each}
      </nav>
      <div class="right">
        {#if look?.color || look?.env}
          <span class="env-tag" class:has-env={!!look.env} style:--env-l={PALETTE[look.color ?? 'blue'].light} style:--env-d={PALETTE[look.color ?? 'blue'].dark}>
            {look.env ? t(`env.${look.env}`) : connName}
          </span>
        {/if}
        <LangSwitch />
        <button class="v-btn-icon v-btn--sm" aria-label={t('settings.title')} title="{t('settings.title')} (Ctrl+,)" aria-keyshortcuts="Control+Comma" onclick={() => settingsDialog?.open()}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
        </button>
        <span class="who" title={app.serverVersion}>{app.session.auth.user}@{app.session.auth.host}</span>
        <button class="v-btn-ghost v-btn--sm" onclick={() => logoutDialog?.open()}>{t('nav.logout')}</button>
      </div>
    </header>

    <div class="side-wrap" onclick={(e) => { if ((e.target as HTMLElement).closest('.tbl')) menuOpen = false; }} role="presentation">
      <Sidebar />
      <!-- Focusable separator = ARIA "window splitter" pattern, keyboard resizable. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="side-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('sidebar.resize')}
        aria-valuenow={prefs.sidebarWidth}
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        tabindex="0"
        onpointerdown={startSideResize}
        onpointermove={moveSideResize}
        onpointerup={endSideResize}
        onkeydown={sideResizeKey}
      ></div>
    </div>

    <main class="content">
      {#if app.view === 'monitor'}
        <MonitorView />
      {:else if app.view === 'search'}
        <SearchView />
      {:else if app.view === 'object' && app.object && app.db}
        <ObjectView db={app.db} kind={app.object.kind} name={app.object.name} table={app.object.table} />
      {:else if app.db && (app.view === 'overview' || (!app.table && app.view !== 'sql'))}
        <DbOverview db={app.db} />
      {:else if app.view === 'sql' || !app.table}
        <SqlView />
      {:else if app.view === 'data'}
        <TableView db={app.db} table={app.table} />
      {:else if app.view === 'relations'}
        <RelationsView table={app.table} />
      {:else}
        <StructureView db={app.db} table={app.table} />
      {/if}
    </main>
  </div>
{/if}

<svelte:window
  onpagehide={() => tabs.flush()}
  onkeydown={(e) => {
    // Ctrl+,: settings.
    if ((e.ctrlKey || e.metaKey) && e.key === ',' && app.session?.auth) {
      e.preventDefault();
      settingsDialog?.open();
    }
    // Ctrl+Shift+F: search text in the server.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f' && app.session?.auth) {
      e.preventDefault();
      app.view = 'search';
    }
  }}
/>

<ConfirmDialog bind:this={confirmDialog} />
{#if app.session?.auth}
  <SettingsDialog bind:this={settingsDialog} />
  <LogoutDialog bind:this={logoutDialog} env={look?.env ?? null} color={look?.color ?? null} onconfirm={(f) => void confirmLogout(f)} />
  <IdleWarning onlogout={() => void logout()} />
{/if}

{#if app.session?.auth}<DbDialogs />{/if}

<div class="toasts" aria-live="polite">
  {#each toasts as tt (tt.id)}
    <div class="toast {tt.kind}">
      <span>{tt.text}</span>
      {#if tt.action}
        {@const action = tt.action}
        <button class="toast-action" onclick={() => { action.run(); dismissToast(tt.id); }}>{action.label}</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .crumb {
    padding: 2px 4px;
    border: 0;
    border-radius: var(--sp-radius);
    background: none;
    color: inherit;
    cursor: pointer;
    font-size: inherit;
  }
  .crumb:hover {
    background: var(--sp-bg-subtle);
  }
  .splash {
    height: 100%;
    display: grid;
    place-items: center;
    text-align: center;
    color: var(--sp-text-secondary);
  }
  .shell {
    height: 100%;
    display: grid;
    grid-template-columns: var(--side-w, 248px) 1fr;
    grid-template-rows: 48px 1fr;
  }
  .top {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 12px 0 16px;
    border-bottom: 1px solid var(--sp-border);
    min-width: 0;
  }
  .burger {
    display: none;
  }
  .crumbs {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
  }
  .logo {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .sep {
    color: var(--sp-border-hover);
  }
  .tabs {
    display: flex;
    gap: 2px;
    margin-left: 8px;
  }
  .tabs button {
    border: 0;
    background: none;
    padding: 6px 12px;
    border-radius: var(--sp-radius);
    font-size: 13px;
    color: var(--sp-text-secondary);
    cursor: pointer;
  }
  .tabs button:hover:not(:disabled) {
    background: var(--sp-bg-muted);
    color: var(--sp-text-primary);
  }
  .tabs button.active {
    color: var(--sp-text-primary);
    font-weight: 500;
    box-shadow: inset 0 -2px 0 var(--sp-text-primary);
    border-radius: 0;
  }
  .right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .who {
    font-size: 12px;
    color: var(--sp-text-tertiary);
    font-family: var(--sp-font-mono);
  }
  .side-wrap {
    position: relative;
    min-height: 0;
    min-width: 0;
  }
  .side-resize {
    position: absolute;
    top: 0;
    right: -3px;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 5;
    touch-action: none;
  }
  .side-resize:hover,
  .side-resize:focus-visible {
    background: var(--sp-border-hover);
    outline: none;
  }
  .content {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .toasts {
    position: fixed;
    bottom: 16px;
    right: 16px;
    display: grid;
    gap: 8px;
    z-index: 50;
  }
  .toast {
    padding: 10px 14px;
    border-radius: var(--sp-radius);
    background: var(--sp-inverse);
    color: var(--sp-on-inverse);
    font-size: 13px;
    box-shadow: var(--sp-shadow-md);
    max-width: 380px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  /* Connection color (Settings › Connections / config.php): a thin stripe at the
     top, always with the text label (.env-tag) next to the user. */
  .conn-stripe {
    position: fixed;
    inset: 0 0 auto 0;
    height: 3px;
    z-index: 40;
    background: var(--env-l);
    pointer-events: none;
  }
  .env-tag {
    padding: 1px 8px;
    border: 1px solid currentColor;
    border-radius: 999px;
    color: var(--env-l);
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }
  .env-tag.has-env {
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  :global(:root[data-mode='dark']) .conn-stripe {
    background: var(--env-d);
  }
  :global(:root[data-mode='dark']) .env-tag {
    color: var(--env-d);
  }
  .alert-badge {
    margin-left: 4px;
    padding: 0 6px;
    font-size: 10.5px;
  }
  .toast-action {
    margin-left: auto;
    padding: 2px 8px;
    border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
    border-radius: 4px;
    background: none;
    color: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .toast.error {
    background: var(--sp-danger-light);
    border: 1px solid var(--sp-danger-border);
    color: var(--sp-danger-text);
  }
  @media (max-width: 900px) {
    .shell {
      grid-template-columns: 1fr;
    }
    .burger {
      display: inline-flex;
    }
    .who,
    .crumbs .sep,
    .crumbs .mono {
      display: none;
    }
    .side-wrap {
      display: none;
    }
    .menu-open .side-wrap {
      display: block;
      position: fixed;
      inset: 48px auto 0 0;
      width: min(300px, 85vw);
      z-index: 20;
      box-shadow: var(--sp-shadow-md);
    }
    .menu-open .side-wrap :global(.side) {
      height: 100%;
    }
    .side-resize {
      display: none;
    }
  }
  @media (max-width: 640px) {
    .top {
      gap: 8px;
      padding: 0 8px;
    }
    .tabs {
      margin-left: 0;
      flex: 1 1 auto;
      min-width: 0;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tabs button {
      padding: 6px 8px;
      white-space: nowrap;
    }
    /* The language is also in Settings › General. */
    .right :global(.lang) {
      display: none;
    }
    .right {
      gap: 4px;
      flex: none;
    }
    .logo {
      display: none;
    }
  }
</style>
