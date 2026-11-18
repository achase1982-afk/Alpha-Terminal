/** Row shape read from Review trigger-confirm DOM (data-* attributes). */
export type TriggerConfirmVerifierRow = {
  positionEffect: "TO OPEN" | "TO CLOSE";
  orderKind: "LIMIT" | "STOP" | "MARKET" | "TRIGGER";
  isParent: boolean;
};

export function validateSequenceTriggerConfirm(rows: TriggerConfirmVerifierRow[]): string | null {
  if (rows.length !== 2) {
    return `Sequence: expected 2 confirm rows, got ${rows.length}`;
  }
  const parents = rows.filter((r) => r.isParent);
  if (parents.length !== 1 || parents[0].positionEffect !== "TO OPEN") {
    return "Sequence: expected exactly one parent OPEN row";
  }
  const closeLimits = rows.filter(
    (r) => !r.isParent && r.positionEffect === "TO CLOSE" && r.orderKind === "LIMIT",
  );
  if (closeLimits.length !== 1) {
    return `Sequence: expected exactly one closing LIMIT child, got ${closeLimits.length}`;
  }
  return null;
}

export function validateOcoTriggerConfirm(rows: TriggerConfirmVerifierRow[]): string | null {
  if (rows.length !== 3) {
    return `OCO: expected 3 confirm rows, got ${rows.length}`;
  }
  const parents = rows.filter((r) => r.isParent);
  if (parents.length !== 1 || parents[0].positionEffect !== "TO OPEN") {
    return "OCO: expected exactly one parent OPEN row";
  }
  const closeLimits = rows.filter(
    (r) => !r.isParent && r.positionEffect === "TO CLOSE" && r.orderKind === "LIMIT",
  );
  const closeStops = rows.filter(
    (r) => !r.isParent && r.positionEffect === "TO CLOSE" && r.orderKind === "STOP",
  );
  if (closeLimits.length !== 1 || closeStops.length !== 1) {
    return `OCO: expected one TP LIMIT and one SL STOP close leg (got LMT=${closeLimits.length} STP=${closeStops.length})`;
  }
  return null;
}