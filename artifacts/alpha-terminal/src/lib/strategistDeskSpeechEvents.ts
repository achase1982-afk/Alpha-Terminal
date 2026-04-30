/** Dispatched when a new Strategist analysis starts so Desk audio can stop. */
export const STRATEGIST_ANALYSIS_START_EVENT = "strategist-analysis-start";

/** Dispatched when the user cancels an in-flight Strategist analysis. */
export const STRATEGIST_ANALYSIS_CANCEL_EVENT = "strategist-analysis-cancel";

export function dispatchStrategistAnalysisStart(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(STRATEGIST_ANALYSIS_START_EVENT));
}

export function dispatchStrategistAnalysisCancel(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(STRATEGIST_ANALYSIS_CANCEL_EVENT));
}
