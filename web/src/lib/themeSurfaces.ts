// Theme surfaces and accents, per theme and mode: the values in styles/themes/*.css
// that the accent derivation (lib/theme.ts accentRoles) needs. lib/theme.test.ts checks
// that they match the CSS, so change both together.
import type { ThemeId } from './theme';

export interface ThemeSurfaces {
  bg: string;
  text: string;
  textMuted: string;
  sidebarBg: string;
  sidebarText: string;
  topbarBg: string;
  /** The theme's own accent (--sp-inverse): the "A" swatch. */
  accent: string;
}

export const SURFACES: Record<ThemeId, Record<'light' | 'dark', ThemeSurfaces>> = {
  monochrome: {
    light: { bg: '#ffffff', text: '#0a0a0a', textMuted: '#525252', sidebarBg: '#f4f4f4', sidebarText: '#0a0a0a', topbarBg: '#ffffff', accent: '#000000' },
    dark: { bg: '#0a0a0a', text: '#ededed', textMuted: '#a3a3a3', sidebarBg: '#141414', sidebarText: '#ededed', topbarBg: '#0a0a0a', accent: '#ededed' },
  },
  graphite: {
    light: { bg: '#fdfcfb', text: '#1c1917', textMuted: '#57534e', sidebarBg: '#292524', sidebarText: '#f5f5f4', topbarBg: '#fdfcfb', accent: '#b45309' },
    dark: { bg: '#141210', text: '#ece9e4', textMuted: '#b0a99f', sidebarBg: '#0c0a09', sidebarText: '#f5f5f4', topbarBg: '#141210', accent: '#fbbf24' },
  },
  slate: {
    light: { bg: '#ffffff', text: '#0f172a', textMuted: '#475569', sidebarBg: '#1e293b', sidebarText: '#f1f5f9', topbarBg: '#1e293b', accent: '#2f5f8a' },
    dark: { bg: '#0b1120', text: '#e2e8f0', textMuted: '#94a3b8', sidebarBg: '#172133', sidebarText: '#e2e8f0', topbarBg: '#172133', accent: '#7fb2e5' },
  },
  spider: {
    light: { bg: '#ffffff', text: '#140f22', textMuted: '#544a6b', sidebarBg: '#1d1233', sidebarText: '#f3effc', topbarBg: '#ffffff', accent: '#7c3aed' },
    dark: { bg: '#0d0a14', text: '#ece8f5', textMuted: '#aaa1c2', sidebarBg: '#140b26', sidebarText: '#ede9fe', topbarBg: '#0d0a14', accent: '#a78bfa' },
  },
  forest: {
    light: { bg: '#ffffff', text: '#0f1a14', textMuted: '#46594d', sidebarBg: '#0f2a1d', sidebarText: '#ecfdf3', topbarBg: '#ffffff', accent: '#15803d' },
    dark: { bg: '#0a110d', text: '#e4ede7', textMuted: '#a0b5a8', sidebarBg: '#06120b', sidebarText: '#dcfce7', topbarBg: '#0a110d', accent: '#4ade80' },
  },
  contrast: {
    light: { bg: '#ffffff', text: '#000000', textMuted: '#000000', sidebarBg: '#000000', sidebarText: '#ffffff', topbarBg: '#ffffff', accent: '#000000' },
    dark: { bg: '#000000', text: '#ffffff', textMuted: '#ffffff', sidebarBg: '#000000', sidebarText: '#ffffff', topbarBg: '#000000', accent: '#ffffff' },
  },
};
