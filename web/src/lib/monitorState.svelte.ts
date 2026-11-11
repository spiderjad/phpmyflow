// Shared monitor state: polling interval, live buffer, alert levels (for
// the badge on the Monitor tab) and display options. Polling only runs
// while the Monitor view is mounted (start/stop).
import { monitorApi, type LiveSample, type MonitorCaps } from './api';
import { adaptInterval, levels, rates, RingBuffer, type Level, type Raw, type Rates } from './monitor';

export const INTERVALS = [1, 2, 5, 10] as const;

export const mon = $state({
  caps: null as MonitorCaps | null,
  interval: 2 as number,
  paused: false,
  /** Bumped on every sample so charts re-render. */
  tick: 0,
  last: null as LiveSample | null,
  rates: null as Rates | null,
  levels: {} as Record<string, Level>,
  /** Set when a slow monitoring query raised the interval. */
  slowNotice: null as { ms: number; interval: number } | null,
  error: '' as string,
  hideLiterals: true,
  longQuerySeconds: 10,
  hideIdle: true,
});

export const buffer = new RingBuffer(900);
let prevRaw: Raw | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

/** Alerts for the tab badge: number of metrics at warn or crit. */
export function alertCount(): { warn: number; crit: number } {
  const v = Object.values(mon.levels);
  return { warn: v.filter((l) => l === 'warn').length, crit: v.filter((l) => l === 'crit').length };
}

async function poll() {
  if (!running) return;
  if (!mon.paused) {
    try {
      const s = await monitorApi.live();
      mon.error = '';
      if (!s.cached) {
        mon.last = s;
        const raw = s.status as Raw;
        if (prevRaw) {
          const r = rates(prevRaw, raw);
          if (r) {
            buffer.push(Number(raw._t), r);
            mon.rates = r;
            if (mon.caps) mon.levels = levels(r, mon.caps.thresholds);
          } else buffer.clear(); // server restarted: start the charts again
        }
        prevRaw = raw;
        mon.tick++;
        // Monitoring must not load the server: back off when queries get slow.
        const next = adaptInterval(mon.interval, s.ms);
        if (next !== mon.interval) {
          mon.slowNotice = { ms: s.ms, interval: next };
          mon.interval = next;
        }
      }
    } catch (err) {
      mon.error = err instanceof Error ? err.message : String(err);
    }
  }
  if (running) timer = setTimeout(poll, mon.interval * 1000);
}

export function startMonitor() {
  if (running) return;
  running = true;
  poll();
}

export function stopMonitor() {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

/** New interval: restart the wait so the change shows at once. */
export function setInterval_(seconds: number) {
  mon.interval = seconds;
  mon.slowNotice = null;
  if (running) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(poll, seconds * 1000);
  }
}

/** Server changed (login as someone else): forget everything. */
export function resetMonitor() {
  stopMonitor();
  buffer.clear();
  prevRaw = null;
  mon.caps = null;
  mon.last = null;
  mon.rates = null;
  mon.levels = {};
  mon.slowNotice = null;
}
