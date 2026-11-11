<script lang="ts">
  // Settings › Connections: color and environment per server. config.php
  // ('color', 'env') sets them for everyone; the environment from config.php
  // can't be changed here. The suggested environment (by host) is only a
  // button: nothing changes until the user applies it.
  import { tick } from 'svelte';
  import { t } from '../../lib/i18n.svelte';
  import { app } from '../../lib/state.svelte';
  import { connKey, connectionLook, ENVS, readConnectionPrefs, readRecent, suggestEnv, type Env } from '../../lib/connections';
  import { connectionsVersion, setConnectionPref } from '../../lib/settings.svelte';
  import { COLORS, PALETTE, type ColorId } from '../../lib/theme';
  import Select from '../ui/Select.svelte';

  const session = $derived(app.session!);
  const current = $derived(session.auth ? connKey(session.auth.host, session.auth.port) : '');

  // Current connection, configured servers and recent ones, once each.
  const list = $derived.by(() => {
    void connectionsVersion.n;
    const seen = new Map<string, { host: string; port: number; name: string }>();
    const add = (host: string, port: number, name: string) => {
      const k = connKey(host, port);
      if (!seen.has(k)) seen.set(k, { host, port, name });
    };
    if (session.auth) add(session.auth.host, session.auth.port, session.servers.find((s) => connKey(s.host, s.port) === current)?.label ?? session.auth.host);
    for (const s of session.servers) add(s.host, s.port, s.label);
    for (const r of readRecent()) add(r.host, r.port, r.label ?? r.host);
    const prefs = readConnectionPrefs();
    return [...seen.entries()].map(([key, c]) => ({ key, ...c, look: connectionLook(c.host, c.port, session.servers, prefs), mine: prefs[key] ?? {} }));
  });

  const envOptions = $derived([{ value: '', label: t('settings.envNone') }, ...ENVS.map((e) => ({ value: e, label: t(`env.${e}`) }))]);
  // Radio group keys: arrows choose the previous / next color and keep the focus on it.
  const ALL = [null, ...COLORS] as (ColorId | null)[];
  function colorKey(e: KeyboardEvent, key: string, col: ColorId | null) {
    const i = ALL.indexOf(col);
    const j = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % ALL.length : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + ALL.length) % ALL.length : -1;
    if (j < 0) return;
    e.preventDefault();
    const group = (e.currentTarget as HTMLElement).parentElement!;
    setConnectionPref(key, { color: ALL[j] });
    void tick().then(() => group.querySelectorAll<HTMLElement>('[role="radio"]')[j]?.focus());
  }
  const mode = () => (document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'light');
</script>

<p class="v-help st-conn-intro">{t('settings.connIntro')}</p>
<ul class="st-conns">
  {#each list as c (c.key)}
    {@const suggested = suggestEnv(c.host)}
    <li class="st-conn">
      <div class="st-conn-head">
        <span class="st-conn-dot" class:none={!c.look.color} style:--c={c.look.color ? PALETTE[c.look.color][mode()] : undefined} aria-hidden="true"></span>
        <strong>{c.name}</strong>
        <span class="mono dim">{c.host}:{c.port}</span>
        {#if c.key === current}<span class="v-badge">{t('settings.current')}</span>{/if}
      </div>
      <div class="st-conn-ctrls">
        <div class="st-conn-env">
          <span class="st-conn-lbl" id="env-{c.key}">{t('settings.env')}</span>
          {#if c.look.envFrom === 'config'}
            <span class="v-badge">{t(`env.${c.look.env}`)}</span>
            <span class="v-help">{t('settings.envFromConfig')}</span>
          {:else}
            <Select
              id="env-sel-{c.key}"
              value={c.mine.env ?? ''}
              options={envOptions}
              label={t('settings.envFor', { name: c.name })}
              compact
              onchange={(v) => setConnectionPref(c.key, { env: (v || null) as Env | null })}
            />
            {#if !c.mine.env}
              <button class="v-btn-ghost v-btn--sm" onclick={() => setConnectionPref(c.key, { env: suggested })}>
                {t('settings.envSuggest', { env: t(`env.${suggested}`) })}
              </button>
            {/if}
          {/if}
        </div>
        <div class="st-conn-colors" role="radiogroup" aria-label={t('settings.colorFor', { name: c.name })}>
          {#each [null, ...COLORS] as col}
            {@const on = (c.mine.color ?? null) === col}
            <button
              type="button"
              role="radio"
              class="st-sw"
              class:none={col === null}
              aria-checked={on}
              tabindex={on ? 0 : -1}
              title={col ? t(`color.${col}`) : t('settings.colorAuto')}
              onkeydown={(e) => colorKey(e, c.key, col)}
              style:--c={col ? PALETTE[col as ColorId][mode()] : undefined}
              onclick={() => setConnectionPref(c.key, { color: col as ColorId | null })}
            ><span class="sr-only">{col ? t(`color.${col}`) : t('settings.colorAuto')}</span></button>
          {/each}
        </div>
      </div>
    </li>
  {/each}
</ul>

<style>
  /* Connections list (Settings › Connections). */
  .st-conn-intro {
    margin: 0 0 12px;
  }
  .st-conns {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .st-conn {
    display: grid;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius-lg);
  }
  .st-conn-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 13px;
  }
  .st-conn-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--c);
  }
  .st-conn-dot.none {
    background: none;
    border: 1.5px solid var(--sp-border-hover);
  }
  .dim {
    color: var(--sp-text-secondary);
    font-size: 12px;
  }
  .st-conn-ctrls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .st-conn-env {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .st-conn-env :global(.sel) {
    width: 170px;
  }
  .st-conn-lbl {
    font-size: 12px;
    color: var(--sp-text-secondary);
  }
  .st-conn-colors {
    display: flex;
    gap: 4px;
  }
  .st-sw {
    width: 20px;
    height: 20px;
    padding: 0;
    border: 2px solid var(--sp-bg);
    border-radius: 50%;
    background: var(--c);
    box-shadow: 0 0 0 1px var(--sp-border);
    cursor: pointer;
  }
  .st-sw.none {
    background: linear-gradient(135deg, transparent 45%, var(--sp-border-hover) 45% 55%, transparent 55%);
  }
  .st-sw[aria-checked='true'] {
    box-shadow: 0 0 0 2px var(--sp-focus);
  }
  .st-sw:focus-visible {
    outline: 2px solid var(--sp-focus);
    outline-offset: 2px;
  }
</style>
