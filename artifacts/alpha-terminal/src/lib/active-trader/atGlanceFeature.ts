/** Glance strip redesign (draft; fixture/SSE until desk flow is validated). */
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

export const AT_GLANCE_FLOW_FIXTURE =
  import.meta.env.VITE_AT_GLANCE_FLOW_FIXTURE === "1" || import.meta.env.DEV;