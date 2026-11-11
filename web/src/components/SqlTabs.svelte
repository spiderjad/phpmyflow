<script lang="ts">
  import { tick } from 'svelte';
  import { n, t } from '../lib/i18n.svelte';
  import { tabs, UNDO_MS, type SqlTab } from '../lib/tabs.svelte';
  import { toast } from '../lib/ui.svelte';

  let { panelId }: { panelId: string } = $props();

  let bar: HTMLDivElement | undefined = $state();
  let renaming = $state<{ id: string; value: string } | null>(null);
  let menu = $state<{ id: string; x: number; y: number } | null>(null);
  let menuEl: HTMLDivElement | undefined = $state();
  let dragId = $state<string | null>(null);
  let dropIndex = $state<number | null>(null);

  const label = (tab: SqlTab) => tabs.titleOf(tab) || t('tabs.untitled', { n: n(tab.n) });

  function status(tab: SqlTab): 'running' | 'error' | 'dirty' | null {
    if (tab.running) return 'running';
    if (tabs.hasError(tab)) return 'error';
    if (tabs.isDirty(tab)) return 'dirty';
    return null;
  }

  async function focusTab(id: string) {
    await tick();
    const el = bar?.querySelector<HTMLElement>(`[data-tab="${id}"]`);
    el?.focus();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // Keep the active tab visible when it changes (shortcuts, new tabs).
  $effect(() => {
    const id = tabs.activeId;
    tick().then(() => bar?.querySelector(`[data-tab="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  });

  export function newTab() {
    if (!tabs.create()) {
      toast(t('tabs.limit', { max: 30 }), 'error');
      return;
    }
    focusTab(tabs.activeId);
  }

  export function closeTab(id: string) {
    const tab = tabs.list.find((x) => x.id === id);
    if (!tab) return;
    const name = label(tab);
    if (tabs.close(id)) {
      toast(t('tabs.closed', { name }), 'info', UNDO_MS, {
        label: t('tabs.undo'),
        run: () => {
          const back = tabs.undoClose();
          if (back) focusTab(back.id);
        },
      });
    }
  }

  function closeOthers(id: string) {
    const count = tabs.list.filter((x) => x.id !== id && x.sql.trim()).length;
    tabs.closeOthers(id);
    if (count) toast(t('tabs.closedMany', { count }), 'info', UNDO_MS, { label: t('tabs.undo'), run: () => reopen(count) });
  }

  function closeRight(id: string) {
    const i = tabs.list.findIndex((x) => x.id === id);
    const count = tabs.list.slice(i + 1).filter((x) => x.sql.trim()).length;
    tabs.closeRight(id);
    if (count) toast(t('tabs.closedMany', { count }), 'info', UNDO_MS, { label: t('tabs.undo'), run: () => reopen(count) });
  }

  function reopen(count: number) {
    for (let k = 0; k < count; k++) tabs.undoClose();
  }

  function duplicate(id: string) {
    if (!tabs.duplicate(id)) toast(t('tabs.limit', { max: 30 }), 'error');
    else focusTab(tabs.activeId);
  }

  function startRename(id: string) {
    const tab = tabs.list.find((x) => x.id === id);
    if (tab) renaming = { id, value: tab.title || tabs.titleOf(tab) };
  }

  function commitRename() {
    if (!renaming) return;
    const { id, value } = renaming;
    const tab = tabs.list.find((x) => x.id === id);
    renaming = null;
    // Typing the automatic title back (or nothing) keeps it automatic.
    if (tab) tabs.rename(id, value.trim() === tabs.titleOf({ ...tab, title: '' }) ? '' : value);
    focusTab(id);
  }

  function renameKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      const id = renaming?.id;
      renaming = null;
      if (id) focusTab(id);
    }
  }

  function selectInput(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  // --- context menu ---
  async function openMenu(id: string, x: number, y: number) {
    menu = { id, x: Math.min(x, window.innerWidth - 240), y: Math.min(y, window.innerHeight - 220) };
    await tick();
    menuEl?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }

  function closeMenu(refocus = true) {
    const id = menu?.id;
    menu = null;
    if (refocus && id) focusTab(id);
  }

  function menuAction(fn: (id: string) => void) {
    const id = menu!.id;
    closeMenu(false);
    fn(id);
  }

  function menuKey(e: KeyboardEvent) {
    const items = [...(menuEl?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
    else if (e.key === 'Home') items[0]?.focus();
    else if (e.key === 'End') items[items.length - 1]?.focus();
    else if (e.key === 'Escape' || e.key === 'Tab') closeMenu();
    else return;
    e.preventDefault();
  }

  function outside(e: PointerEvent) {
    if (menu && !menuEl?.contains(e.target as Node)) closeMenu(false);
  }

  // --- keyboard inside the tab list ---
  function tabKey(e: KeyboardEvent, tab: SqlTab) {
    const i = tabs.list.findIndex((x) => x.id === tab.id);
    if (e.altKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return; // handled globally
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
      const next =
        e.key === 'Home' ? 0 : e.key === 'End' ? tabs.list.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.list.length) % tabs.list.length;
      tabs.activateIndex(next);
      focusTab(tabs.list[next].id);
    } else if (e.key === 'Delete') {
      closeTab(tab.id);
      focusTab(tabs.activeId);
    } else if (e.key === 'F2') {
      startRename(tab.id);
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      openMenu(tab.id, r.left, r.bottom + 4);
    } else return;
    e.preventDefault();
  }

  // --- global shortcuts (avoid Ctrl+T / Ctrl+W / Ctrl+Tab, the browser owns them) ---
  function globalKey(e: KeyboardEvent) {
    if (renaming) return;
    const active = tabs.active;
    if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
      if (e.code === 'KeyN') newTab();
      else if (e.code === 'KeyW') closeTab(active.id);
      else if (/^Digit[1-9]$/.test(e.code)) {
        const k = Number(e.code.slice(5)) - 1;
        // Alt+9 is always the last tab, like in browsers.
        tabs.activateIndex(k === 8 ? tabs.list.length - 1 : k);
      } else return;
      e.preventDefault();
    } else if (e.ctrlKey && e.altKey && !e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      tabs.step(e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.altKey && e.shiftKey && !e.ctrlKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      tabs.move(active.id, e.key === 'ArrowRight' ? 1 : -1);
      focusTab(active.id);
    }
  }

  // --- drag to reorder ---
  function dragStart(e: DragEvent, id: string) {
    dragId = id;
    e.dataTransfer?.setData('text/plain', id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }
  function dragOver(e: DragEvent, index: number) {
    if (!dragId) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dropIndex = e.clientX > r.left + r.width / 2 ? index + 1 : index;
  }
  function drop(e: DragEvent) {
    e.preventDefault();
    if (dragId !== null && dropIndex !== null) {
      const from = tabs.list.findIndex((x) => x.id === dragId);
      tabs.moveTo(dragId, dropIndex > from ? dropIndex - 1 : dropIndex);
    }
    dragId = null;
    dropIndex = null;
  }
  function dragEnd() {
    dragId = null;
    dropIndex = null;
  }

  const menuTab = $derived(menu ? tabs.list.find((x) => x.id === menu!.id) : null);
  const menuIndex = $derived(menuTab ? tabs.list.indexOf(menuTab) : -1);
</script>

<svelte:window onkeydown={globalKey} onpointerdown={outside} />

<div class="tabs-bar" class:menu-open={!!menu}>
  <!-- Tabs inside are the focus targets (roving tabindex); the list only handles drops. -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div class="list" role="tablist" aria-label={t('tabs.label')} bind:this={bar} ondragover={(e) => e.preventDefault()} ondrop={drop}>
    {#each tabs.list as tab, i (tab.id)}
      {@const selected = tab.id === tabs.activeId}
      {@const st = status(tab)}
      <div
        class="tab"
        class:selected
        class:dragging={dragId === tab.id}
        class:drop-before={dropIndex === i && dragId !== tab.id}
        class:drop-after={dropIndex === i + 1 && i === tabs.list.length - 1}
        draggable={renaming?.id !== tab.id}
        ondragstart={(e) => dragStart(e, tab.id)}
        ondragover={(e) => dragOver(e, i)}
        ondragend={dragEnd}
        role="presentation"
      >
        {#if renaming?.id === tab.id}
          <input
            class="rename"
            bind:value={renaming.value}
            onkeydown={renameKey}
            onblur={commitRename}
            use:selectInput
            aria-label={t('tabs.rename')}
            maxlength="80"
          />
        {:else}
          <button
            role="tab"
            id="tab-{tab.id}"
            data-tab={tab.id}
            aria-selected={selected}
            aria-controls={panelId}
            tabindex={selected ? 0 : -1}
            class="tab-btn"
            onclick={() => tabs.activate(tab.id)}
            ondblclick={() => startRename(tab.id)}
            onauxclick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeTab(tab.id);
              }
            }}
            onmousedown={(e) => {
              if (e.button === 1) e.preventDefault(); // no autoscroll on middle click
            }}
            oncontextmenu={(e) => {
              e.preventDefault();
              tabs.activate(tab.id);
              openMenu(tab.id, e.clientX, e.clientY);
            }}
            onkeydown={(e) => tabKey(e, tab)}
          >
            {#if st === 'running'}
              <span class="spin" role="img" aria-label={t('tabs.running')}></span>
            {:else if st === 'error'}
              <span class="dot error" role="img" aria-label={t('tabs.hasError')}></span>
            {:else if st === 'dirty'}
              <span class="dot dirty" role="img" aria-label={t('tabs.dirty')}></span>
            {/if}
            <span class="name" class:manual={!!tab.title}>{label(tab)}</span>
            {#if tab.db}<span class="db">{tab.db}</span>{/if}
            <span class="tip" role="tooltip">
              <strong>{label(tab)}</strong>{#if tab.db} · {tab.db}{/if}
              {#if i < 9}<span class="keys"><kbd class="v-kbd">Alt</kbd><kbd class="v-kbd">{i === tabs.list.length - 1 && i > 0 ? 9 : i + 1}</kbd></span>{/if}
            </span>
          </button>
          <button class="close" tabindex="-1" onclick={() => closeTab(tab.id)} aria-label={t('tabs.closeTab', { name: label(tab) })}>
            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
            <span class="tip right" role="tooltip">{t('tabs.close')} <kbd class="v-kbd">Alt</kbd><kbd class="v-kbd">W</kbd></span>
          </button>
        {/if}
      </div>
    {/each}
  </div>
  <button class="v-btn-icon v-btn--sm add" onclick={newTab} disabled={!tabs.canCreate} aria-label={t('tabs.new')}>
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
    <span class="tip right" role="tooltip">{t('tabs.new')} <kbd class="v-kbd">Alt</kbd><kbd class="v-kbd">N</kbd></span>
  </button>
</div>

{#if menu && menuTab}
  <div class="v-menu ctx" role="menu" tabindex="-1" aria-label={label(menuTab)} bind:this={menuEl} style:left="{menu.x}px" style:top="{menu.y}px" onkeydown={menuKey}>
    <button class="v-menu__item" role="menuitem" onclick={() => menuAction(startRename)}>
      <span class="v-menu__label">{t('tabs.rename')}</span><span class="v-menu__hint"><kbd class="v-kbd">F2</kbd></span>
    </button>
    <button class="v-menu__item" role="menuitem" aria-disabled={!tabs.canCreate} onclick={() => tabs.canCreate && menuAction(duplicate)}>
      <span class="v-menu__label">{t('tabs.duplicate')}</span>
    </button>
    <div class="v-menu__sep" role="separator"></div>
    <button class="v-menu__item" role="menuitem" onclick={() => menuAction(closeTab)}>
      <span class="v-menu__label">{t('tabs.close')}</span><span class="v-menu__hint"><kbd class="v-kbd">Alt</kbd><kbd class="v-kbd">W</kbd></span>
    </button>
    <button class="v-menu__item" role="menuitem" aria-disabled={tabs.list.length < 2} onclick={() => tabs.list.length > 1 && menuAction(closeOthers)}>
      <span class="v-menu__label">{t('tabs.closeOthers')}</span>
    </button>
    <button class="v-menu__item" role="menuitem" aria-disabled={menuIndex >= tabs.list.length - 1} onclick={() => menuIndex < tabs.list.length - 1 && menuAction(closeRight)}>
      <span class="v-menu__label">{t('tabs.closeRight')}</span>
    </button>
  </div>
{/if}

<style>
  .tabs-bar {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    min-height: 34px;
    padding: 0 8px 0 4px;
    border-bottom: 1px solid var(--sp-border);
    background: var(--sp-bg-subtle);
  }
  .list {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
    padding-top: 4px;
  }
  .tab {
    position: relative;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    max-width: 240px;
    height: 30px;
    border: 1px solid transparent;
    border-bottom: 0;
    border-radius: var(--sp-radius) var(--sp-radius) 0 0;
    color: var(--sp-text-secondary);
  }
  .tab:hover {
    background: var(--sp-bg-muted);
    color: var(--sp-text-primary);
  }
  .tab.selected {
    background: var(--sp-bg);
    border-color: var(--sp-border);
    color: var(--sp-text-primary);
    margin-bottom: -1px;
    height: 31px;
  }
  .tab.dragging {
    opacity: 0.5;
  }
  .tab.drop-before::before,
  .tab.drop-after::after {
    content: '';
    position: absolute;
    top: 4px;
    bottom: 4px;
    width: 2px;
    background: var(--sp-focus);
  }
  .tab.drop-before::before {
    left: -2px;
  }
  .tab.drop-after::after {
    right: -2px;
  }
  .tab-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 100%;
    padding: 0 4px 0 10px;
    border: 0;
    background: none;
    color: inherit;
    font-size: 12.5px;
    cursor: pointer;
    border-radius: var(--sp-radius) 0 0 0;
  }
  .tab-btn:focus-visible {
    outline: 2px solid var(--sp-focus);
    outline-offset: -2px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name.manual {
    font-weight: 500;
  }
  .db {
    flex-shrink: 0;
    font-family: var(--sp-font-mono);
    font-size: 11px;
    color: var(--sp-text-tertiary);
  }
  .dot {
    flex-shrink: 0;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }
  .dot.dirty {
    background: var(--sp-text-secondary);
  }
  .dot.error {
    background: var(--sp-danger);
  }
  .spin {
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    border: 1.5px solid var(--sp-border-hover);
    border-top-color: var(--sp-text-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .close {
    position: relative;
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    margin-right: 6px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--sp-text-tertiary);
    cursor: pointer;
    opacity: 0;
  }
  .tab:hover .close,
  .tab.selected .close {
    opacity: 1;
  }
  .close:hover {
    background: var(--sp-bg-muted);
    color: var(--sp-text-primary);
  }
  .rename {
    width: 180px;
    height: 24px;
    margin: 0 6px;
    padding: 0 6px;
    border: 1px solid var(--sp-focus);
    border-radius: 4px;
    background: var(--sp-bg);
    font-size: 12.5px;
  }
  .rename:focus {
    outline: none;
  }
  .add {
    position: relative;
    flex-shrink: 0;
    margin: 0 0 2px 4px;
  }
  /* Tooltip with keyboard hints (spider-ui has none yet; see docs/spider-ui-gaps.md). */
  .tip {
    position: fixed;
    z-index: 40;
    display: none;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    padding: 5px 8px;
    border: 1px solid var(--sp-border);
    border-radius: var(--sp-radius);
    background: var(--sp-bg);
    box-shadow: var(--sp-shadow-md);
    color: var(--sp-text-primary);
    font-size: 12px;
    font-weight: 400;
    white-space: nowrap;
    pointer-events: none;
    translate: 0 calc(100% + 4px);
  }
  .tab-btn:hover .tip,
  .tab-btn:focus-visible .tip,
  .close:hover .tip,
  .add:hover .tip,
  .add:focus-visible .tip {
    display: inline-flex;
  }
  .menu-open .tip {
    display: none !important;
  }
  .keys {
    display: inline-flex;
    gap: 2px;
    margin-left: 4px;
  }
  .ctx {
    position: fixed;
    z-index: 50;
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation-duration: 2.4s;
    }
  }
</style>
