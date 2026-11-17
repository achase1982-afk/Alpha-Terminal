import { deskStreamerDeskSymbolPlan } from "./deskStreamerDeskSubs.js";

export type DeskStreamerDeskSyncResult = {
  next: string[];
  add: string[];
  /** Symbols safe to UNSUB (not held by the app's SUBS set). */
  unsub: string[];
  /** Removed from desk tracking only (overlap with app); no UNSUB. */
  yieldToApp: string[];
};

/**
 * Plan desk-only option/book sync. App-held symbols are excluded from the desk
 * candidate list and are never sent UNSUBS.
 */
export function deskStreamerSyncDeskSymbols(
  currentDesk: ReadonlySet<string>,
  requestedSymbols: string[],
  budget: number,
  appHeld: ReadonlySet<string>,
): DeskStreamerDeskSyncResult {
  const yieldToApp: string[] = [];
  for (const s of currentDesk) {
    if (appHeld.has(s)) yieldToApp.push(s);
  }

  const deskCandidates = requestedSymbols
    .map((s) => s.trim())
    .filter((k) => k && !appHeld.has(k));

  const plan = deskStreamerDeskSymbolPlan(currentDesk, deskCandidates, budget);
  const unsub = plan.remove.filter((s) => !appHeld.has(s));

  return {
    next: plan.next,
    add: plan.add,
    unsub,
    yieldToApp,
  };
}
