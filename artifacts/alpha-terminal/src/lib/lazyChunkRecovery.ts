/** sessionStorage timestamp guard — at most one auto-reload per 30s window. */
export const CHUNK_RELOAD_GUARD_KEY = "at-chunk-reload-guard";
const RELOAD_GUARD_MS = 30_000;

let tradeActivityLatch = false;

/** Terminal sets when order/strategy sheets are open (unsaved intent). */
export function setLazyRecoveryTradeLatch(active: boolean): void {
  tradeActivityLatch = active;
}

export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Loading chunk [\w-]+ failed/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Unable to preload CSS/i.test(msg)
  );
}

/** DOM + latch: chain draft, AT tray, open order surfaces. */
export function hasUnsavedTradingState(): boolean {
  if (tradeActivityLatch) return true;
  if (typeof document === "undefined") return false;
  if (document.querySelector("[data-chain-draft-strip]")) return true;
  const tray = document.querySelector("[data-at-leg-tray]");
  if (tray && tray.querySelector("[data-at-leg]")) return true;
  if (document.querySelector("[data-order-ticket-backdrop]")) return true;
  if (document.querySelector('[data-testid="options-chain-order-sheet"]')) return true;
  if (document.querySelector("[data-at-approved-ticket]")) return true;
  return false;
}

export type GuardedReloadResult =
  | "reloaded"
  | "blocked-unsaved"
  | "blocked-loop"
  | "unavailable";

export function tryGuardedFullReload(_reason: string, opts?: { force?: boolean }): GuardedReloadResult {
  if (typeof window === "undefined") return "unavailable";
  if (!opts?.force && hasUnsavedTradingState()) return "blocked-unsaved";
  try {
    const guard = sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY);
    const now = Date.now();
    if (guard) {
      const t = Number(guard);
      if (Number.isFinite(t) && now - t < RELOAD_GUARD_MS) return "blocked-loop";
    }
    sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, String(now));
  } catch {
    /* ignore quota */
  }
  window.location.reload();
  return "reloaded";
}

export function handleVitePreloadError(ev: Event): void {
  ev.preventDefault();
  if (hasUnsavedTradingState()) {
    window.dispatchEvent(
      new CustomEvent("at:chunk-stale", { detail: { unsaved: true, source: "vite:preloadError" } }),
    );
    return;
  }
  const result = tryGuardedFullReload("vite:preloadError");
  if (result === "blocked-loop" || result === "blocked-unsaved") {
    window.dispatchEvent(
      new CustomEvent("at:chunk-stale", {
        detail: { unsaved: result === "blocked-unsaved", source: "vite:preloadError" },
      }),
    );
  }
}

export function registerVitePreloadErrorHandler(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (ev: Event) => handleVitePreloadError(ev);
  window.addEventListener("vite:preloadError", handler);
  return () => window.removeEventListener("vite:preloadError", handler);
}