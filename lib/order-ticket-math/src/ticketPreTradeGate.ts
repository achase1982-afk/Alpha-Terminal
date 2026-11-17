export type TicketRiskLevel = "GREEN" | "YELLOW" | "RED";

export interface TicketGateCheck {
  id: string;
  level: TicketRiskLevel;
}

export interface TicketPreTradeGateInput {
  checks: TicketGateCheck[];
  /** When true, WARN (YELLOW) checks also block Review/Send. FAIL (RED) always blocks. */
  blockOnRed: boolean;
}

export interface TicketPreTradeGateResult {
  overall: TicketRiskLevel;
  shouldBlockSubmit: boolean;
  shouldBlockReview: boolean;
  /** Check ids that are actively blocking (RED always; YELLOW when blockOnRed). */
  blockingCheckIds: string[];
  /** RED checks listed for UI when not blocking — empty because FAIL always blocks. */
  advisoryFailIds: string[];
  /** YELLOW checks that are advisory when blockOnRed is false. */
  advisoryWarnIds: string[];
}

export function overallRiskFromChecks(checks: TicketGateCheck[]): TicketRiskLevel {
  if (checks.some((c) => c.level === "RED")) return "RED";
  if (checks.some((c) => c.level === "YELLOW")) return "YELLOW";
  return "GREEN";
}

/**
 * FAIL (RED) always blocks Review and Send.
 * `blockOnRed` only controls whether WARN (YELLOW) also blocks — it never relaxes FAIL.
 */
export function evaluateTicketPreTradeGate(input: TicketPreTradeGateInput): TicketPreTradeGateResult {
  const overall = overallRiskFromChecks(input.checks);
  const redIds = input.checks.filter((c) => c.level === "RED").map((c) => c.id);
  const yellowIds = input.checks.filter((c) => c.level === "YELLOW").map((c) => c.id);
  const shouldBlockFail = redIds.length > 0;
  const shouldBlockWarn = input.blockOnRed && yellowIds.length > 0;
  const shouldBlock = shouldBlockFail || shouldBlockWarn;
  return {
    overall,
    shouldBlockSubmit: shouldBlock,
    shouldBlockReview: shouldBlock,
    blockingCheckIds: [...redIds, ...(shouldBlockWarn ? yellowIds : [])],
    advisoryFailIds: [],
    advisoryWarnIds: shouldBlockWarn ? [] : yellowIds,
  };
}

/** Payload the client sends with place-order for server enforcement (logic-only; no copy changes). */
export interface OrderPreTradeGatePayload {
  /** When false, server skips gate enforcement for this order. */
  enabled?: boolean;
  blockOnRed: boolean;
  overall: TicketRiskLevel;
  checks: TicketGateCheck[];
}

export function validateOrderPreTradeGatePayload(body: unknown): OrderPreTradeGatePayload | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  if (typeof o.blockOnRed !== "boolean") return null;
  if (o.overall !== "GREEN" && o.overall !== "YELLOW" && o.overall !== "RED") return null;
  if (!Array.isArray(o.checks)) return null;
  const enabled = o.enabled === undefined ? true : o.enabled === true;
  const checks: TicketGateCheck[] = [];
  for (const raw of o.checks) {
    if (!raw || typeof raw !== "object") return null;
    const c = raw as Record<string, unknown>;
    if (typeof c.id !== "string") return null;
    if (c.level !== "GREEN" && c.level !== "YELLOW" && c.level !== "RED") return null;
    checks.push({ id: c.id, level: c.level });
  }
  return { enabled, blockOnRed: o.blockOnRed, overall: o.overall, checks };
}

export function serverShouldRejectOrder(gate: OrderPreTradeGatePayload | null | undefined): boolean {
  if (!gate) return true;
  if (gate.enabled === false) return false;
  const evald = evaluateTicketPreTradeGate({ blockOnRed: gate.blockOnRed, checks: gate.checks });
  return evald.shouldBlockSubmit;
}