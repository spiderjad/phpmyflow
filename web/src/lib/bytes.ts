// Human-readable sizes, locale-aware ("1,5 MB" in es/it/fr, "1.5 MB" in en).
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number | null | undefined, locale: string): string {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const scaled = value / 1024 ** i;
  const digits = i === 0 || scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(scaled)} ${UNITS[i]}`;
}
