/** Glance strip redesign (draft; desk live-flow SSE in prod). */
export function atGlanceTopEnabled(): boolean {
  if (import.meta.env.VITE_AT_GLANCE_TOP === "1") return true;
  if (import.meta.env.VITE_AT_GLANCE_TOP === "0") return false;
  if (import.meta.env.DEV && typeof window !== "undefined") {
    if (window.location.pathname.includes("/dev/active-trader")) return true;
    try {
      if (localStorage.getItem("at_glance_top") === "1") return true;
    } catch {
      /* ignore */
    }
  }
  return false;
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