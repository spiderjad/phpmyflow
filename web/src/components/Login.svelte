<script lang="ts">
  // Login: spider-ui auth screen (dark animated background, light card).
  // Recent connections (max 4) fill the form in one click; the server picker
  // groups configured servers (color + environment) and "Other server…".
  // Styles: auth-* from spider-ui, .lg-* here (login only).
  import 'spider-ui/auth.css';
  import { onMount, tick, untrack } from 'svelte';
  import { fly } from 'svelte/transition';
  import { api, ApiError, setCsrf, type LoginSsl } from '../lib/api';
  import { i18n, LOCALES, setLocale, t, type Locale } from '../lib/i18n.svelte';
  import { app } from '../lib/state.svelte';
  import { connKey, connectionLook, forgetRecent, readRecent, rememberRecent, type RecentConnection } from '../lib/connections';
  import { applyAppearance, mirroredAppearance, PALETTE, type Mode } from '../lib/theme';
  import ServerPicker, { type ServerItem } from './login/ServerPicker.svelte';

  // initialError: why an existing session couldn't reach its server (App boot).
  let { onlogin, initialError = null }: { onlogin: () => void; initialError?: ApiError | null } = $props();

  const session = app.session!;
  const servers = session.servers;
  const caFiles = session.sslCaFiles ?? [];

  // Recent connections that can still be used (server still listed, or custom hosts allowed).
  const usable = (r: RecentConnection) => session.allowCustomHost || servers.some((s) => connKey(s.host, s.port) === connKey(r.host, r.port));
  let recent = $state(readRecent().filter(usable));

  // After a failed session, start on the server it was using.
  const failedOn = untrack(() => initialError?.details as { host?: string; port?: number } | undefined);
  const failedIndex = failedOn ? servers.findIndex((s) => s.host === failedOn.host && s.port === Number(failedOn.port)) : -1;

  let serverIndex = $state(failedIndex >= 0 ? failedIndex : 0);
  let customHost = $state('127.0.0.1');
  let customPort = $state(3306);
  let user = $state('');
  let password = $state('');
  let sslOn = $state(untrack(() => !!servers[serverIndex]?.ssl));
  let sslVerify = $state(true);
  let sslCa = $state('');
  let dontRemember = $state(false);
  let showPw = $state(false);
  let capsLock = $state(false);
  let busy = $state<'' | 'login' | 'test'>('');
  let error = $state<ApiError | null>(untrack(() => initialError));
  let testOk = $state('');
  let shake = $state(false);
  let userInput: HTMLInputElement | undefined = $state();
  let pwInput: HTMLInputElement | undefined = $state();

  const useCustom = $derived(session.allowCustomHost && serverIndex === -1);
  const listed = $derived(useCustom ? null : (servers[serverIndex] ?? null));
  const showSsl = $derived(useCustom || !!listed?.sslChoice);

  const items = $derived<ServerItem[]>(
    servers.map((s, i) => {
      const look = connectionLook(s.host, s.port, servers);
      return { value: String(i), label: s.label, detail: `${s.host}:${s.port}`, color: look.color, env: look.env };
    }),
  );
  const customItem = $derived<ServerItem | null>(session.allowCustomHost ? { value: '-1', label: t('login.otherServer'), detail: '', color: null, env: null } : null);

  function pickServer(v: string) {
    serverIndex = Number(v);
    const s = servers[serverIndex];
    // A listed server starts from its configured SSL state.
    if (s) sslOn = !!s.ssl;
    error = null;
    testOk = '';
  }

  /** One click on a recent connection: fill everything but the password, focus it. */
  async function useRecent(r: RecentConnection, focus = true) {
    const idx = servers.findIndex((s) => connKey(s.host, s.port) === connKey(r.host, r.port));
    if (idx >= 0) {
      serverIndex = idx;
      sslOn = servers[idx].sslChoice && r.ssl ? r.ssl.enabled : !!servers[idx].ssl;
    } else {
      serverIndex = -1;
      customHost = r.host;
      customPort = r.port;
      sslOn = r.ssl?.enabled ?? false;
    }
    if (r.ssl) {
      sslVerify = r.ssl.verify;
      sslCa = caFiles.includes(r.ssl.ca) ? r.ssl.ca : '';
    }
    user = r.user;
    password = '';
    error = null;
    testOk = '';
    if (focus) {
      await tick();
      pwInput?.focus();
    }
  }
  function forget(r: RecentConnection) {
    recent = forgetRecent(r).filter(usable);
  }
  const recentName = (r: RecentConnection) => r.label ?? r.host;
  const recentSsl = (r: RecentConnection) => r.ssl?.enabled ?? !!servers.find((s) => connKey(s.host, s.port) === connKey(r.host, r.port))?.ssl;

  onMount(() => {
    // Start from the last connection used (unless a session just failed somewhere else).
    if (failedIndex < 0 && recent[0]) void useRecent(recent[0], false);
    void tick().then(() => (user ? pwInput : userInput)?.focus());
  });

  // Which fields the error is about (aria-invalid only there).
  const NETWORK = ['server_unreachable', 'host_not_found', 'not_mysql'];
  const badCreds = $derived(error?.code === 'login_failed');
  const badHost = $derived(!!error && NETWORK.includes(error.code));
  const badSsl = $derived(!!error && error.code.startsWith('ssl_'));

  const errorText = $derived.by(() => {
    if (!error) return null;
    const d = error.details as Record<string, string | number | undefined>;
    const params = { host: String(d.host ?? ''), port: String(d.port ?? ''), ip: String(d.seenFrom ?? ''), plugin: String(d.plugin ?? '?') };
    let key = `error.${error.code}`;
    if (error.code === 'ssl_required' && !showSsl) key = 'error.ssl_required_config';
    const title = t(key, params);
    const lines: string[] = [];
    if (error.code === 'login_failed') {
      lines.push(t('error.login_failed.hint'));
      if (d.seenFrom) lines.push(t('error.login_failed.seenFrom', params));
    }
    if (badSsl && error.code !== 'ssl_required' && !showSsl) lines.push(t('login.sslAdminHint'));
    return { title: title === key ? error.message : title, lines };
  });
  const technical = $derived.by(() => {
    if (!error) return '';
    const d = error.details as Record<string, unknown>;
    const head = d.mysqlCode ? `MySQL ${d.mysqlCode}: ` : `${error.code}: `;
    const warnings = Array.isArray(d.warnings) ? d.warnings.map(String) : [];
    return [head + String(d.serverMessage ?? error.message), ...warnings].join('\n');
  });

  function target() {
    const server = useCustom ? { host: customHost.trim(), port: Number(customPort) || 3306 } : servers[serverIndex];
    const ssl: LoginSsl | undefined = showSsl ? { enabled: sslOn, verify: sslVerify, ca: sslCa } : undefined;
    return { host: server.host, port: server.port, ssl };
  }

  function failed(err: unknown) {
    error = err instanceof ApiError ? err : new ApiError({ code: 'internal', message: String(err) }, 0);
    shake = true;
    setTimeout(() => (shake = false), 320);
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    showPw = false;
    busy = 'login';
    error = null;
    testOk = '';
    const { host, port, ssl } = target();
    try {
      const res = await api.login(host, port, user, password, ssl);
      if (dontRemember) forgetRecent({ host, port, user });
      else rememberRecent({ host, port, user, ssl: ssl ?? null, label: listed?.label ?? null });
      setCsrf(res.csrf);
      app.session = { ...session, auth: res.auth, csrf: res.csrf };
      password = '';
      onlogin();
    } catch (err) {
      failed(err);
    } finally {
      busy = '';
    }
  }

  async function test() {
    busy = 'test';
    error = null;
    testOk = '';
    const { host, port, ssl } = target();
    try {
      const res = await api.loginTest(host, port, user, password, ssl);
      testOk = res.sslCipher ? t('login.testOkSsl', { version: res.version, cipher: res.sslCipher }) : t('login.testOk', { version: res.version });
    } catch (err) {
      failed(err);
    } finally {
      busy = '';
    }
  }

  function caps(e: KeyboardEvent) {
    capsLock = e.getModifierState?.('CapsLock') ?? false;
  }

  // Theme (light / dark / system) for the app after signing in.
  let mode = $state<Mode>(mirroredAppearance().mode);
  const MODES: Mode[] = ['light', 'dark', 'system'];
  function setMode(m: Mode) {
    mode = m;
    applyAppearance({ ...mirroredAppearance(), mode: m });
  }
  function modeKey(e: KeyboardEvent) {
    const i = MODES.indexOf(mode);
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % 3 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + 2) % 3 : -1;
    if (next < 0) return;
    e.preventDefault();
    setMode(MODES[next]);
    void tick().then(() => document.getElementById(`lg-mode-${MODES[next]}`)?.focus());
  }

  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motion = { y: -8, duration: reduced ? 0 : 200 };
