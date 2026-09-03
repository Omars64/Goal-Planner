export const SESSION_EXPIRED_EVENT = "goal-planner:session-expired";

export function watchSessionExpiry(expiresAt: string, onExpired: () => void) {
  const deadline = Date.parse(expiresAt);
  let stopped = false;
  let timer: number;

  const stop = () => {
    stopped = true;
    window.clearTimeout(timer);
    window.removeEventListener(SESSION_EXPIRED_EVENT, expire);
    window.removeEventListener("focus", check);
    window.removeEventListener("pageshow", check);
    document.removeEventListener("visibilitychange", check);
  };
  const expire = () => {
    if (stopped) return;
    stop();
    onExpired();
  };
  const check = () => {
    if (stopped) return;
    const remaining = deadline - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      expire();
      return;
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(check, remaining);
  };

  window.addEventListener(SESSION_EXPIRED_EVENT, expire);
  window.addEventListener("focus", check);
  window.addEventListener("pageshow", check);
  document.addEventListener("visibilitychange", check);
  // Use the server deadline, not a fresh 30 minutes on mount or activity.
  timer = window.setTimeout(check, Math.max(0, deadline - Date.now()) || 0);
  return stop;
}
