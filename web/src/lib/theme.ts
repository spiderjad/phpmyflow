// Themes: attributes on <html> (data-theme, data-mode, data-density,
// data-radius) select token sets in styles/themes/*.css. The theme owns the
// surfaces (sidebar, top bar, grid header, --surface-*); the accent owns what
// signals or is chosen (buttons, focus, active tab, current sidebar row,
// selected grid row, chips). A custom accent derives those tokens here
// (accentRoles, readable on the theme's surfaces) and sets them inline, with
// the text size. Everything applied here is also mirrored to localStorage
// 'pmf_appearance', which the inline script in index.html reads before the
// first paint (no flash of the default theme or accent).
import { SURFACES, type ThemeSurfaces } from './themeSurfaces';

export const THEMES = ['monochrome', 'graphite', 'slate', 'spider', 'forest', 'contrast'] as const;
export type ThemeId = (typeof THEMES)[number];
export type Mode = 'light' | 'dark' | 'system';
export type Density = 'compact' | 'comfortable';
export type Radius = 'sharp' | 'soft' | 'round';
export const FONT_SIZES = [13, 14, 15, 16] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export interface Appearance {
  mode: Mode;
  theme: ThemeId;
  /** null = the theme's own accent; a palette color (follows the mode) or a custom "#rrggbb". */
  accent: string | null;
  density: Density;
  radius: Radius;
  fontSize: FontSize;
}

export const DEFAULT_APPEARANCE: Appearance = { mode: 'system', theme: 'monochrome', accent: null, density: 'compact', radius: 'soft', fontSize: 14 };

/** The 8 system colors: accent swatches and connection colors. One value per mode (AA on that mode's backgrounds). */
export const COLORS = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'] as const;
export type ColorId = (typeof COLORS)[number];
export const PALETTE: Record<ColorId, { light: string; dark: string }> = {
  red: { light: '#c62828', dark: '#f87171' },
  orange: { light: '#c2410c', dark: '#fb923c' },
  amber: { light: '#a16207', dark: '#fbbf24' },
  green: { light: '#15803d', dark: '#4ade80' },
  teal: { light: '#0f766e', dark: '#2dd4bf' },
  blue: { light: '#1d4ed8', dark: '#60a5fa' },
  violet: { light: '#6d28d9', dark: '#a78bfa' },
  pink: { light: '#be185d', dark: '#f472b6' },
};

// --- color math (WCAG 2.x) ---

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

export function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

/** a mixed with b by t (0..1). */
export function mix(a: string, b: string, t: number): string {
  const p = parseHex(a) ?? [0, 0, 0];
  const q = parseHex(b) ?? [0, 0, 0];
  return toHex(p.map((v, i) => v + (q[i] - v) * t));
}

/** Text color for a fill: white or black, whichever contrasts more. */
export function onColor(fill: string): string {
  return contrast(fill, '#ffffff') >= contrast(fill, '#000000') ? '#ffffff' : '#000000';
}

export interface AccentCheck {
  /** Accent against the page background (buttons, focus ring, links). */
  ratio: number;
  ok: boolean;
  /** Text color used on accent fills (always the better of white/black). */
  on: string;
  onRatio: number;
}

export function checkAccent(accent: string, bg: string): AccentCheck {
  const on = onColor(accent);
  const ratio = contrast(accent, bg);
  return { ratio, ok: ratio >= 4.5, on, onRatio: contrast(accent, on) };
}

/** `color` moved toward black or white (whichever helps on `bg`) until it is `min`:1 on `bg`. */
export function ensureContrast(color: string, bg: string, min: number): string {
  if (contrast(color, bg) >= min) return color;
  const toward = luminance(bg) < 0.18 ? '#ffffff' : '#000000';
  for (let i = 1; i <= 20; i++) {
    const c = mix(color, toward, i / 20);
    if (contrast(c, bg) >= min) return c;
  }
  return toward;
}

