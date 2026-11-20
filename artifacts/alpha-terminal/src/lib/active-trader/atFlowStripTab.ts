export type AtFlowStripTab = "now" | "session" | "levels";

const KEY = "alpha.activeTrader.flowStripTab:v1";

export function loadAtFlowStripTab(): AtFlowStripTab {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === "session" || v === "levels") return v;
  } catch {
    /* ignore */
  }
  return "now";
}

export function saveAtFlowStripTab(tab: AtFlowStripTab): void {
  try {
    window.localStorage.setItem(KEY, tab);
  } catch {
    /* ignore */
  }
}