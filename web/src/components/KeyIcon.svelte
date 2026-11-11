<script lang="ts">
  // One key icon (no interaction: the parent button carries the label and the
  // click). Key shape for indexes (gold for the primary key), solid arrow for a
  // declared FK, dashed arrow for an inferred relation, always with its text.
  import type { KeyKind } from '../lib/keyIcons';
  let { kind, text, wide = false }: { kind: KeyKind; text: string; wide?: boolean } = $props();
</script>

<span class="ki ki-{kind}" class:wide>
  {#if kind === 'fk' || kind === 'inferred'}
    <svg viewBox="0 0 14 10" width="13" height="9" aria-hidden="true">
      <path d="M1 5h10M8 1.5 11.5 5 8 8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray={kind === 'inferred' ? '2 2' : undefined} />
    </svg>
  {:else}
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <circle cx="5" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6" />
      <path d="M8.2 8H15M12.5 8v2.6M14.6 8v2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    </svg>
  {/if}
  <span class="ki-text">{text}</span>
</span>

<style>
  /* Key icons (grid header, Structure Key and References columns). */
  .ki {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10.5px;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    color: var(--sp-text-secondary);
  }
  .ki-pk {
    color: var(--key-pk);
  }
  .ki-fk,
  .ki-inferred {
    font-weight: 500;
  }
  .ki-inferred .ki-text {
    text-decoration: underline dashed;
    text-underline-offset: 2px;
  }
  .wide {
    font-size: 12px;
  }
  .ki:not(.wide) .ki-text {
    max-width: 14ch;
  }
  .ki-text {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
