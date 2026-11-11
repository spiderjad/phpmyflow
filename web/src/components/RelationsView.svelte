<script lang="ts">
  import { untrack } from 'svelte';
  import { api, type Relation } from '../lib/api';
  import { downloadBlob, fileName } from '../lib/clipboard';
  import { n, t } from '../lib/i18n.svelte';
  import { incoming, neighbours, outgoing } from '../lib/relations';
  import { app } from '../lib/state.svelte';
  import { toast } from '../lib/ui.svelte';

  let { table }: { table: string } = $props();

  interface Node {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rows: { name: string; pk: boolean }[];
    center: boolean;
  }
  interface Edge {
    rel: Relation;
    points: { x: number; y: number }[];
  }

  const HEADER = 28;
  const ROW = 19;

  let expanded = $state<Set<string>>(new Set());
  let nodes = $state<Node[]>([]);
  let edges = $state<Edge[]>([]);
  let size = $state({ width: 0, height: 0 });
  let layoutError = $state(false);
  let svg: SVGSVGElement | undefined = $state();
  let box: HTMLDivElement | undefined = $state();
  let view = $state({ x: 0, y: 0, k: 1 });

  const rowsOf = (name: string) => Number(app.tables.find((tb) => tb.name === name)?.approxRows ?? 0);
  const out = $derived(outgoing(app.relations, table));
  const inc = $derived(incoming(app.relations, table));

  // New table: start again with its direct neighbours.
  $effect(() => {
    void table;
    untrack(() => (expanded = new Set()));
  });

  /** Tables shown: the current one, its neighbours, and neighbours of expanded ones. */
  const visible = $derived.by(() => {
    const set = new Set<string>([table, ...neighbours(app.relations, table)]);
    for (const e of expanded) for (const nb of neighbours(app.relations, e)) set.add(nb);
    return set;
  });

  $effect(() => {
    const tables = [...visible];
    const rels = app.relations.filter((r) => visible.has(r.from) && visible.has(r.to));
    layout(tables, rels);
  });

  async function layout(tables: string[], rels: Relation[]) {
    try {
      const mod = await import('@dagrejs/dagre');
      const dagre = (mod as any).default ?? mod;
      const g = new dagre.graphlib.Graph({ multigraph: true });
      g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 70, marginx: 24, marginy: 24 });
      g.setDefaultEdgeLabel(() => ({}));
      const rowsFor = new Map<string, { name: string; pk: boolean }[]>();
      for (const name of tables) {
        const info = app.schema[name];
        const used = new Set(rels.flatMap((r) => [r.from === name ? r.column : '', r.to === name ? r.toColumn : '']).filter(Boolean));
        const cols = (info?.columns ?? []).filter((c) => c.key === 'PRI' || used.has(c.name)).map((c) => ({ name: c.name, pk: c.key === 'PRI' }));
        rowsFor.set(name, cols);
        const width = Math.max(150, Math.min(300, Math.max(name.length * 7.6 + 48, ...cols.map((c) => c.name.length * 7 + 40))));
        g.setNode(name, { width, height: HEADER + Math.max(1, cols.length) * ROW + 6 });
      }
      rels.forEach((r, i) => g.setEdge(r.from, r.to, {}, `e${i}`));
      dagre.layout(g);
      nodes = tables.map((name) => {
        const nd = g.node(name);
        return { id: name, x: nd.x - nd.width / 2, y: nd.y - nd.height / 2, width: nd.width, height: nd.height, rows: rowsFor.get(name) ?? [], center: name === table };
      });
      edges = rels.map((r, i) => ({ rel: r, points: g.edge(r.from, r.to, `e${i}`)?.points ?? [] }));
      const gg = g.graph();
      size = { width: gg.width ?? 0, height: gg.height ?? 0 };
      layoutError = false;
      center();
    } catch {
      layoutError = true;
    }
  }

  // --- pan & zoom ---
  function center() {
    const w = box?.clientWidth ?? 800;
    const h = box?.clientHeight ?? 420;
    const k = Math.min(1.25, Math.max(0.2, Math.min(w / (size.width || 1), h / (size.height || 1)) * 0.95));
    view = { k, x: (w - size.width * k) / 2, y: (h - size.height * k) / 2 };
  }
  function zoom(factor: number, cx = (box?.clientWidth ?? 0) / 2, cy = (box?.clientHeight ?? 0) / 2) {
    const k = Math.min(3, Math.max(0.15, view.k * factor));
    view = { k, x: cx - ((cx - view.x) * k) / view.k, y: cy - ((cy - view.y) * k) / view.k };
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = box!.getBoundingClientRect();
    zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
  }
  let drag: { x: number; y: number; vx: number; vy: number } | null = null;
  function down(e: PointerEvent) {
    if ((e.target as Element).closest('.node')) return;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (drag) view = { ...view, x: drag.vx + e.clientX - drag.x, y: drag.vy + e.clientY - drag.y };
  }
  function up() {
    drag = null;
  }
  function boxKey(e: KeyboardEvent) {
    const step = 40;
    if (e.key === '+' || e.key === '=') zoom(1.2);
    else if (e.key === '-') zoom(1 / 1.2);
    else if (e.key === '0') center();
    else if (e.key === 'ArrowLeft') view = { ...view, x: view.x + step };
    else if (e.key === 'ArrowRight') view = { ...view, x: view.x - step };
    else if (e.key === 'ArrowUp') view = { ...view, y: view.y + step };
    else if (e.key === 'ArrowDown') view = { ...view, y: view.y - step };
    else return;
    e.preventDefault();
  }

  function go(name: string) {
    if (name !== table) app.table = name;
  }
  function toggle(name: string) {
    const next = new Set(expanded);
    next.has(name) ? next.delete(name) : next.add(name);
    expanded = next;
  }
  const canExpand = (name: string) => name !== table && neighbours(app.relations, name).some((nb) => !visible.has(nb) || expanded.has(name));

  function path(points: { x: number; y: number }[]): string {
    if (!points.length) return '';
    let d = `M${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i];
      const q = points[i + 1];
      d += ` Q${p.x},${p.y} ${(p.x + q.x) / 2},${(p.y + q.y) / 2}`;
    }
    const last = points[points.length - 1];
    return d + ` L${last.x},${last.y}`;
  }

  // --- export: resolve CSS variables so the file looks the same outside the app ---
  function exportMarkup(): string {
    const clone = svg!.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(Math.ceil(size.width)));
    clone.setAttribute('height', String(Math.ceil(size.height)));
    clone.setAttribute('viewBox', `0 0 ${Math.ceil(size.width)} ${Math.ceil(size.height)}`);
    clone.querySelector('.viewport')?.removeAttribute('transform');
    const css = getComputedStyle(document.documentElement);
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', '100%');
    bg.setAttribute('height', '100%');
    bg.setAttribute('fill', 'var(--sp-bg)');
    clone.insertBefore(bg, clone.firstChild);
    let markup = new XMLSerializer().serializeToString(clone);
    markup = markup.replace(/var\((--[\w-]+)\)/g, (_, name) => css.getPropertyValue(name).trim() || '#888');
    const font = css.getPropertyValue('--sp-font').trim().replace(/"/g, "'");
    return markup.replace('<svg', `<svg font-family="${font}"`);
  }
  function exportSvg() {
    downloadBlob(new Blob([exportMarkup()], { type: 'image/svg+xml' }), fileName(`${table}-relations`, 'svg'));
  }
  function exportPng() {
    const url = URL.createObjectURL(new Blob([exportMarkup()], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(size.width * scale);
      canvas.height = Math.ceil(size.height * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? downloadBlob(blob, fileName(`${table}-relations`, 'png')) : toast(t('export.failed'), 'error')), 'image/png');
    };
    img.onerror = () => toast(t('export.failed'), 'error');
    img.src = url;
  }

  // Polymorphic pairs of this table (itemtype + items_id): shown, never offered as a FK.
  const poly = $derived(app.polymorphic.filter((p) => p.table === table));
  let polyTypes = $state<Record<string, { types: string[]; more: boolean } | 'error'>>({});
  $effect(() => {
    const db = app.db;
    const pairs = poly;
    untrack(() => (polyTypes = {}));
    for (const p of pairs) {
      api
        .polyTypes(db, p.table, p.typeColumn)
        .then((r) => (polyTypes = { ...polyTypes, [p.typeColumn]: r }))
        .catch(() => (polyTypes = { ...polyTypes, [p.typeColumn]: 'error' }));
    }
  });
</script>

<section class="view">
  <div class="v-toolbar v-toolbar--sub bar" role="toolbar" aria-label={t('relations.toolbar')}>
    <span class="summary">{t('relations.summary', { out: n(out.length), in: n(inc.length) })}</span>
    <span class="v-toolbar__spacer"></span>
    <span class="legend" aria-hidden="true">
      <svg width="28" height="8"><line x1="0" y1="4" x2="28" y2="4" stroke="var(--sp-text-secondary)" stroke-width="1.5" /></svg>
      {t('relations.kind.declared')}
      <svg width="28" height="8"><line x1="0" y1="4" x2="28" y2="4" stroke="var(--sp-text-secondary)" stroke-width="1.5" stroke-dasharray="4 3" /></svg>
      {t('relations.kind.inferred')}
    </span>
    <span class="v-toolbar__sep" aria-hidden="true"></span>
    <button class="v-btn-icon v-btn--sm" onclick={() => zoom(1 / 1.2)} aria-label={t('relations.zoomOut')} title={t('relations.zoomOut')}>−</button>
    <button class="v-btn-icon v-btn--sm" onclick={() => zoom(1.2)} aria-label={t('relations.zoomIn')} title={t('relations.zoomIn')}>+</button>
    <button class="v-btn-ghost v-btn--sm" onclick={center}>{t('relations.center')}</button>
    <span class="v-toolbar__sep" aria-hidden="true"></span>
    <button class="v-btn-ghost v-btn--sm" onclick={exportSvg} disabled={!nodes.length}>{t('relations.exportSvg')}</button>
    <button class="v-btn-ghost v-btn--sm" onclick={exportPng} disabled={!nodes.length}>{t('relations.exportPng')}</button>
  </div>

  <!-- Pan/zoom surface: keyboard and pointer driven, described by #relations-help; the list below is the accessible alternative. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="canvas"
    bind:this={box}
    onwheel={onWheel}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onkeydown={boxKey}
    tabindex="0"
    role="region"
    aria-label={t('relations.diagram', { table })}
    aria-describedby="relations-help"
  >
    <p id="relations-help" class="sr-only">{t('relations.diagramHelp')}</p>
    {#if layoutError}
      <p class="empty">{t('relations.layoutError')}</p>
    {:else if !out.length && !inc.length}
      <p class="empty">{t('relations.none')}</p>
    {/if}
    <svg bind:this={svg} width="100%" height="100%" aria-hidden="true" class:hidden={!out.length && !inc.length}>
      <defs>
        <marker id="rel-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--sp-text-secondary)" />
        </marker>
      </defs>
      <g class="viewport" transform="translate({view.x},{view.y}) scale({view.k})">
        {#each edges as e}
          <path
            d={path(e.points)}
            fill="none"
            stroke="var(--sp-text-secondary)"
            stroke-width="1.4"
            stroke-dasharray={e.rel.kind === 'inferred' ? '5 4' : undefined}
            marker-end="url(#rel-arrow)"
            class="edge {e.rel.kind}"
          ><title>{e.rel.from}.{e.rel.column} → {e.rel.to}.{e.rel.toColumn}</title></path>
        {/each}
        {#each nodes as nd (nd.id)}
          <g
            class="node"
            class:center={nd.center}
            transform="translate({nd.x},{nd.y})"
            ondblclick={() => go(nd.id)}
            role="presentation"
          >
            <rect width={nd.width} height={nd.height} rx="6" fill="var(--sp-bg)" stroke={nd.center ? 'var(--sp-focus)' : 'var(--sp-border-hover)'} stroke-width={nd.center ? 2 : 1} />
            <rect width={nd.width} height={HEADER} rx="6" fill={nd.center ? 'var(--sp-inverse)' : 'var(--sp-bg-muted)'} />
            <rect y={HEADER - 6} width={nd.width} height="6" fill={nd.center ? 'var(--sp-inverse)' : 'var(--sp-bg-muted)'} />
            <text x="10" y="18" font-size="12.5" font-weight="600" fill={nd.center ? 'var(--sp-on-inverse)' : 'var(--sp-text-primary)'}>{nd.id}</text>
            {#if canExpand(nd.id)}
              <g class="toggle" transform="translate({nd.width - 22},6)" onclick={() => toggle(nd.id)} role="presentation">
                <rect width="16" height="16" rx="3" fill="var(--sp-bg)" stroke="var(--sp-border-hover)" />
                <text x="8" y="12" font-size="12" text-anchor="middle" fill="var(--sp-text-primary)">{expanded.has(nd.id) ? '−' : '+'}</text>
              </g>
            {/if}
            {#each nd.rows as r, k}
              <text x="10" y={HEADER + 14 + k * ROW} font-size="11.5" font-family="var(--sp-font-mono)" fill="var(--sp-text-primary)">
                {#if r.pk}<tspan fill="var(--sp-warning)" font-size="9" font-weight="600">PK</tspan><tspan dx="4">{r.name}</tspan>{:else}{r.name}{/if}
              </text>
            {/each}
          </g>
        {/each}
      </g>
    </svg>
  </div>

  <div class="lists">
    <section>
      <h2>{t('relations.outgoing')}</h2>
      {#if out.length}
        <table class="grid list">
          <thead><tr><th>{t('relations.column')}</th><th>{t('relations.target')}</th><th>{t('relations.type')}</th><th class="num">{t('relations.rows')}</th></tr></thead>
          <tbody>
            {#each out as r}
              <tr>
                <td class="mono">{r.column}</td>
                <td><button class="link mono" onclick={() => go(r.to)}>{r.to}</button><span class="dim mono">.{r.toColumn}</span></td>
                <td><span class="v-badge" class:v-badge--brand={false}>{t(`relations.kind.${r.kind}`)}</span></td>
                <td class="num">~{n(rowsOf(r.to))}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="dim">{t('relations.noneOut')}</p>
      {/if}
    </section>
    {#if poly.length}
      <section class="poly" aria-labelledby="poly-title">
        <h2 id="poly-title">{t('relations.poly.title')}</h2>
        <p class="dim help">{t('relations.poly.help')}</p>
        <ul>
          {#each poly as p}
            {@const ty = polyTypes[p.typeColumn]}
            <li>
              <span class="mono">{t('relations.poly.pair', { type: p.typeColumn, id: p.idColumn })}</span>
              <span class="types">
                {#if ty === 'error'}<span class="dim">{t('relations.poly.typesFailed')}</span>
                {:else if !ty}<span class="dim">{t('common.loading')}</span>
                {:else if !ty.types.length}<span class="dim">{t('relations.poly.noTypes')}</span>
                {:else}
                  <span class="dim">{t('relations.poly.types')}</span>
                  {#each ty.types as v}<span class="chip mono">{v}</span>{/each}
                  {#if ty.more}<span class="dim">…</span>{/if}
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    <section>
      <h2>{t('relations.incoming')}</h2>
      {#if inc.length}
        <table class="grid list">
          <thead><tr><th>{t('relations.source')}</th><th>{t('relations.column')}</th><th>{t('relations.type')}</th><th class="num">{t('relations.rows')}</th></tr></thead>
          <tbody>
            {#each inc as r}
              <tr>
                <td><button class="link mono" onclick={() => go(r.from)}>{r.from}</button></td>
                <td class="mono">{r.column} <span class="dim">→ {r.toColumn}</span></td>
                <td><span class="v-badge">{t(`relations.kind.${r.kind}`)}</span></td>
                <td class="num">~{n(rowsOf(r.from))}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="dim">{t('relations.noneIn')}</p>
      {/if}
    </section>
  </div>
</section>

<style>
  .poly ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 8px;
  }
  .poly li {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    font-size: 13px;
  }
  .poly .help {
    margin: 0 0 8px;
    font-size: 12.5px;
  }
  .poly .types {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .chip {
    padding: 1px 6px;
    border: 1px solid var(--sp-border);
    border-radius: 999px;
    background: var(--sp-bg-subtle);
    font-size: 11.5px;
  }
  .view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    min-width: 0;
  }
  .bar {
    flex-wrap: wrap;
    gap: 6px;
    font-size: 13px;
  }
  .summary {
    color: var(--sp-text-secondary);
  }
  .legend {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--sp-text-secondary);
  }
  .canvas {
    position: relative;
    flex: 1 1 55%;
    min-height: 240px;
    overflow: hidden;
    background: var(--sp-bg-subtle);
    border-bottom: 1px solid var(--sp-border);
    cursor: grab;
    touch-action: none;
  }
  .canvas:active {
    cursor: grabbing;
  }
  .canvas:focus-visible {
    outline: 2px solid var(--sp-focus);
    outline-offset: -2px;
  }
  svg.hidden {
    display: none;
  }
  .node {
    cursor: pointer;
  }
  .node text {
    user-select: none;
  }
  .toggle {
    cursor: pointer;
  }
  .edge {
    pointer-events: stroke;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    color: var(--sp-text-tertiary);
  }
  .lists {
    flex: 1 1 45%;
    overflow: auto;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 8px 24px;
    padding: 12px 16px 24px;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 600;
  }
  .list {
    font-family: var(--sp-font);
    font-size: 12.5px;
    width: 100%;
  }
  .list td.num,
  .list th.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .link {
    border: 0;
    padding: 0;
    background: none;
    color: var(--sp-text-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .dim {
    color: var(--sp-text-tertiary);
  }
  p.dim {
    margin: 0;
    font-size: 12.5px;
  }
</style>
