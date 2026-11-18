/** Glance top is the default Active Trader chrome; set VITE_AT_GLANCE_TOP=0 to restore legacy KEY LEVELS. */
export function atGlanceTopEnabled(): boolean {
  if (import.meta.env.VITE_AT_GLANCE_TOP === "0") return false;
  return true;
}

function devRoute(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.pathname.startsWith("/dev/");
}

/** Fixtures only on `/dev` routes or explicit env (never default prod/dev). */
export function atGlanceFlowFixtureEnabled(): boolean {
  if (import.meta.env.VITE_AT_GLANCE_FLOW_FIXTURE === "1") return true;
  if (import.meta.env.DEV && devRoute() && import.meta.env.VITE_AT_GLANCE_FLOW_FIXTURE !== "0") return true;
  return false;
}

/** Deterministic recorded SSE for captures (`VITE_AT_GLANCE_FLOW_REPLAY=1`). */
export function atGlanceFlowReplayEnabled(): boolean {
  return import.meta.env.VITE_AT_GLANCE_FLOW_REPLAY === "1";
}