</script>

<div class="auth-page lg" data-mode-scope="light">
  <div class="auth-bg" aria-hidden="true">
    <div class="auth-blob auth-blob--violeta"></div>
    <div class="auth-blob auth-blob--ambar"></div>
    <div class="auth-blob auth-blob--oscuro"></div>
    <div class="auth-blob auth-blob--rosa"></div>
  </div>

  <div class="lg-corner">
    <label class="lg-lang">
      <span class="sr-only">{t('common.language')}</span>
      <select value={i18n.locale} onchange={(e) => setLocale((e.currentTarget as HTMLSelectElement).value as Locale)}>
        {#each Object.entries(LOCALES) as [code, l]}
          <option value={code}>{l.label}</option>
        {/each}
      </select>
    </label>
    {#if !session.uiLocked}
      <div class="lg-modes" role="radiogroup" aria-label={t('theme.mode')} tabindex="-1">
        {#each MODES as m}
          <button
            type="button"
            role="radio"
            id="lg-mode-{m}"
            aria-checked={mode === m}
            tabindex={mode === m ? 0 : -1}
            title={t(`theme.${m}`)}
            onclick={() => setMode(m)}
            onkeydown={modeKey}
          >
            {#if m === 'light'}
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
            {:else if m === 'dark'}
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /></svg>
            {:else}
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="3" width="12" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M6 13.5h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
            {/if}
            <span class="sr-only">{t(`theme.${m}`)}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <main class="auth-card lg-card" class:auth-card--shake={shake}>
    <header class="auth-header lg-head">
      <svg class="lg-logo" viewBox="0 0 32 32" width="52" height="52" role="img" aria-label="phpMyFlow">
        <rect width="32" height="32" rx="8" fill="var(--auth-text)" />
        <path d="M9 21c3-8 11-8 14-1" stroke="var(--auth-accent)" stroke-width="3" fill="none" stroke-linecap="round" />
        <circle cx="23" cy="12" r="2.5" fill="var(--auth-accent)" />
      </svg>
      <h1 class="auth-title lg-title">phpMyFlow</h1>
      <p class="auth-subtitle">{t('login.tagline')}</p>
    </header>

    {#if recent.length}
      <section class="lg-recent" aria-labelledby="lg-recent-h">
        <h2 class="lg-h2" id="lg-recent-h">{t('login.recent')}</h2>
        <ul>
          {#each recent as r (connKey(r.host, r.port) + r.user)}
            {@const look = connectionLook(r.host, r.port, servers)}
            <li class="lg-rc" style:--lg-c={look.color ? PALETTE[look.color].light : undefined} class:has-color={!!look.color}>
              <button type="button" class="lg-rc-main" onclick={() => useRecent(r)} aria-label={t('login.recentUse', { user: r.user, name: recentName(r) })}>
                <span class="lg-rc-name">
                  {recentName(r)}
                  {#if recentSsl(r)}
                    <svg class="lg-rc-lock" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
                  {/if}
                </span>
                <span class="lg-rc-user">{r.user}{#if look.env}{` · ${t(`env.${look.env}`)}`}{/if}</span>
              </button>
              <button type="button" class="lg-rc-x" onclick={() => forget(r)} aria-label={t('login.forget', { name: `${r.user} @ ${recentName(r)}` })} title={t('login.forget', { name: `${r.user} @ ${recentName(r)}` })}>×</button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <form onsubmit={submit} novalidate aria-label={t('login.title')}>
      {#if servers.length > 1 || session.allowCustomHost}
        <div class="auth-field">
          <label class="auth-label" for="lg-server">{t('login.server')}</label>
          <ServerPicker id="lg-server" {items} custom={customItem} value={String(serverIndex)} invalid={badHost && !useCustom} onchange={pickServer} />
        </div>
      {/if}

      {#if useCustom}
        <div class="lg-custom" transition:fly={motion}>
          <div class="lg-row">
            <div class="auth-field lg-grow">
              <label class="auth-label" for="lg-host">{t('login.host')}</label>
              <input id="lg-host" class="auth-input" bind:value={customHost} autocomplete="off" spellcheck="false" aria-invalid={badHost ? 'true' : undefined} />
            </div>
            <div class="auth-field lg-port">
              <label class="auth-label" for="lg-port">{t('login.port')}</label>
              <input id="lg-port" class="auth-input" type="number" bind:value={customPort} min="1" max="65535" aria-invalid={badHost ? 'true' : undefined} />
            </div>
          </div>
        </div>
      {/if}

      {#if showSsl}
        <div class="lg-ssl" class:attn={badSsl} transition:fly={motion}>
          <label class="auth-check">
            <input type="checkbox" bind:checked={sslOn} onchange={() => (error = null)} aria-invalid={badSsl ? 'true' : undefined} />
            <span>{t('login.ssl')}</span>
          </label>
          {#if sslOn}
            <details class="lg-adv" open={!sslVerify || error?.code === 'ssl_untrusted'}>
              <summary>{t('login.sslAdvanced')}</summary>
              <div class="lg-adv-body">
                <label class="auth-check">
                  <input type="checkbox" bind:checked={sslVerify} />
                  <span>{t('login.sslVerify')}</span>
                </label>
                {#if !sslVerify}
                  <p class="auth-aviso-amarillo" role="note">{t('login.sslVerifyOff')}</p>
                {/if}
                <div class="auth-field lg-ca">
                  <label class="auth-label" for="lg-ca">{t('login.sslCa')}</label>
                  <select id="lg-ca" class="auth-input" bind:value={sslCa} disabled={!sslVerify}>
                    <option value="">{t('login.sslCaSystem')}</option>
                    {#each caFiles as c}<option value={c}>{c}</option>{/each}
                  </select>
                </div>
              </div>
            </details>
          {/if}
        </div>
      {/if}

      <div class="auth-field">
        <label class="auth-label" for="lg-user">{t('login.user')}</label>
        <input id="lg-user" bind:this={userInput} class="auth-input" bind:value={user} autocomplete="username" required spellcheck="false" aria-invalid={badCreds ? 'true' : undefined} />
      </div>
      <div class="auth-field">
        <label class="auth-label" for="lg-pw">{t('login.password')}</label>
        <div class="auth-input-wrap">
          <input
            id="lg-pw"
            bind:this={pwInput}
            class="auth-input"
            type={showPw ? 'text' : 'password'}
            bind:value={password}
            autocomplete="current-password"
            spellcheck="false"
            aria-invalid={badCreds ? 'true' : undefined}
            aria-describedby={capsLock ? 'lg-caps' : undefined}
            onkeydown={caps}
            onkeyup={caps}
            onblur={() => (capsLock = false)}
          />
          <button
            type="button"
            class="auth-eye"
            aria-label={showPw ? t('login.hidePassword') : t('login.showPassword')}
            aria-pressed={showPw}
            aria-controls="lg-pw"
            title={showPw ? t('login.hidePassword') : t('login.showPassword')}
            onclick={() => (showPw = !showPw)}
          >
            {#if showPw}
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7a12 12 0 0 1-3.2 4.3M6.6 6.6C4.4 8 2.8 10.2 2 12c1 2.5 5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            {:else}
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2" /></svg>
            {/if}
          </button>
        </div>
        {#if capsLock}
          <p class="lg-caps" id="lg-caps" role="status">{t('login.capsLock')}</p>
        {/if}
      </div>

      {#if errorText}
        <div class="auth-banner lg-banner" role="alert">
          <p class="lg-banner-title">{errorText.title}</p>
          {#each errorText.lines as line}<p>{line}</p>{/each}
          <details class="lg-tech">
            <summary>{t('login.details')}</summary>
            <pre>{technical}</pre>
          </details>
        </div>
      {/if}
      {#if testOk}
        <p class="auth-banner auth-banner--success lg-banner" role="status">{testOk}</p>
      {/if}

      <button class="auth-btn" type="submit" disabled={!!busy || !user}>
        {#if busy === 'login'}<span class="auth-spinner" aria-hidden="true"></span>{t('login.connecting')}{:else}{t('login.submit')}{/if}
      </button>
      <div class="lg-below">
        <button class="auth-link lg-test" type="button" disabled={!!busy || !user} onclick={test}>
          {busy === 'test' ? t('login.testing') : t('login.test')}
        </button>
        <label class="auth-check lg-forget">
          <input type="checkbox" bind:checked={dontRemember} />
          <span>{t('login.dontRemember')}</span>
        </label>
      </div>
      <p class="auth-note">{t('login.note')}</p>
    </form>
  </main>
  <footer class="auth-footer">
    phpMyFlow v{session.version}
    {#if /^https?:\/\//.test(session.sourceUrl ?? '')}
      · <a class="lg-source" href={session.sourceUrl} target="_blank" rel="noopener noreferrer">{t('login.source')}</a>
    {/if}
  </footer>
</div>

<style>
  /* Login screen (components/Login.svelte). spider-ui auth-* does the page,
     card, fields and button; this only lays out phpMyFlow's extra pieces.
     Inside the card only --auth-* tokens (the card stays light in both modes);
     on the dark background, colors derive from currentColor of .auth-footer. */
  /* AGPL-3.0 source link in the footer, on the dark background. */
  .lg-source {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .lg-source:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
    border-radius: 2px;
  }
  .lg {
    min-height: 100%;
    /* spider-ui defines these on :root from tokens that flip in dark mode;
       re-read them here, under the light scope (see themes/modes.css). */
    --auth-primary: var(--sp-primary);
    --auth-primary-hover: var(--sp-primary-hover);
    --auth-primary-ring: var(--sp-primary-ring);
    --auth-accent: var(--sp-accent);
    --auth-success: var(--sp-success);
  }
  .lg-card {
    width: min(92vw, 440px);
  }
  .lg-head {
    margin-bottom: 24px;
  }
  .lg-logo {
    display: block;
    margin: 0 auto;
  }
  .lg-title {
    margin-top: 12px;
  }
  .lg-h2 {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--auth-muted);
  }

  /* Recent connections */
  .lg-recent {
    margin-bottom: 20px;
  }
  .lg-recent ul {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .lg-rc {
    position: relative;
    min-width: 0;
  }
  .lg-rc-main {
    display: grid;
    gap: 2px;
    width: 100%;
    padding: 9px 28px 9px 12px;
    border: 1.5px solid var(--auth-border);
    border-radius: 10px;
    background: none;
    font: inherit;
    text-align: left;
    color: var(--auth-text);
    cursor: pointer;
    transition: border-color 150ms ease, transform 150ms ease;
  }
  .lg-rc.has-color .lg-rc-main {
    border-left: 4px solid var(--lg-c);
    padding-left: 10px;
  }
  .lg-rc-main:hover {
    border-color: var(--auth-primary);
  }
  .lg-rc.has-color .lg-rc-main:hover {
    border-left-color: var(--lg-c);
  }
  .lg-rc-main:active {
    transform: translateY(1px);
  }
  .lg-rc-main:focus-visible,
  .lg-rc-x:focus-visible,
  .lg-test:focus-visible,
  .lg-adv summary:focus-visible,
  .lg-tech summary:focus-visible {
    outline: 2px solid var(--auth-primary);
    outline-offset: 2px;
  }
  .lg-rc-name {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    font-size: 13.5px;
    font-weight: 600;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .lg-rc-lock {
    flex: none;
    color: var(--auth-success);
  }
  .lg-rc-user {
    font: 12px var(--sp-font-mono);
    color: var(--auth-muted);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .lg-rc-x {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--auth-muted);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .lg-rc-x:hover {
    color: var(--auth-text);
    background: color-mix(in srgb, var(--auth-primary) 9%, transparent);
  }

  /* Other server / SSL */
  .lg-row {
    display: flex;
    gap: 12px;
  }
  .lg-grow {
    flex: 1;
    min-width: 0;
  }
  .lg-port {
    width: 104px;
  }
  .lg-ssl {
    display: grid;
    gap: 8px;
    margin-bottom: 16px;
    padding: 10px 12px;
    border: 1.5px solid var(--auth-border);
    border-radius: 8px;
  }
  .lg-ssl.attn {
    border-color: var(--auth-danger);
  }
  .lg-adv summary,
  .lg-tech summary {
    width: fit-content;
    font-size: 13px;
    color: var(--auth-muted);
    cursor: pointer;
    border-radius: 4px;
  }
  .lg-adv-body {
    display: grid;
    gap: 10px;
    margin-top: 10px;
  }
  .lg-ca {
    margin-bottom: 0;
  }
  .lg-caps {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--auth-muted);
  }
  .lg-caps::before {
    content: '⇪ ';
  }

  /* Messages inside the card */
  .lg-banner p {
    margin: 0;
  }
  .lg-banner {
    display: grid;
    gap: 4px;
  }
  .lg-banner-title {
    font-weight: 600;
  }
  .lg-tech pre {
    margin: 6px 0 0;
    padding: 6px 8px;
    border-radius: 6px;
    background: color-mix(in srgb, currentColor 6%, transparent);
    font: 12px/1.5 var(--sp-font-mono);
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Discreet row below the button */
  .lg-below {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 14px;
  }
  .lg-test:disabled {
    color: var(--auth-muted);
    cursor: not-allowed;
    text-decoration: none;
  }
  .lg-forget {
    font-size: 13px;
    align-items: center;
  }
  .lg-forget input {
    margin-top: 0;
  }

  /* Language + theme, top right corner on the dark background */
  .lg-corner {
    position: absolute;
    top: 16px;
    right: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--lg-on-dark);
    /* Same white as spider-ui's .auth-footer text on the dark background. */
    --lg-on-dark: color-mix(in srgb, var(--auth-border) 85%, transparent);
  }
  .lg-lang select {
    appearance: none;
    padding: 5px 10px;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, currentColor 8%, transparent);
    color: inherit;
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }
  .lg-lang option {
    color: var(--auth-text);
  }
  .lg-modes {
    display: flex;
    padding: 2px;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
    border-radius: 8px;
  }
  .lg-modes button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .lg-modes button[aria-checked='true'] {
    background: color-mix(in srgb, currentColor 22%, transparent);
  }
  .lg-lang select:focus-visible,
  .lg-modes button:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }

  /* Phones: full-width card, no moving shapes. */
  @media (max-width: 480px) {
    .lg {
      padding: 64px 0 16px;
    }
    .lg-card {
      width: 100%;
      border-radius: 0;
      padding: 24px 16px;
    }
    .lg :global(.auth-blob) {
      display: none;
    }
    .lg-recent ul {
      grid-template-columns: 1fr;
    }
    .lg-corner {
      top: 14px;
      right: 16px;
    }
  }
</style>
