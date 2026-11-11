<script lang="ts" module>
  export type MenuItem =
    | 'sep'
    | {
        label: string;
        /** Icon on the left (lib/menuIcons.ts); otherwise one from the id, if known. */
        icon?: string;
        /** Shortcut keys shown with <kbd>, e.g. ['Ctrl', 'C']. */
        keys?: string[];
        /** true, or the reason it is disabled (tooltip + aria-describedby). */
        disabled?: boolean | string;
        /** Destructive (Drop, Truncate…): red, and always at the end of the menu. */
        danger?: boolean;
        /** Radio-like entries (relation display): a check on the left. */
        checked?: boolean;
        action?: () => void;
        submenu?: MenuItem[];
        /** Small text on the right ("Coming soon", a missing privilege). */
        note?: string;
        /** Tooltip with more detail (e.g. the GRANT that would enable it). */
        title?: string;
        /** Disabled entries: what a click does instead (copy the GRANT). */
        onDisabled?: () => void;
        /** Test hook / stable selector; also picks a default icon. */
        id?: string;
      };

  /** Destructive entries go last, after a separator; no doubled or edge separators. */
  export function arrange(items: MenuItem[]): MenuItem[] {
    const safe = items.filter((i) => i === 'sep' || !i.danger);
    const danger = items.filter((i) => i !== 'sep' && i.danger);
    const out = danger.length ? [...safe, 'sep' as const, ...danger] : safe;
    return out.filter((i, k) => i !== 'sep' || (k > 0 && k < out.length - 1 && out[k - 1] !== 'sep'));
  }
</script>

<script lang="ts">
  // The spider-ui menu (.v-menu) for every menu: grid (cells and headers),
  // tables, databases and objects in the sidebar, overview "⋯", SQL results.
  // Icons on the left, shortcuts on the right (<kbd>), submenus on hover and
  // with →, destructive entries last and in red, disabled ones say why.
  // Keyboard: ↑ ↓ Home End, → ← for submenus, a letter jumps to the next
  // entry that starts with it, Esc closes. Opens next to the pointer and
  // stays on screen; 120 ms entrance, none with reduced motion.
  import { tick } from 'svelte';
  import { ID_ICONS, MENU_ICONS } from '../../lib/menuIcons';

  let { x, y, items: raw, label, onclose }: { x: number; y: number; items: MenuItem[]; label: string; onclose: (refocus: boolean) => void } = $props();

  const items = $derived(arrange(raw));
  const uid = `m-${Math.random().toString(36).slice(2, 8)}`;
  let root: HTMLDivElement | undefined = $state();
  let open = $state<number | null>(null);
  let subEl: HTMLDivElement | undefined = $state();
  let pos = $state({ x: -9999, y: -9999 });
  let subPos = $state({ x: -9999, y: -9999 });

  const iconOf = (i: Exclude<MenuItem, 'sep'>) => MENU_ICONS[i.icon ?? ID_ICONS[i.id ?? ''] ?? ''];
  const withIcons = (list: MenuItem[]) => list.some((i) => i !== 'sep' && (iconOf(i) || i.checked !== undefined));
  // Why it is disabled: the text given, or its tooltip (a missing privilege, the GRANT).
  const reason = (i: Exclude<MenuItem, 'sep'>) => (typeof i.disabled === 'string' ? i.disabled : i.disabled ? (i.title ?? i.note ?? '') : '');

  // Next to the pointer, kept on screen.
  $effect(() => {
    void items;
    tick().then(() => {
      const w = root?.offsetWidth ?? 240;
      const h = root?.offsetHeight ?? 300;
      pos = { x: Math.max(4, Math.min(x, window.innerWidth - w - 4)), y: Math.max(4, Math.min(y, window.innerHeight - h - 4)) };
      root?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    });
  });

  const enabled = (el: HTMLElement | undefined) => [...(el?.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]:not([aria-disabled="true"])') ?? [])];

  async function openSub(i: number, focus: boolean) {
    open = i;
    await tick();
    const btn = root?.querySelector<HTMLElement>(`[data-i="${i}"]`);
    const r = btn?.getBoundingClientRect();
    const w = subEl?.offsetWidth ?? 220;
    const h = subEl?.offsetHeight ?? 200;
    if (r) {
      const right = r.right + 2 + w < window.innerWidth;
      subPos = { x: right ? r.right + 2 : r.left - w - 2, y: Math.max(4, Math.min(r.top - 4, window.innerHeight - h - 4)) };
    }
    if (focus) enabled(subEl)[0]?.focus();
  }

  function run(item: Exclude<MenuItem, 'sep'>) {
    if (item.disabled) {
      if (item.onDisabled) {
        onclose(false);
        item.onDisabled();
      }
      return;
    }
    if (!item.action) return;
    onclose(false);
    item.action();
  }

  function navigate(e: KeyboardEvent, list: HTMLElement[]) {
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') list[(i + 1) % list.length]?.focus();
    else if (e.key === 'ArrowUp') list[(i - 1 + list.length) % list.length]?.focus();
    else if (e.key === 'Home') list[0]?.focus();
    else if (e.key === 'End') list[list.length - 1]?.focus();
    else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type-ahead: the next entry whose label starts with that letter.
      const k = e.key.toLocaleLowerCase();
      const order = [...list.slice(i + 1), ...list.slice(0, i + 1)];
      const hit = order.find((el) => (el.dataset.label ?? '').toLocaleLowerCase().startsWith(k));
      if (!hit) return false;
      hit.focus();
    } else return false;
    e.preventDefault();
    return true;
  }

  function rootKey(e: KeyboardEvent) {
    if (subEl?.contains(e.target as Node)) return;
    if (navigate(e, enabled(root))) return;
    const target = document.activeElement as HTMLElement;
    const i = Number(target?.dataset.i);
    if (e.key === 'ArrowRight' && !Number.isNaN(i) && typeof items[i] === 'object' && (items[i] as { submenu?: unknown }).submenu) {
      e.preventDefault();
      openSub(i, true);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      onclose(true);
    }
  }

  function subKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (navigate(e, enabled(subEl))) return;
    if (e.key === 'ArrowLeft' || e.key === 'Escape') {
      e.preventDefault();
      const i = open;
      open = null;
      if (i !== null) root?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      onclose(true);
    }
  }

  function outside(e: PointerEvent) {
    const t = e.target as Node;
    if (!root?.contains(t) && !subEl?.contains(t)) onclose(false);
  }
