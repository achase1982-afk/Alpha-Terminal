/** Max distinct option contracts in mobile chain build mode (one row per strike × C/P). */
export const CHAIN_MAX_DRAFT_LEGS = 4;

export const CHAIN_LEG_LIMIT_MESSAGE =
  "4-leg maximum. Remove a leg to add another.";

export function assertChainDraftLegCount(count: number): void {
  if (count > CHAIN_MAX_DRAFT_LEGS) {
    throw new Error(`Chain draft exceeds ${CHAIN_MAX_DRAFT_LEGS} legs (got ${count})`);
  }
}

export function canAddChainDraftLeg(currentDistinctLegs: number): boolean {
  return currentDistinctLegs < CHAIN_MAX_DRAFT_LEGS;
}