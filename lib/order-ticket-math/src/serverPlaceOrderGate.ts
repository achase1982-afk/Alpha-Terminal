import { evaluateTicketPreTradeGate, type TicketGateCheck, type TicketRiskLevel } from "./ticketPreTradeGate.js";

export interface SchwabOrderLegLike {
  instruction?: string;
  quantity?: number;
  instrument?: { symbol?: string; assetType?: string };
}

export interface SchwabOrderLike {
  orderType?: string;
  price?: number;
  orderLegCollection?: SchwabOrderLegLike[];
}

export function orderHasClosingLeg(order: SchwabOrderLike): boolean {
  return (order.orderLegCollection ?? []).some((l) =>
    (l.instruction ?? "").toUpperCase().includes("TO_CLOSE"),
  );
}

export interface ServerPreTradeSettings {
  preTradeEnabled: boolean;
  blockOnRed: boolean;
  preTradeMaxPositionPct: number;
}

const DEFAULT_SETTINGS: ServerPreTradeSettings = {
  preTradeEnabled: true,
  blockOnRed: false,
  preTradeMaxPositionPct: 10,
};

/**
 * Server-side gate from order + account equity (never trusts client check levels).
 * Closing orders are never rejected.
 */
export function evaluateServerPlaceOrderGate(input: {
  order: SchwabOrderLike;
  accountEquity: number | null;
  settings?: Partial<ServerPreTradeSettings>;
}): { reject: boolean; checks: TicketGateCheck[]; overall: TicketRiskLevel } {
  const settings = { ...DEFAULT_SETTINGS, ...input.settings };

  if (orderHasClosingLeg(input.order)) {
    return { reject: false, checks: [], overall: "GREEN" };
  }

  if (!settings.preTradeEnabled) {
    return { reject: false, checks: [], overall: "GREEN" };
  }

  const checks: TicketGateCheck[] = [];
  const qty = Math.max(
    1,
    ...(input.order.orderLegCollection ?? []).map((l) => l.quantity ?? 1),
  );
  const price = typeof input.order.price === "number" && input.order.price > 0 ? input.order.price : null;
  const legs = input.order.orderLegCollection ?? [];
  const isOption = legs.some((l) => (l.instrument?.assetType ?? "").toUpperCase() === "OPTION");
  const multiplier = isOption ? 100 : 1;
  const notional = price != null ? price * qty * multiplier : null;

  if (input.accountEquity == null || input.accountEquity <= 0) {
    checks.push({ id: "size", level: "YELLOW" });
  } else if (notional != null) {
    const maxAllowed = input.accountEquity * (settings.preTradeMaxPositionPct / 100);
    checks.push({ id: "size", level: notional > maxAllowed ? "RED" : "GREEN" });
  } else {
    checks.push({ id: "size", level: "YELLOW" });
  }

  const gate = evaluateTicketPreTradeGate({ blockOnRed: settings.blockOnRed, checks });
  return {
    reject: gate.shouldBlockSubmit,
    checks,
    overall: gate.overall,
  };
}