</script>

<svelte:window onpointerdown={outside} onblur={() => onclose(false)} onresize={() => onclose(false)} />

{#snippet entry(item: MenuItem, i: number, inSub: boolean, icons: boolean)}
  {#if item === 'sep'}
    <div class="v-menu__sep" role="separator"></div>
  {:else}
    {@const why = reason(item)}
    {@const d = iconOf(item)}
    <button
      class="v-menu__item mi"
      class:danger={item.danger}
      role={item.checked !== undefined ? 'menuitemradio' : 'menuitem'}
      tabindex="-1"
      data-i={inSub ? undefined : i}
      data-id={item.id}
      data-label={item.label}
      title={why || item.title || item.note}
      aria-checked={item.checked !== undefined ? item.checked : undefined}
      aria-disabled={item.disabled ? 'true' : undefined}
      aria-describedby={why ? `${uid}-why-${inSub ? 's' : ''}${i}` : undefined}
      aria-haspopup={item.submenu ? 'menu' : undefined}
      aria-expanded={item.submenu ? open === i : undefined}
      onclick={() => (item.submenu ? openSub(i, true) : run(item))}
      onpointerenter={() => {
        if (!inSub) {
          if (item.submenu && !item.disabled) openSub(i, false);
          else open = null;
        }
      }}
    >
      {#if icons}
        <span class="mi-icon" aria-hidden="true">
          {#if item.checked}
            <svg viewBox="0 0 16 16" width="15" height="15"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
          {:else if d}
            <svg viewBox="0 0 16 16" width="15" height="15"><path {d} fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg>
          {/if}
        </span>
      {/if}
      <span class="v-menu__label">{item.label}</span>
      {#if item.note}<span class="note">{item.note}</span>{/if}
      {#if item.keys}
        <span class="v-menu__hint">{#each item.keys as k}<kbd class="v-kbd">{k}</kbd>{/each}</span>
      {/if}
      {#if item.submenu}
        <svg class="chev" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
      {/if}
      {#if why}<span class="sr-only" id="{uid}-why-{inSub ? 's' : ''}{i}">{why}</span>{/if}
    </button>
  {/if}
{/snippet}

<div class="v-menu ctx" role="menu" tabindex="-1" aria-label={label} bind:this={root} style:left="{pos.x}px" style:top="{pos.y}px" onkeydown={rootKey}>
  {#each items as item, i}{@render entry(item, i, false, withIcons(items))}{/each}
</div>

{#if open !== null && typeof items[open] === 'object'}
  {@const parent = items[open] as Exclude<MenuItem, 'sep'>}
  {#if parent.submenu}
    {@const sub = arrange(parent.submenu)}
    <div class="v-menu ctx" role="menu" tabindex="-1" aria-label={parent.label} bind:this={subEl} style:left="{subPos.x}px" style:top="{subPos.y}px" onkeydown={subKey}>
      {#each sub as item, i}{@render entry(item, i, true, withIcons(sub))}{/each}
    </div>
  {/if}
{/if}

<style>
  /* Menus (components/ui/Menu.svelte) on top of spider-ui's .v-menu. */
  .ctx {
    position: fixed;
    z-index: 60;
    min-width: 200px;
    max-height: calc(100vh - 8px);
    overflow-y: auto;
    animation: mi-in 120ms ease-out;
  }
  @keyframes mi-in {
    from {
      opacity: 0;
      transform: translateY(-3px) scale(0.98);
    }
  }
  .mi {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    column-gap: 10px;
    min-height: 30px;
    padding: 4px 10px;
    font-size: 13px;
  }
  .mi > .v-menu__label {
    grid-column: 2;
  }
  .mi-icon {
    grid-column: 1;
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    color: var(--sp-text-secondary);
  }
  .v-menu__hint {
    display: inline-flex;
    gap: 2px;
    justify-self: end;
  }
  .danger,
  .danger .mi-icon {
    color: var(--sp-danger-text);
  }
  .danger[aria-disabled='true'],
  .danger[aria-disabled='true'] .mi-icon {
    color: var(--sp-text-tertiary);
  }
  .note {
    padding-left: 12px;
    font-size: 11px;
    color: var(--sp-text-tertiary);
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chev {
    grid-column: 4;
    color: var(--sp-text-tertiary);
  }
  .mi[aria-expanded='true'] {
    background: var(--sp-bg-muted);
  }
  .mi:focus-visible {
    outline: 2px solid var(--sp-focus);
    outline-offset: -2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .ctx {
      animation: none;
    }
  }
</style>
