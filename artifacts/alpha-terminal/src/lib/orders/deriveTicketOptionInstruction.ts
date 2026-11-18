import type { SchwabInstruction } from "@/lib/active-trader/atSchwabOrderBuilder";

export type TicketPositionEffect = "AUTO" | "OPENING" | "CLOSING";

/** Single source for option leg instruction from ticket side + open/close effect (ignores stale caller props). */
export function deriveTicketOptionInstruction(params: {
  side: "BUY" | "SELL";
  isCloseOrder?: boolean;
  posEffect?: TicketPositionEffect;
}): SchwabInstruction {
  const closing =
    params.posEffect === "CLOSING"
      ? true
      : params.posEffect === "OPENING"
        ? false
        : params.isCloseOrder === true;
  if (params.side === "BUY") return closing ? "BUY_TO_CLOSE" : "BUY_TO_OPEN";
  return closing ? "SELL_TO_CLOSE" : "SELL_TO_OPEN";
}