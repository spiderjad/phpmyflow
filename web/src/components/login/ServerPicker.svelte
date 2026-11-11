<script lang="ts">
  // Login server picker (auth-* look, the card is always light): a button with
  // role="listbox" popup grouping "Configured" servers (color + environment
  // label) and "Other server…". Keyboard: ↑/↓, Home/End, Enter, Esc, type-ahead.
  // Styles: .lg-sp-* (login only).
  import { tick } from 'svelte';
  import { t } from '../../lib/i18n.svelte';
  import type { Env } from '../../lib/connections';
  import { PALETTE, type ColorId } from '../../lib/theme';

  export interface ServerItem {
    value: string;
    label: string;
    detail: string;
    color: ColorId | null;
    env: Env | null;
  }

  let {
    id,
    items,
    custom,
    value,
    invalid = false,
    onchange,
  }: {
    id: string;
    items: ServerItem[];
    /** "Other server…" entry, when config.php allows any host. */
    custom: ServerItem | null;
    value: string;
    invalid?: boolean;
    onchange: (v: string) => void;
  } = $props();

  let open = $state(false);
  let active = $state(0);
  let button: HTMLButtonElement;
  let list: HTMLDivElement | undefined = $state();
  const all = $derived(custom ? [...items, custom] : items);
  const current = $derived(all.find((i) => i.value === value) ?? all[0]);
  const optId = (i: number) => `${id}-opt-${i}`;

  async function show() {
    open = true;
    active = Math.max(0, all.findIndex((i) => i.value === value));
    await tick();
    list?.focus();
  }
  function close(focus = true) {
    open = false;
    if (focus) button?.focus();
  }
  function choose(i: number) {
    const it = all[i];
    if (it) onchange(it.value);
    close();
  }
  let typed = '';
  let typedAt = 0;
  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') active = Math.min(all.length - 1, active + 1);
    else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
    else if (e.key === 'Home') active = 0;
    else if (e.key === 'End') active = all.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') choose(active);
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') close(false);
    else if (e.key.length === 1) {
      const now = Date.now();
      typed = now - typedAt > 700 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
      typedAt = now;
      const hit = all.findIndex((i) => i.label.toLowerCase().startsWith(typed));
      if (hit >= 0) active = hit;
      return;
    } else return;
    e.preventDefault();
    document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' });
  }
  const dot = (c: ColorId | null) => (c ? PALETTE[c].light : 'transparent');
</script>

<div class="lg-sp">
  <button
    bind:this={button}
    {id}
    type="button"
    class="auth-input lg-sp-btn"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls="{id}-list"
    class:bad={invalid}
    onclick={() => (open ? close() : show())}
    onkeydown={(e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        show();
      }
    }}
  >
    {#if current}
      <span class="lg-sp-dot" class:none={!current.color} style:background={dot(current.color)} aria-hidden="true"></span>
      <span class="lg-sp-name">{current.label}</span>
      {#if current.detail}<span class="lg-sp-detail">{current.detail}</span>{/if}
      {#if current.env}<span class="lg-sp-env" style:color={PALETTE[current.color ?? 'blue'].light}>{t(`env.${current.env}`)}</span>{/if}
    {/if}
    <svg class="lg-sp-caret" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
  </button>
  {#if open}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      bind:this={list}
      class="lg-sp-list"
      role="listbox"
      id="{id}-list"
      tabindex="-1"
      aria-label={t('login.server')}
      aria-activedescendant={optId(active)}
      onkeydown={key}
      onblur={(e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) close(false);
      }}
    >
      <div role="group" aria-labelledby="{id}-g1">
        <div class="lg-sp-group" id="{id}-g1" role="presentation">{t('login.configured')}</div>
        {#each items as it, i}
          <div
            id={optId(i)}
            role="option"
            tabindex="-1"
            aria-selected={it.value === value}
            class="lg-sp-opt"
            class:active={i === active}
            onmousedown={(e) => e.preventDefault()}
            onclick={() => choose(i)}
            onmousemove={() => (active = i)}
            onkeydown={() => {}}
          >
            <span class="lg-sp-dot" class:none={!it.color} style:background={dot(it.color)} aria-hidden="true"></span>
            <span class="lg-sp-name">{it.label}</span>
            <span class="lg-sp-detail">{it.detail}</span>
            {#if it.env}<span class="lg-sp-env" style:color={PALETTE[it.color ?? 'blue'].light}>{t(`env.${it.env}`)}</span>{/if}
          </div>
        {/each}
      </div>
      {#if custom}
        <div class="lg-sp-sep" role="presentation"></div>
        <div
          id={optId(items.length)}
          role="option"
          tabindex="-1"
          aria-selected={custom.value === value}
          class="lg-sp-opt"
          class:active={active === items.length}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => choose(items.length)}
          onmousemove={() => (active = items.length)}
          onkeydown={() => {}}
        >
          <span class="lg-sp-dot none" aria-hidden="true"></span>
          <span class="lg-sp-name">{custom.label}</span>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Login server picker (components/Login.svelte). The auth card is always
     light, so only --auth-* tokens and tints of --auth-primary are used. */
  .lg-sp {
    position: relative;
  }
  .lg-sp-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    cursor: pointer;
  }
  .lg-sp-btn.bad {
    border-color: var(--auth-danger);
  }
  .lg-sp-btn:focus-visible {
    border-color: var(--auth-primary);
    box-shadow: 0 0 0 4px var(--auth-primary-ring);
  }
  .lg-sp-caret {
    margin-left: auto;
    flex: none;
    color: var(--auth-muted);
  }
  .lg-sp-dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .lg-sp-dot.none {
    border: 1.5px solid var(--auth-border);
  }
  .lg-sp-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--auth-text);
  }
  .lg-sp-detail {
    flex: none;
    font: 12px var(--sp-font-mono);
    color: var(--auth-muted);
  }
  .lg-sp-env {
    flex: none;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .lg-sp-list {
    position: absolute;
    z-index: 10;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    max-height: 300px;
    overflow: auto;
    padding: 6px;
    background: var(--auth-bg, #fff);
    border: 1px solid var(--auth-border);
    border-radius: 10px;
    box-shadow: var(--sp-shadow-lg);
    outline: none;
  }
  .lg-sp-list:focus-visible {
    box-shadow: 0 0 0 4px var(--auth-primary-ring), var(--sp-shadow-lg);
  }
  .lg-sp-group {
    padding: 6px 8px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--auth-muted);
  }
  .lg-sp-opt {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
  }
  .lg-sp-opt.active {
    background: color-mix(in srgb, var(--auth-primary) 9%, transparent);
  }
  .lg-sp-opt[aria-selected='true'] .lg-sp-name {
    font-weight: 600;
  }
  .lg-sp-opt .lg-sp-detail {
    margin-left: auto;
  }
  .lg-sp-sep {
    height: 1px;
    margin: 6px 4px;
    background: var(--auth-border);
  }
</style>
