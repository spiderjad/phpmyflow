# spider-ui gaps

Things phpMyFlow needs that are generic enough to belong in
[spider-ui](https://github.com/spiderjad/spider-ui) rather than in
`web/src/styles/app.css`. Until they land upstream, phpMyFlow keeps a local
version and this list says where.

Checked against spider-ui `cc6c9ba` (version 1.4.0).

## Landed in spider-ui 1.4.0

phpMyFlow's look moved upstream as `data.css` (apps de datos) and `themes.css`:

| Was a gap | Upstream now | phpMyFlow |
|---|---|---|
| Sidebar object list | app frame menu (`shell.css`: `v-sidebar__panel`, `__row` + `v-mark`, `__search`, `__add`, `__section`, `__group`, `v-nav-item--compact`, `__foot` + `v-avatar`) | `Sidebar.svelte` uses it (not `v-explorer`); still local (`pmf-*`): an input inside `v-sidebar__search`, the number at the right of a `v-nav-item`, the count in a `v-sidebar__group`, the pin button, the current row in the theme accent instead of violet |
| Bulk actions with nothing selected | `v-selectionbar` (+ `--idle` hint) | `DbOverview.svelte` uses it |
| Compact table | `v-grid` (sticky header, mono cells, `v-grid__num`, `aria-sort` arrows, `--sp-row-dense`) | `table.grid` in `app.css` and `DataGrid` still local |
| View tabs | `v-appbar` + `v-tabs` (underline) | top bar in `App.svelte` still local (same look) |
| Switch | `v-switch` | `structure/Switch.svelte` still local (same look) |
| Segmented control with radio semantics | `v-segmented__item[aria-checked]` styled | `ui/Segmented.svelte` keeps the keyboard handling |
| Multiple themes, radius scale, density attribute | `themes.css`: `data-theme`, `data-radius`, `data-density` | `styles/themes/*.css` still local (same values; `lib/theme.test.ts` reads them) |
| Mode attribute, mode scope | `data-mode`, `data-mode-scope` in `tokens.css` | `themes/modes.css` repeats them (harmless) |
| Tertiary text AA | `--sp-text-tertiary` #737373 / #8a8a8a | same values |
| Pre-paint script | documented in GUIDE.md (section 5) | `web/index.html` |

## Tokens

| Gap | Why | Local workaround |
|---|---|---|
| Bundled monospace font | `--sp-font-mono` is a system stack only. Code editors and data grids look different on every OS (Consolas, Menlo…). A `@fontsource` mono font could be optional, like Inter. | phpMyFlow uses `--sp-font-mono` as is. |
| Selection / highlight tokens | Data grids need "selected cell", "selected range" and "focused cell" colors that work in both themes. `--sp-primary-light` is brand violet, which phpMyFlow reserves for the assistant. | None yet; needed for grid selection. |
| Warning text vs. icon | `--sp-warning` is used both as text color (`#92400e` light) and as fill. Danger has a separate `--sp-danger-text`; warning does not. | Uses `--sp-warning` for text. |
| Toast colors | No toast component; error toasts reuse the danger banner tokens. | `.toast` in `App.svelte`. |

## Components

| Gap | Why | Local workaround |
|---|---|---|
| `v-badge` sizes | Only one size; inline badges inside dense grid rows need a smaller variant. | — |
| Tooltip | Truncated names, raw values behind formatted dates, shortcut hints. | Native `title` attribute. |
| Split pane / resizer | Resizable sidebar, editor/results split. | — |
| Toast / snackbar with action | "Tab closed · Undo", "12 rows copied". | `.toast` in `App.svelte`. |
| Tabs (closable, scrollable) | `v-segmented` covers short view switchers, not document tabs with close buttons and overflow. | — |
| Context menu | `v-menu` exists but nothing positions it at the pointer or handles submenus. | — |
| Status bar | Bottom bar with counts and aggregates (sum, avg…). | — |

## Package metadata

- `package.json` says `"license": "UNLICENSED"` and `"private": true`, but the
  repo is public and phpMyFlow (open source) bundles its CSS into the release.
  spider-ui needs a license compatible with phpMyFlow's before phpMyFlow ships.

## Added for the Monitor

| Gap | Why | Local workaround |
|---|---|---|
| Chart palette tokens | Categorical series colors that avoid the semantic ones (danger, warning, success) and the AI violet, in both themes. | `--chart-1..5`, `--chart-grid` in `app.css`. |
| Metric card | Label, big value, sub-line and a warn/crit state (border + icon + text). | `.card` in `monitor/LivePanel.svelte`. |
| Chart frame | Card with title, "view as table" toggle, text summary and threshold state. | `monitor/Chart.svelte` (uPlot). |
| Drawer | Side panel for details (peak, review changes). | `.drawer` in `monitor/HistoryPanel.svelte`. |
| Copyable code block | Command or GRANT with a Copy button. | `monitor/MissingPrivilege.svelte`. |

## Added for the structure editor

| Gap | Why | Local workaround |
|---|---|---|
| Popover | Anchored panel with focus trap and Escape (type picker, default value, table chips). | `structure/Popover.svelte` + `lib/focusTrap.ts`. |
| Drawer | Modal side panel with focus trap (review changes, advanced options, foreign key). | `structure/Drawer.svelte`. |
| Editable chip | Chip that opens a choice or turns into an input (default value, ENUM values). | `structure/DefaultChip.svelte`, chips in `TypePopover.svelte`. |
| Change marks | Row edge colors for new / modified / dropped. | `.col-row.new/.modified/.dropped` in `StructureView.svelte`. |

## Added for indexes and native-select removal

| Gap | Why | Local workaround |
|---|---|---|
| Custom select (listbox) | No native `<select>` in the Structure tab: options need tooltips with reasons, disabled-with-reason entries and a search box for long lists (collations). | `ui/Select.svelte` (button + `role="listbox"`, `aria-activedescendant`, type-ahead). |
| Reorderable list | Ordered selection (index columns) reordered by drag or Alt+↑/↓ with position numbers. | `.selected` list in `structure/IndexForm.svelte`. |
| Key badge | Small badge with position ("UNI 2/3"), overflow "+N" and a pending (green) state. | `.key` in `StructureView.svelte`. |

## Added for themes (appearance settings)

| Gap | Why | Local workaround |
|---|---|---|
| Custom accent | Users pick an accent (8 swatches or any color). The package needs the derivation rules: hover, text on the accent (white or black by contrast), focus ring. | `accentVars()` in `lib/theme.ts`. |
| 8-color palette | Named colors (red, orange, amber, green, teal, blue, violet, pink) with AA values per mode, for accents, connection colors and tags. | `PALETTE` in `lib/theme.ts`. |
| Pre-paint script | Apps that store the theme in `localStorage` need a tiny inline script to set the attributes before paint (no flash). | `web/index.html`. |
| Role tokens per theme | A theme that only changes greys and the button color is hard to tell apart. Each theme also needs tokens for the regions: sidebar (bg, text, muted, hover, border, active bg/text/indicator, accent, focus, an optional gradient), top bar (bg, text, muted, hover, border, active tab indicator, "dark bar" flag), grid (header bg/text, zebra, hover, selected, cell focus), chips, key badges, three surfaces, focus ring (+ halo for high contrast) and SQL syntax. | `styles/themes/*.css` (defaults in `modes.css`); the frame classes read them by remapping `--sp-*` inside `.side` and the top bar. Candidate for spider-ui `themes.css`. |

## Added for the login screen

| Gap | Why | Local workaround |
|---|---|---|
| Auth tokens flip in dark mode | `auth.css` reads `--sp-primary` and `--sp-success`, which change in dark mode, so the button and success text lose contrast on the white card. The guide says auth screens look the same in both modes. | `data-mode-scope="light"` on `.auth-page` re-applies the light tokens to that subtree (`themes/modes.css`) and `Login.svelte` re-reads `--auth-*` there. |
| Auth surface token | The card, inputs and modal use a literal `#fff`; components inside the card (popup lists) have no token for that surface. | `.lg-sp-list` uses `var(--auth-bg, #fff)`. |
| On-dark text tokens | Controls placed on the dark background (language, theme switch) only have `.auth-footer`'s literal `rgba(255,255,255,.7)`. | `--lg-on-dark` derived from `--auth-border`. |
| Grouped select (auth) | A listbox with groups, color dots and a trailing "Other…" entry, in the auth look. | `components/login/ServerPicker.svelte`. |
| Recent-account cards | Small cards that fill a sign-in form, with a "forget" button (common in multi-account tools). | `.lg-rc` in `Login.svelte`. |
| Theme switch (light / dark / system) | Three-icon radiogroup, usable on light and dark backgrounds. | `.lg-modes` in `Login.svelte`. |

## Added for the Settings screen

| Gap | Why | Local workaround |
|---|---|---|
| Settings layout | Full-height dialog with section navigation, per-section reset and an optional preview column. | `components/settings/SettingsDialog.svelte`. |
| Theme cards | Radio cards with a live thumbnail of each theme in light and dark. Needs themes as scoped token sets (`data-preview-theme` + `data-mode-scope`). | `settings/ThemeCards.svelte`, selectors in `styles/themes/*.css`. |
| Color picker | Swatch radiogroup (8 colors + "theme" + custom) with an AA warning. | `settings/AccentPicker.svelte`. |
| Environment label and stripe | "PRODUCTION" style label next to the user and a thin colored stripe on top; the label must always come with the color. | `.env-tag`, `.conn-stripe` in `App.svelte`. |

## Added for export / import jobs

| Gap | Why | Local workaround |
|---|---|---|
| File drop zone | Drag and drop or browse, with name, size and the type detected from the content; keyboard reachable. | `components/ui/FileDrop.svelte`. |
| Progress panel | Long job with real percentage, counters, a log, a "looks stopped" state with actions, and a minimized bottom bar. | `components/db/JobProgress.svelte`. |

## Added for the public website (site/)

The website uses `tokens.css` + `panel.css` (`v-btn-*`, `v-btn-ghost`,
`v-btn-icon`, `v-card`, `v-table`, `v-segmented`, `v-menu`, `v-badge`,
`v-banner`). spider-ui has no marketing layer yet; these pieces live in
`site/src/styles/site.css` with the `ws-` prefix.

| Gap | Why | Local workaround |
|---|---|---|
| Marketing type scale | Eyebrow (small caps label), display heading (~72 px, tight tracking), section heading and lead paragraph. `v-page-title` (24 px) is an app title. | `.ws-eyebrow`, `.ws-hero__title`, `.ws-h2`, `.ws-intro`. |
| Large and pill buttons | Hero calls to action are bigger and rounder than panel buttons (`v-btn--sm` is the only size modifier). | `.ws-btn-lg`, `.ws-pill` on `v-btn-primary` / `v-btn-secondary`. |
| Page container and section bands | Centered max-width container with responsive gutters; alternating subtle bands between sections. | `.ws-wrap`, `.ws-section`, `.ws-section--subtle`. |
| Site header and footer | Sticky translucent header with nav, language and CTA collapsing to a menu; footer with link columns. | `components/Header.astro`, `Footer.astro`. |
| Feature card with icon tile | Card with a small bordered icon square, title and text, in a 1/2/3 column grid. | `.ws-feature`, `.ws-feature__icon`. |
| Comparison marks | Yes / partly / no in tables with icon + text (never color alone) and a note. | `.ws-mark--yes/partial/no`. |
| Copyable code block | Same need as the Monitor's GRANT block: command with a Copy button and a polite live announcement. | `components/CodeBlock.astro`. |
| Link menu (disclosure) | `v-menu` is documented as `role="menu"` (actions); a language picker needs a list of links in a disclosure, without menu semantics. | `v-menu` + `v-menu__item` on links inside `<details>` (`LanguagePicker.astro`). |
| FAQ accordion | `<details>` list with dividers and a rotating chevron (reduced motion respected). | `.ws-faq`. |
| Screenshot frame | Bordered, rounded image frame with shadow, swapping light/dark images with the system. | `.ws-frame` + `components/Shot.astro`. |
| Token values outside CSS | `<meta name="theme-color">` needs literal colors; there is no exported list (JSON/TS) of the token values. | The `--sp-bg` values (`#ffffff` / `#0a0a0a`) are repeated in `Base.astro`. |
| Theme toggle for marketing pages | The app has a light/dark/system switch; a static site that swaps `<picture>` sources by `prefers-color-scheme` cannot follow a manual `data-theme`. A shared pattern (and image strategy) would help. | The site follows the system only. |
