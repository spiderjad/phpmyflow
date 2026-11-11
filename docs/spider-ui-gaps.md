# spider-ui gaps

Things phpMyFlow needs that are generic enough to belong in
[spider-ui](https://github.com/spiderjad/spider-ui) rather than in
`web/src/styles/app.css`. Until they land upstream, phpMyFlow keeps a local
version and this list says where.

Checked against spider-ui `0e6fa6e` (version 1.1.0).

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
| Compact table | `.v-table` is a comfortable admin table (12px cell padding, no sticky header, no column resize). Data-dense apps need a compact variant with sticky header. | `table.grid` in `app.css`. |
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
| Switch | `role="switch"` toggle for booleans in dense rows (Null, Unsigned, AI). | `structure/Switch.svelte`. |
| Drawer | Modal side panel with focus trap (review changes, advanced options, foreign key). | `structure/Drawer.svelte`. |
| Editable chip | Chip that opens a choice or turns into an input (default value, ENUM values). | `structure/DefaultChip.svelte`, chips in `TypePopover.svelte`. |
| Change marks | Row edge colors for new / modified / dropped. | `.col-row.new/.modified/.dropped` in `StructureView.svelte`. |

## Added for indexes and native-select removal

| Gap | Why | Local workaround |
|---|---|---|
| Segmented control with radio semantics | `.v-segmented` only styles `aria-pressed` buttons; a choice of one needs `role="radiogroup"`, arrow keys, and disabled options that stay focusable and say why (`aria-describedby`). | `ui/Segmented.svelte` (also styles `aria-checked`). |
| Custom select (listbox) | No native `<select>` in the Structure tab: options need tooltips with reasons, disabled-with-reason entries and a search box for long lists (collations). | `ui/Select.svelte` (button + `role="listbox"`, `aria-activedescendant`, type-ahead). |
| Reorderable list | Ordered selection (index columns) reordered by drag or Alt+↑/↓ with position numbers. | `.selected` list in `structure/IndexForm.svelte`. |
| Key badge | Small badge with position ("UNI 2/3"), overflow "+N" and a pending (green) state. | `.key` in `StructureView.svelte`. |

## Added for themes (appearance settings)

| Gap | Why | Local workaround |
|---|---|---|
| Multiple themes | spider-ui has one palette (light + dark). phpMyFlow offers Monochrome (= spider-ui), Graphite, Slate, Spider, Forest and High contrast, each a full set of `--sp-*` tokens per mode. These files can move to the package as they are. | `web/src/styles/themes/*.css`, contrast checked by `lib/theme.test.ts`. |
| Mode attribute | spider-ui switches modes with `data-theme="light\|dark"`, which leaves no room for a theme name. Proposal: `data-mode` for light/dark and `data-theme` for the palette. | `themes/modes.css` repeats the spider-ui values keyed on `data-mode` (always resolved, "system" included). |
| Tertiary text AA | `--sp-text-tertiary` (#8f8f8f light, #737373 dark) is 3.3:1. It is documented as placeholder only, but real UIs use it for hints and counts. | Monochrome uses #737373 light / #8a8a8a dark (≥ 4.5:1 on `--sp-bg`). |
| Radius scale | Only `--sp-radius` and `--sp-radius-lg`; no named scale for "sharp / soft / round". | `data-radius` in `themes/modes.css`. |
| Density attribute | No compact / comfortable switch for tables, lists and sidebars. | `data-density` on `<html>`. |
| Custom accent | Users pick an accent (8 swatches or any color). The package needs the derivation rules: hover, text on the accent (white or black by contrast), focus ring. | `accentVars()` in `lib/theme.ts`. |
| 8-color palette | Named colors (red, orange, amber, green, teal, blue, violet, pink) with AA values per mode, for accents, connection colors and tags. | `PALETTE` in `lib/theme.ts`. |
| Pre-paint script | Apps that store the theme in `localStorage` need a tiny inline script to set the attributes before paint (no flash). | `web/index.html`. |

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
| Mode scope | A way to apply light or dark tokens to a subtree (previews, auth screens). | `[data-mode-scope]` in `themes/modes.css`. |

## Added for export / import jobs

| Gap | Why | Local workaround |
|---|---|---|
| File drop zone | Drag and drop or browse, with name, size and the type detected from the content; keyboard reachable. | `components/ui/FileDrop.svelte`. |
| Progress panel | Long job with real percentage, counters, a log, a "looks stopped" state with actions, and a minimized bottom bar. | `components/db/JobProgress.svelte`. |
