<script lang="ts">
  // Small static diagram: tables that point here on the left, this table in
  // the middle, tables it points to on the right. Solid = declared, dashed = inferred.
  import { t } from '../../lib/i18n.svelte';

  export interface MiniEdge {
    table: string;
    kind: 'declared' | 'inferred';
  }

  let { table, incoming, outgoing, onopen }: { table: string; incoming: MiniEdge[]; outgoing: MiniEdge[]; onopen: (t: string) => void } = $props();

  const W = 360;
  const ROW = 26;
  const BOX_W = 104;
  const maxRows = $derived(Math.max(1, Math.min(8, Math.max(incoming.length, outgoing.length))));
  const H = $derived(maxRows * ROW + 16);
  const cy = $derived(H / 2);
  const y = (i: number, len: number) => H / 2 + (i - (Math.min(len, 8) - 1) / 2) * ROW;
  const short = (s: string) => (s.length > 14 ? s.slice(0, 13) + '…' : s);
</script>

<svg width="100%" viewBox="0 0 {W} {H}" role="img" aria-label={t('editor.rel.diagram', { table })}>
  {#each incoming.slice(0, 8) as e, i}
    <line x1={BOX_W} y1={y(i, incoming.length)} x2={W / 2 - 48} y2={cy} stroke="var(--sp-text-tertiary)" stroke-dasharray={e.kind === 'inferred' ? '4 3' : undefined} />
    <g class="node" onclick={() => onopen(e.table)} role="presentation"><text x={BOX_W - 4} y={y(i, incoming.length) + 4} text-anchor="end" font-size="11" fill="var(--sp-text-secondary)" font-family="var(--sp-font-mono)">{short(e.table)}</text></g>
  {/each}
  {#each outgoing.slice(0, 8) as e, i}
    <line x1={W / 2 + 48} y1={cy} x2={W - BOX_W} y2={y(i, outgoing.length)} stroke="var(--sp-text-tertiary)" stroke-dasharray={e.kind === 'inferred' ? '4 3' : undefined} />
    <g class="node" onclick={() => onopen(e.table)} role="presentation"><text x={W - BOX_W + 4} y={y(i, outgoing.length) + 4} font-size="11" fill="var(--sp-text-secondary)" font-family="var(--sp-font-mono)">{short(e.table)}</text></g>
  {/each}
  <rect x={W / 2 - 48} y={cy - 12} width="96" height="24" rx="5" fill="var(--sp-inverse)" />
  <text x={W / 2} y={cy + 4} text-anchor="middle" font-size="11.5" font-weight="600" fill="var(--sp-on-inverse)" font-family="var(--sp-font-mono)">{short(table)}</text>
</svg>

<style>
  svg {
    max-width: 420px;
  }
  .node {
    cursor: pointer;
  }
  .node:hover text {
    fill: var(--sp-text-primary);
    text-decoration: underline;
  }
</style>
