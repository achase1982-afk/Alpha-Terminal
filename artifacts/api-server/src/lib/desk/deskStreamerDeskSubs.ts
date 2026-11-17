/**
 * Pure desk streamer symbol sync: compute adds/removals when the allowed set or budget shrinks
 * (e.g. OPTIONS_BOOK rollover or app claiming book slots).
 */
export function deskStreamerDeskSymbolPlan(
  currentDesk: ReadonlySet<string>,
  allowedSymbols: string[],
  budget: number,
): { next: string[]; remove: string[]; add: string[] } {
  const allowed = new Set(allowedSymbols.map((s) => s.trim()).filter(Boolean));
  const remove: string[] = [];
  for (const s of currentDesk) {
    if (!allowed.has(s)) remove.push(s);
  }

  let ordered = allowedSymbols.map((s) => s.trim()).filter((k) => k && allowed.has(k));
  const seen = new Set<string>();
  ordered = ordered.filter((k) => {
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (ordered.length > budget) ordered = ordered.slice(0, Math.max(0, budget));

  const nextSet = new Set(ordered);
  for (const s of currentDesk) {
    if (!nextSet.has(s) && !remove.includes(s)) remove.push(s);
  }

  const add: string[] = [];
  for (const k of ordered) {
    if (!currentDesk.has(k)) add.push(k);
  }

  return { next: ordered, remove, add };
}
