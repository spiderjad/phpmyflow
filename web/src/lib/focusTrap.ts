// Keep Tab inside a popover/drawer and close it with Escape.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusTrap(node: HTMLElement, onEscape: () => void) {
  const previous = document.activeElement as HTMLElement | null;
  const first = () => node.querySelectorAll<HTMLElement>(FOCUSABLE)[0];
  queueMicrotask(() => (node.querySelector<HTMLElement>('[data-autofocus]') ?? first() ?? node).focus());
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const a = items[0];
    const z = items[items.length - 1];
    if (e.shiftKey && document.activeElement === a) {
      e.preventDefault();
      z.focus();
    } else if (!e.shiftKey && document.activeElement === z) {
      e.preventDefault();
      a.focus();
    }
  }
  node.addEventListener('keydown', key);
  return {
    destroy() {
      node.removeEventListener('keydown', key);
      if (previous && document.contains(previous)) previous.focus();
    },
  };
}
