/** Stable key for chain order sheet legs — limit resets when this changes (unless user edited). */
export function chainLegHydrateKey(
  legs: Array<{ id: string; direction: string; strike: number; quantity: number; schwabSymbol: string }>,
): string {
  return legs
    .map((l) => `${l.id}|${l.direction}|${l.strike}|${l.quantity}|${l.schwabSymbol}`)
    .join(";");
}