// App-wide UI services: one confirm dialog and a small toast queue.

type ConfirmFn = (opts: { title: string; body: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;

let confirmImpl: ConfirmFn = async (o) => window.confirm(`${o.title}\n\n${o.body}`);

export function registerConfirm(fn: ConfirmFn) {
  confirmImpl = fn;
}

export const confirmAction: ConfirmFn = (opts) => confirmImpl(opts);

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
  action?: { label: string; run: () => void };
}

export const toasts = $state<Toast[]>([]);
let nextId = 1;

export function dismissToast(id: number) {
  const i = toasts.findIndex((x) => x.id === id);
  if (i !== -1) toasts.splice(i, 1);
}

export function toast(text: string, kind: Toast['kind'] = 'info', ms = 3500, action?: Toast['action']) {
  const id = nextId++;
  toasts.push({ id, kind, text, action });
  setTimeout(() => dismissToast(id), ms);
  return id;
}
