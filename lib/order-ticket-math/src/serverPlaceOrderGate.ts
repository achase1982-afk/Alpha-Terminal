import { evaluateTicketPreTradeGate, type TicketGateCheck, type TicketRiskLevel } from "./ticketPreTradeGate.js";
import { isClosingSchwabOrder, schwabOrderMaxRisk, type SchwabOrderLike } from "./schwabOrderRisk.js";

export { isClosingSchwabOrder, type SchwabOrderLike } from "./schwabOrderRisk.js";

export interface ServerPreTradeSettings {
  preTradeEnabled: boolean;
  blockOnRed: boolean;
  /** Server-side user max position % — when omitted, only the 10% catastrophe guard applies. */
  preTradeMaxPositionPct?: number;
}

export const DEFAULT_SERVER_PRE_TRADE: ServerPreTradeSettings = {
  preTradeEnabled: true,
  blockOnRed: false,
};

/**
 * Ticket enforces the user's max position % (default 3%). The server is a catastrophe guard only:
 * when a server-side user cap exists, use max(user, 10%); otherwise enforce 10% alone.
 */
export const SERVER_SIZE_CATASTROPHE_FLOOR_PCT = 10;

/**
 * Server-side gate from order + account equity. Never trusts client gate payload.
 * Closing orders are never rejected.
 */
export function evaluateServerPlaceOrderGate(input: {
  order: SchwabOrderLike;
  accountEquity: number | null;
  settings?: Partial<ServerPreTradeSettings>;
}): { reject: boolean; checks: TicketGateCheck[]; overall: TicketRiskLevel } {
  const settings = { ...DEFAULT_SERVER_PRE_TRADE, ...input.settings };

  if (isClosingSchwabOrder(input.order)) {
    return { reject: false, checks: [], overall: "GREEN" };
  }

  if (!settings.preTradeEnabled) {
    return { reject: false, checks: [], overall: "GREEN" };
  }

  const checks: TicketGateCheck[] = [];
  const risk = schwabOrderMaxRisk(input.order);

  if (risk.kind === "unknown") {
    checks.push({ id: "size", level: "YELLOW" });
  } else if (input.accountEquity == null || input.accountEquity <= 0) {
    checks.push({ id: "size", level: "YELLOW" });
  } else {
    const userPct = settings.preTradeMaxPositionPct;
    const serverCapPct =
      userPct != null && Number.isFinite(userPct) && userPct > 0
        ? Math.max(userPct, SERVER_SIZE_CATASTROPHE_FLOOR_PCT)
        : SERVER_SIZE_CATASTROPHE_FLOOR_PCT;
    const maxAllowed = input.accountEquity * (serverCapPct / 100);
    checks.push({
      id: "size",
      level: risk.maxRisk > maxAllowed ? "RED" : "GREEN",
    });
  }

  const gate = evaluateTicketPreTradeGate({ blockOnRed: settings.blockOnRed, checks });
  return {
    reject: gate.shouldBlockSubmit,
    checks,
    overall: gate.overall,
  };
}
