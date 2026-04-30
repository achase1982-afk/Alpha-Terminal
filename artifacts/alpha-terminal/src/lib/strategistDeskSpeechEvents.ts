/** Dispatched when a new Strategist analysis starts so Desk audio can stop. */
export const STRATEGIST_ANALYSIS_START_EVENT = "strategist-analysis-start";

export function dispatchStrategistAnalysisStart(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(STRATEGIST_ANALYSIS_START_EVENT));
}