/** Every token an accent sets (the theme keeps the surfaces). */
export const ACCENT_ROLE_VARS = [
  '--sp-inverse',
  '--sp-inverse-hover',
  '--sp-on-inverse',
  '--sp-focus',
  '--focus-ring',
  '--grid-cell-focus',
  '--tab-active-indicator',
  '--sidebar-active-bg',
  '--sidebar-active-text',
  '--sidebar-active-indicator',
  '--sidebar-accent',
  '--sidebar-on-accent',
  '--sidebar-focus',
  '--grid-row-selected',
  '--chip-bg',
  '--chip-text',
  '--chip-border',
] as const;

/**
 * An accent → the tokens that signal or are chosen, for one theme and mode:
 * the primary button is the accent itself (its text white or black, AA); lines
 * and rings are moved until 3:1 on the surface they sit on; soft fills (current
 * sidebar row, selected grid row, chips) mix the accent into the surface and
 * keep their text at 4.5:1. AA is checked for every theme, mode and color.
 */
export function accentRoles(accent: string, s: ThemeSurfaces, mode: 'light' | 'dark'): Record<string, string> {
  const on = onColor(accent);
  const hover = mix(accent, on === '#ffffff' ? '#000000' : '#ffffff', 0.15);
  const onPage = ensureContrast(accent, s.bg, 3);
  const onSide = ensureContrast(accent, s.sidebarBg, 3);
  const darkSide = luminance(s.sidebarBg) < 0.18;
  const activeBg = mix(s.sidebarBg, accent, darkSide ? 0.32 : 0.16);
  const activeText = ensureContrast(darkSide ? mix(accent, '#ffffff', 0.6) : mix(accent, '#000000', 0.35), activeBg, 4.5);
  let t = mode === 'dark' ? 0.24 : 0.12;
  let selected = mix(s.bg, accent, t);
  while (t > 0.02 && (contrast(s.text, selected) < 4.5 || contrast(s.textMuted, selected) < 4.5)) {
    t -= 0.02;
    selected = mix(s.bg, accent, t);
  }
  const chipBg = mix(s.bg, accent, mode === 'dark' ? 0.18 : 0.1);
  return {
    '--sp-inverse': accent,
    '--sp-inverse-hover': hover,
    '--sp-on-inverse': on,
    '--sp-focus': onPage,
    '--focus-ring': onPage,
    '--grid-cell-focus': onPage,
    '--tab-active-indicator': ensureContrast(accent, s.topbarBg, 3),
    '--sidebar-active-bg': activeBg,
    '--sidebar-active-text': activeText,
    '--sidebar-active-indicator': onSide,
    '--sidebar-accent': onSide,
    '--sidebar-on-accent': onColor(onSide),
    '--sidebar-focus': onSide,
    '--grid-row-selected': selected,
    '--chip-bg': chipBg,
    '--chip-text': ensureContrast(mode === 'dark' ? mix(accent, '#ffffff', 0.45) : mix(accent, '#000000', 0.3), chipBg, 4.5),
    '--chip-border': mix(s.bg, accent, mode === 'dark' ? 0.38 : 0.3),
  };
}

/** The theme's own accent ("A"), per mode. */
export function themeAccent(theme: ThemeId, mode: 'light' | 'dark'): string {
  return SURFACES[theme][mode].accent;
}

// --- applying ---

export function resolveMode(mode: Mode, prefersDark: boolean): 'light' | 'dark' {
  return mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
}

/** Attributes and inline properties for an appearance (pure: tested). */
/** Accent color for a mode: palette colors have a value per mode, custom ones are used as they are. */
export function accentHex(accent: string | null, mode: 'light' | 'dark'): string | null {
  if (!accent) return null;
  if ((COLORS as readonly string[]).includes(accent)) return PALETTE[accent as ColorId][mode];
  return parseHex(accent) ? accent : null;
}

/** The inline tokens of a custom accent for one mode ({} = the theme's own accent). */
export function accentDom(a: Appearance, mode: 'light' | 'dark'): Record<string, string> {
  const hex = accentHex(a.accent, mode);
  return hex ? accentRoles(hex, SURFACES[a.theme][mode], mode) : {};
}

export function appearanceToDom(a: Appearance, prefersDark: boolean): { attrs: Record<string, string>; vars: Record<string, string> } {
  const mode = resolveMode(a.mode, prefersDark);
  const vars: Record<string, string> = accentDom(a, mode);
  if (a.fontSize !== 14) vars['--pmf-zoom'] = String(a.fontSize / 14);
  return { attrs: { 'data-theme': a.theme, 'data-mode': mode, 'data-density': a.density, 'data-radius': a.radius }, vars };
}

