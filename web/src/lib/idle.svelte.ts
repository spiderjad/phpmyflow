// Inactivity, as the server counts it: the time of the last request that
// reached it with a session (Auth::requireAuth renews `last_seen`). A minute
// before `idleSeconds` runs out, IdleWarning shows a countdown.

export const idle = $state({ lastAt: Date.now(), seconds: 3600 });

/** Called after every authenticated request. */
export function markActivity() {
  idle.lastAt = Date.now();
}
