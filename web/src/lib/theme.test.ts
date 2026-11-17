/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { accentVars, appearanceToDom, checkAccent, contrast, DEFAULT_APPEARANCE, normalizeAppearance, onColor, PALETTE, THEMES, COLORS } from './theme';

// Tokens straight from the CSS the browser loads.
const files = import.meta.glob('../styles/themes/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
function blocks(file: string): Map<string, Record<string, string>> {
  const css = files[`../styles/themes/${file}`];
  if (!css) throw new Error(`missing ${file}`);
  const out = new Map<string, Record<string, string>>();
  // ":root[...]" possibly followed by more selectors (",\n[data-mode-scope='light']").
  for (const m of css.matchAll(/:root((?:\[[^\]]+\])+)(?:\s*,[^{]*)?\s*\{([^}]*)\}/g)) {
    const vars: Record<string, string> = {};
    for (const v of m[2].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6}|[01])\s*;/g)) vars[v[1]] = v[2];
    out.set(m[1].replace(/['"]/g, ''), vars);
  }
  return out;
}
const base = blocks('modes.css');
function tokens(theme: string, mode: 'light' | 'dark'): Record<string, string> {
  const own = theme === 'monochrome' ? {} : (blocks(`${theme}.css`).get(`[data-theme=${theme}][data-mode=${mode}]`) ?? {});
  return { ...base.get(`[data-mode=${mode}]`)!, ...own };
}

// [foreground, background, minimum]
const PAIRS: [string, string, number][] = [
  ['--sp-text-primary', '--sp-bg', 4.5],
  ['--sp-text-primary', '--sp-bg-subtle', 4.5],
  ['--sp-text-primary', '--sp-bg-muted', 4.5],
  ['--sp-text-secondary', '--sp-bg', 4.5],
  ['--sp-text-secondary', '--sp-bg-subtle', 4.5],
  ['--sp-text-secondary', '--sp-bg-muted', 4.5],
  ['--sp-text-tertiary', '--sp-bg', 4.5],
  ['--sp-on-inverse', '--sp-inverse', 4.5], // primary button text
  ['--sp-on-inverse', '--sp-inverse-hover', 4.5],
  ['--sp-inverse', '--sp-bg', 3], // the button itself (non-text)
  ['--sp-focus', '--sp-bg', 3], // focus outline (non-text)
  ['--sp-on-primary', '--sp-primary', 4.5],
  ['--sp-primary-text', '--sp-primary-light', 4.5],
  ['--sp-danger', '--sp-bg', 4.5],
  ['--sp-danger-text', '--sp-bg', 4.5],
  ['--sp-danger-text', '--sp-danger-light', 4.5],
  ['--sp-success', '--sp-bg', 4.5],
  ['--sp-success', '--sp-success-light', 4.5],
  ['--sp-warning', '--sp-bg', 4.5],
  ['--sp-warning', '--sp-warning-light', 4.5],
  ['--sp-text-primary', '--sp-danger-light', 4.5],
  ['--sp-text-primary', '--sp-warning-light', 4.5],
  ['--sp-text-primary', '--sp-success-light', 4.5],
  // Role tokens (styles/themes/modes.css lists them): sidebar…
  ['--sidebar-text', '--sidebar-bg', 4.5],
  ['--sidebar-text-muted', '--sidebar-bg', 4.5],
  ['--sidebar-text', '--sidebar-hover', 4.5],
  ['--sidebar-text-muted', '--sidebar-hover', 4.5],
  ['--sidebar-active-text', '--sidebar-active-bg', 4.5],
  ['--sidebar-on-accent', '--sidebar-accent', 4.5], // database initial, avatar
  ['--sidebar-accent', '--sidebar-bg', 3],
  ['--sidebar-focus', '--sidebar-bg', 3],
  // …top bar and tabs…
  ['--topbar-text', '--topbar-bg', 4.5],
  ['--topbar-text-muted', '--topbar-bg', 4.5],
  ['--topbar-text', '--topbar-hover', 4.5],
  ['--topbar-text-muted', '--topbar-hover', 4.5],
  ['--tab-active-indicator', '--topbar-bg', 3],
  // …data grid…
  ['--grid-header-text', '--grid-header-bg', 4.5],
  ['--sp-text-secondary', '--grid-header-bg', 4.5],
  ['--sp-text-primary', '--grid-row-alt', 4.5],
  ['--sp-text-primary', '--grid-row-hover', 4.5],
  ['--sp-text-primary', '--grid-row-selected', 4.5],
  ['--sp-text-secondary', '--grid-row-alt', 4.5],
  ['--sp-text-secondary', '--grid-row-selected', 4.5],
  ['--grid-cell-focus', '--sp-bg', 3],
  // …relation chips and key badges (grid header and Structure)…
  ['--chip-text', '--chip-bg', 4.5],
  ['--badge-pk', '--grid-header-bg', 4.5],
  ['--badge-index', '--grid-header-bg', 4.5],
  ['--badge-pk', '--sp-bg', 4.5],
  ['--badge-index', '--sp-bg', 4.5],
  // …surfaces (page, side panels, what floats)…
  ['--sp-text-primary', '--surface-1', 4.5],
  ['--sp-text-primary', '--surface-2', 4.5],
  ['--sp-text-primary', '--surface-3', 4.5],
  ['--sp-text-secondary', '--surface-2', 4.5],
  ['--sp-text-secondary', '--surface-3', 4.5],
  // …and the theme's SQL syntax on the editor background.
  ['--syn-keyword', '--sp-bg', 4.5],
  ['--syn-string', '--sp-bg', 4.5],
  ['--syn-number', '--sp-bg', 4.5],
  ['--syn-comment', '--sp-bg', 4.5],
  ['--syn-type', '--sp-bg', 4.5],
  ['--syn-ident', '--sp-bg', 4.5],
];

describe('every theme passes AA in both modes', () => {
  for (const theme of THEMES) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${theme} / ${mode}`, () => {
        const tk = tokens(theme, mode);
        const failures: string[] = [];
        for (const [fg, bg, min] of PAIRS) {
          expect(tk[fg], `${fg} missing`).toBeTruthy();
          expect(tk[bg], `${bg} missing`).toBeTruthy();
          const r = contrast(tk[fg], tk[bg]);
          if (r < min) failures.push(`${fg} ${tk[fg]} on ${bg} ${tk[bg]}: ${r.toFixed(2)} < ${min}`);
        }
        // Connection colors are shown as text (env label) on the page background, and on the
        // top bar in their dark variant when the theme says the bar is dark (--topbar-dark: 1).
        const topDark = tk['--topbar-dark'] === '1';
        for (const c of COLORS) {
          const r = contrast(PALETTE[c][mode], tk['--sp-bg']);
          if (r < 4.5) failures.push(`palette ${c} ${PALETTE[c][mode]} on --sp-bg: ${r.toFixed(2)}`);
          const onBar = PALETTE[c][topDark ? 'dark' : 'light'];
          const rb = contrast(onBar, tk['--topbar-bg']);
          if (rb < 4.5) failures.push(`palette ${c} ${onBar} on --topbar-bg: ${rb.toFixed(2)}`);
        }
        // Focus ring: 3:1 on the page, or (High contrast) a halo that is 3:1 on the page and around the ring.
        const halo = tk['--focus-halo'];
        if (halo) {
          if (contrast(halo, tk['--sp-bg']) < 3 && contrast(tk['--focus-ring'], tk['--sp-bg']) < 3) failures.push('focus halo on --sp-bg');
          if (contrast(tk['--focus-ring'], halo) < 3) failures.push('focus ring on its halo');
        } else if (contrast(tk['--focus-ring'], tk['--sp-bg']) < 3) failures.push(`--focus-ring on --sp-bg: ${contrast(tk['--focus-ring'], tk['--sp-bg']).toFixed(2)}`);
        expect(failures).toEqual([]);
      });
    }
  }
});

// Themes must be told apart at a glance (a thumbnail): sidebar, its current row, top bar,
// accent and grid header together differ between any two themes of the same mode.
describe('every theme has its own look', () => {
  const SIGNATURE = ['--sidebar-bg', '--sidebar-active-bg', '--topbar-bg', '--sp-inverse', '--grid-header-bg'];
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const dist = (a: string, b: string) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
  for (const mode of ['light', 'dark'] as const) {
    it(mode, () => {
      const close: string[] = [];
      THEMES.forEach((a, i) =>
        THEMES.slice(i + 1).forEach((b) => {
          const [ta, tb] = [tokens(a, mode), tokens(b, mode)];
          const d = SIGNATURE.reduce((sum, k) => sum + dist(ta[k], tb[k]), 0);
          if (d < 150) close.push(`${a} ~ ${b}: ${d.toFixed(0)}`);
        }),
      );
      expect(close).toEqual([]);
    });
  }
});

describe('contrast math', () => {
  it('matches WCAG reference values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
  });
  it('picks the readable text color on an accent', () => {
    expect(onColor('#fde047')).toBe('#000000'); // yellow → black text
    expect(onColor('#1d4ed8')).toBe('#ffffff');
  });
  it('flags an accent that is not AA on the background and still fixes its text', () => {
    const yellow = checkAccent('#fde047', '#ffffff');
    expect(yellow.ok).toBe(false);
    expect(yellow.on).toBe('#000000');
    expect(yellow.onRatio).toBeGreaterThanOrEqual(4.5);
    expect(checkAccent('#1d4ed8', '#ffffff').ok).toBe(true);
    expect(accentVars('#fde047', 'light')['--sp-on-inverse']).toBe('#000000');
  });
});

describe('appearance → <html>', () => {
  it('resolves "system" with the OS preference and sets the four attributes', () => {
    const dark = appearanceToDom({ ...DEFAULT_APPEARANCE, theme: 'slate' }, true);
    expect(dark.attrs).toEqual({ 'data-theme': 'slate', 'data-mode': 'dark', 'data-density': 'compact', 'data-radius': 'soft' });
    expect(appearanceToDom(DEFAULT_APPEARANCE, false).attrs['data-mode']).toBe('light');
    expect(appearanceToDom({ ...DEFAULT_APPEARANCE, mode: 'light' }, true).attrs['data-mode']).toBe('light');
  });
  it('adds accent and text size as inline properties only when set', () => {
    expect(appearanceToDom(DEFAULT_APPEARANCE, false).vars).toEqual({});
    const v = appearanceToDom({ ...DEFAULT_APPEARANCE, accent: '#1d4ed8', fontSize: 16 }, false).vars;
    expect(v['--sp-inverse']).toBe('#1d4ed8');
    expect(v['--sp-on-inverse']).toBe('#ffffff');
    expect(Number(v['--pmf-zoom'])).toBeCloseTo(16 / 14);
  });
  it('normalizes unknown values back to defaults', () => {
    const a = normalizeAppearance({ theme: 'neon', mode: 'dark', accent: 'zzz', fontSize: 99, radius: 'round' });
    expect(a).toEqual({ ...DEFAULT_APPEARANCE, mode: 'dark', radius: 'round' });
    expect(normalizeAppearance({ accent: 'ABCDEF' }).accent).toBe('#abcdef');
  });
});

import { startAppearance } from './theme';
describe('config.php defaults', () => {
  const saved = { ...DEFAULT_APPEARANCE, theme: 'forest' as const };
  it('locked config wins over what the browser saved', () => {
    expect(startAppearance({ theme: 'slate', density: 'comfortable' }, true, saved)).toEqual({ ...DEFAULT_APPEARANCE, theme: 'slate', density: 'comfortable' });
  });
  it('unlocked: the saved choice wins, config is the default for new browsers', () => {
    expect(startAppearance({ theme: 'slate' }, false, saved).theme).toBe('forest');
    expect(startAppearance({ theme: 'slate' }, false, null).theme).toBe('slate');
    expect(startAppearance(undefined, false, null)).toEqual(DEFAULT_APPEARANCE);
  });
});