const MIRROR_KEY = 'pmf_appearance';
const ACCENT_VARS = [...ACCENT_ROLE_VARS, '--pmf-zoom'];

function prefersDark(): boolean {
  try {
    return matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

let current: Appearance = DEFAULT_APPEARANCE;
let listening = false;

/** Applies an appearance to <html> now and remembers it for the next page load. */
export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement) {
  current = a;
  const { attrs, vars } = appearanceToDom(a, prefersDark());
  for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
  for (const k of ACCENT_VARS) if (!(k in vars)) root.style.removeProperty(k);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  try {
    // varsLight / varsDark: the accent's tokens resolved per mode for the pre-paint script
    // (it has no palette and no color math); accentLight / accentDark kept for older pages.
    localStorage.setItem(
      MIRROR_KEY,
      JSON.stringify({
        theme: a.theme,
        mode: a.mode,
        density: a.density,
        radius: a.radius,
        accent: a.accent,
        accentLight: accentHex(a.accent, 'light'),
        accentDark: accentHex(a.accent, 'dark'),
        varsLight: accentDom(a, 'light'),
        varsDark: accentDom(a, 'dark'),
        fontSize: a.fontSize,
      }),
    );
  } catch {
    /* storage blocked: still applied for this page */
  }
  // "System" follows the OS live.
  if (!listening && typeof matchMedia === 'function') {
    listening = true;
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (current.mode === 'system') applyAppearance(current, root);
    });
  }
}

/** The appearance the pre-paint script used (last applied), or the default. */
export function mirroredAppearance(): Appearance {
  try {
    const v = JSON.parse(localStorage.getItem(MIRROR_KEY) ?? 'null');
    return v ? normalizeAppearance(v) : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/** Keeps only valid values (imported JSON, old storage, config.php defaults). */
export function normalizeAppearance(v: Partial<Record<keyof Appearance, unknown>>, base: Appearance = DEFAULT_APPEARANCE): Appearance {
  const pick = <T>(x: unknown, allowed: readonly T[], d: T): T => (allowed.includes(x as T) ? (x as T) : d);
  return {
    mode: pick(v.mode, ['light', 'dark', 'system'] as const, base.mode),
    theme: pick(v.theme, THEMES, base.theme),
    accent:
      typeof v.accent === 'string' && (COLORS as readonly string[]).includes(v.accent)
        ? v.accent
        : typeof v.accent === 'string' && parseHex(v.accent) && /^#?[0-9a-f]{6}$/i.test(v.accent)
          ? (v.accent.startsWith('#') ? v.accent : '#' + v.accent).toLowerCase()
          : v.accent === null
            ? null
            : base.accent,
    density: pick(v.density, ['compact', 'comfortable'] as const, base.density),
    radius: pick(v.radius, ['sharp', 'soft', 'round'] as const, base.radius),
    fontSize: pick(Number(v.fontSize), FONT_SIZES, base.fontSize),
  };
}

/**
 * Appearance at boot: config.php locked values win; otherwise what this
 * browser used last; otherwise config.php defaults over the built-in ones.
 */
export function startAppearance(ui: Partial<Appearance> | undefined, locked: boolean, saved: Appearance | null): Appearance {
  const cfg = normalizeAppearance(ui ?? {});
  if (locked) return cfg;
  return saved ?? cfg;
}

export function savedAppearance(): Appearance | null {
  try {
    return localStorage.getItem(MIRROR_KEY) ? mirroredAppearance() : null;
  } catch {
    return null;
  }
}

/** Color of the page background right now (for the accent warning). */
export function currentBg(root: HTMLElement = document.documentElement): string {
  return getComputedStyle(root).getPropertyValue('--sp-bg').trim() || '#ffffff';
}

/** Calls fn when the theme or mode changes (charts and canvases that read tokens). */
export function onThemeChange(fn: () => void): () => void {
  const mo = new MutationObserver(fn);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-mode', 'style'] });
  return () => mo.disconnect();
}
