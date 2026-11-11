// Shape of every language file (en.ts, es.ts…): `astro check` fails if a key is missing.

export type IconName = 'bolt' | 'spark-check' | 'assistant' | 'link' | 'transfer' | 'shield';
export type ShotId = 'grid' | 'sql' | 'structure' | 'relations' | 'export' | 'monitor';
/** A comparison cell: yes / partial / no with an optional note, or plain text. */
export type Cell = { mark: 'yes' | 'partial' | 'no'; note?: string } | { text: string };
export type InstallTab = 'hosting' | 'docker' | 'lan';

export interface Step {
  text: string;
  /** Copyable command(s), one per line. */
  code?: string;
  /** Label of the code block for screen readers ("Command", "Windows (PowerShell)"…). */
  codeLabel?: string;
}

export interface Messages {
  meta: { title: string; description: string; ogImageAlt: string };
  a11y: { skip: string; mainNav: string; mobileNav: string; menu: string; language: string; external: string };
  nav: { features: string; screenshots: string; compare: string; install: string; faq: string };
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    download: string;
    demo: string;
    demoSoon: string;
    github: string;
    status: string;
    shotAlt: string;
  };
  features: { eyebrow: string; title: string; intro: string; items: { icon: IconName; title: string; text: string }[] };
  gallery: { eyebrow: string; title: string; intro: string; items: { id: ShotId; title: string; text: string; alt: string }[] };
  compare: {
    eyebrow: string;
    title: string;
    intro: string;
    caption: string;
    feature: string;
    marks: { yes: string; partial: string; no: string };
    rows: { label: string; cells: [Cell, Cell, Cell] }[];
    footnote: string;
  };
  install: {
    eyebrow: string;
    title: string;
    intro: string;
    tablist: string;
    tabs: { id: InstallTab; label: string; intro: string; steps: Step[]; note?: string }[];
    copy: string;
    copied: string;
  };
  ai: { eyebrow: string; title: string; intro: string; points: { title: string; text: string }[] };
  security: {
    eyebrow: string;
    title: string;
    intro: string;
    points: string[];
    reportTitle: string;
    report: string;
    policy: string;
    email: string;
  };
  faq: { eyebrow: string; title: string; items: { q: string; a: string }[] };
  footer: {
    tagline: string;
    product: string;
    project: string;
    contact: string;
    releases: string;
    security: string;
    madeBy: string;
    license: string;
    licenseTbd: string;
  };
  notFound: { title: string; text: string; back: string };
}
