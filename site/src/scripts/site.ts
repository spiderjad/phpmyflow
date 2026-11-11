// The only script of the site (no trackers, no cookies). Without it the page
// still works: every install panel is visible and commands can be selected.

// ── Install tabs (WAI-ARIA tabs: arrows, Home, End) ──────────────────────────
for (const root of document.querySelectorAll<HTMLElement>('[data-tabs]')) {
  const list = root.querySelector<HTMLElement>('[role="tablist"]');
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls') ?? ''));
  if (!list || !tabs.length) continue;

  const select = (i: number, focus = false) => {
    tabs.forEach((tab, j) => {
      const on = i === j;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panels[j]?.toggleAttribute('hidden', !on);
    });
    if (focus) tabs[i].focus();
  };
  list.hidden = false;
  // With tabs, the panel title repeats the tab: only screen readers keep it.
  root.querySelectorAll('[data-tab-title]').forEach((h) => h.classList.add('ws-sr'));
  select(Math.max(0, tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true')));

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(i));
    tab.addEventListener('keydown', (e) => {
      const n = tabs.length;
      const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      select(to, true);
    });
  });
}

// ── Copy buttons ──────────────────────────────────────────────────────────────
const copyStatus = document.querySelector<HTMLElement>('[data-copy-status]');
if (navigator.clipboard) {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    button.hidden = false;
    const label = button.querySelector('span');
    const original = label?.textContent ?? '';
    let timer: number | undefined;
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy ?? '');
      } catch {
        return; // permission refused: the text can still be selected by hand
      }
      const done = button.dataset.copied ?? '';
      if (label) label.textContent = done;
      if (copyStatus) copyStatus.textContent = done;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (label) label.textContent = original;
        if (copyStatus) copyStatus.textContent = '';
      }, 1600);
    });
  }
}

// ── Disclosures (language, mobile menu): close outside, with Escape, after a link ─
const disclosures = [...document.querySelectorAll<HTMLDetailsElement>('details[data-close-outside]')];
document.addEventListener('click', (e) => {
  const target = e.target instanceof Node ? e.target : null;
  for (const d of disclosures) {
    if (!d.open) continue;
    const insideLink = target instanceof Element && target.closest('a') && d.contains(target);
    if (!target || !d.contains(target) || insideLink) d.open = false;
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const d of disclosures) {
    if (!d.open) continue;
    d.open = false;
    d.querySelector('summary')?.focus();
  }
});
