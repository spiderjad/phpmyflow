<script lang="ts" module>
  export type FileKind = 'sql' | 'gzip' | 'zip' | 'unknown';

  /** What a file is, from its first bytes (not only the extension). */
  export async function detectKind(file: File): Promise<FileKind> {
    const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    if (head[0] === 0x1f && head[1] === 0x8b) return 'gzip';
    if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return 'zip';
    const text = new TextDecoder('utf-8', { fatal: false }).decode(head);
    if (/^﻿?\s*(--|\/\*|#|SET\s|CREATE\s|INSERT\s|DROP\s|USE\s|LOCK\s|START\s)/im.test(text) || /\b(CREATE TABLE|INSERT INTO)\b/i.test(text)) return 'sql';
    return 'unknown';
  }
</script>

<script lang="ts">
  // File picker as a drop zone (spider-ui has none yet: docs/spider-ui-gaps.md).
  // Drag and drop or click / Enter to browse; shows name, size and the type
  // detected from the content. The native input stays in the DOM (hidden) for
  // the system dialog and for tests (setInputFiles).
  import { formatBytes } from '../../lib/bytes';
  import { i18n, t } from '../../lib/i18n.svelte';

  let {
    file,
    kind,
    accept,
    label,
    hint = '',
    invalid = false,
    onfile,
  }: { file: File | null; kind: FileKind | null; accept: string; label: string; hint?: string; invalid?: boolean; onfile: (f: File | null) => void } = $props();

  let over = $state(false);
  let input: HTMLInputElement;
  const id = `fd-${Math.random().toString(36).slice(2, 8)}`;

  function drop(e: DragEvent) {
    e.preventDefault();
    over = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) onfile(f);
  }
</script>

<div
  class="fd"
  class:over
  class:has={!!file}
  class:invalid
  role="group"
  aria-labelledby="{id}-label"
  ondragenter={(e) => {
    e.preventDefault();
    over = true;
  }}
  ondragover={(e) => e.preventDefault()}
  ondragleave={() => (over = false)}
  ondrop={drop}
>
  <input bind:this={input} id="{id}-input" type="file" {accept} hidden onchange={(e) => onfile((e.currentTarget as HTMLInputElement).files?.[0] ?? null)} />
  <svg class="fd-icon" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
  <span class="fd-label" id="{id}-label">{label}</span>
  {#if file}
    <span class="fd-file">
      <strong class="mono">{file.name}</strong>
      <span>{formatBytes(file.size, i18n.locale)}</span>
      {#if kind}<span class="v-badge {kind === 'sql' || kind === 'gzip' ? 'v-badge--success' : 'v-badge--warning'}">{t(`file.kind.${kind}`)}</span>{/if}
    </span>
  {:else}
    <span class="fd-hint">{t('file.drop')}</span>
  {/if}
  <button type="button" class="v-btn-secondary v-btn--sm" onclick={() => input.click()} aria-describedby={hint ? `${id}-hint` : undefined}>
    {file ? t('file.change') : t('file.browse')}
  </button>
  {#if hint}<span class="fd-hint" id="{id}-hint">{hint}</span>{/if}
</div>

<style>
  /* Drop zone (components/ui/FileDrop.svelte). */
  .fd {
    display: grid;
    justify-items: center;
    gap: 6px;
    padding: 18px 16px;
    border: 1.5px dashed var(--sp-border-hover);
    border-radius: var(--sp-radius-lg);
    background: var(--sp-bg-subtle);
    text-align: center;
    transition: border-color 150ms ease, background-color 150ms ease;
  }
  .fd.over {
    border-color: var(--sp-focus);
    background: var(--sp-bg-muted);
  }
  .fd.has {
    border-style: solid;
  }
  .fd.invalid {
    border-color: var(--sp-danger);
  }
  .fd-icon {
    color: var(--sp-text-secondary);
  }
  .fd-label {
    font-weight: 600;
    font-size: 13px;
  }
  .fd-hint {
    font-size: 12px;
    color: var(--sp-text-secondary);
  }
  .fd-file {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    font-size: 12.5px;
  }
  .fd-file strong {
    word-break: break-all;
  }
  @media (prefers-reduced-motion: reduce) {
    .fd {
      transition: none;
    }
  }
</style>
