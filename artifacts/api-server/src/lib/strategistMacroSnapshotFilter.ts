import type { UpcomingEvent } from "./calendarEventChecker.js";

/**
 * Macro releases kept for equity-options strategist snapshots (HIGH importance only).
 * Aligns catalystEvaluator scheduledEvents and strategistV2 macroEventsInPositionWindow.
 */
const HIGH_ECON_RELEASE_TITLE: RegExp[] = [
  /\bJobs Report\b/i,
  /\bNFP\b/i,
  /\bNon[-\s]?Farm\b/i,
  /\bCPI\b/i,
  /\bPPI\b/i,
  /\bPCE\b/i,
  /\bGDP\b/i,
  /\bRetail Sales\b/i,
  /\bJOLTS\b/i,
  /\bISM\s*Manufactur/i,
  /\bISM\s*Services\b/i,
  /\bISM\s*Service\b/i,
];

/** FOMC meetings plus a tight allowlist of HIGH-importance economic prints. */
export function isEquityOptionsStrategistMacroEvent(ev: UpcomingEvent): boolean {
  if (ev.type === "fomc") return true;
  if (ev.type !== "economic") return false;
  if (ev.importance !== "HIGH") return false;
  return HIGH_ECON_RELEASE_TITLE.some((re) => re.test(ev.title));
}
