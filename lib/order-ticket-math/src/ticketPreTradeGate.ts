export type TicketRiskLevel = "GREEN" | "YELLOW" | "RED";

export interface TicketGateCheck {
  id: string;
  level: TicketRiskLevel;
}

export interface TicketPreTradeGateInput {
  checks: TicketGateCheck[];
  blockOnRed: boolean;
}

export interface TicketPreTradeGateResult {
  overall: TicketRiskLevel;
  shouldBlockSubmit: boolean;
  /** FAIL-class check ids that drove a block (RED only when blockOnRed). */
  blockingCheckIds: string[];
  /** RED checks that are advisory when blockOnRed is false. */
  advisoryFailIds: string[];
}

export function overallRiskFromChecks(checks: TicketGateCheck[]): TicketRiskLevel {
  if (checks.some((c) => c.level === "RED")) return "RED";
  if (checks.some((c) => c.level === "YELLOW")) return "YELLOW";
  return "GREEN";
}

/**
 * UI + server share this contract: only RED checks can block, and only when blockOnRed is enabled.
 * YELLOW is never blocking.
 */
export function evaluateTicketPreTradeGate(input: TicketPreTradeGateInput): TicketPreTradeGateResult {
  const overall = overallRiskFromChecks(input.checks);
  const redIds = input.checks.filter((c) => c.level === "RED").map((c) => c.id);
  const shouldBlockSubmit = input.blockOnRed && redIds.length > 0;
  return {
    overall,
    shouldBlockSubmit,
    blockingCheckIds: shouldBlockSubmit ? redIds : [],
    advisoryFailIds: !input.blockOnRed ? redIds : [],
  };
}

/** Payload the client sends with place-order for server enforcement (logic-only; no copy changes). */
export interface OrderPreTradeGatePayload {
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
  const checks: TicketGateCheck[] = [];
  for (const raw of o.checks) {
    if (!raw || typeof raw !== "object") return null;
    const c = raw as Record<string, unknown>;
    if (typeof c.id !== "string") return null;
    if (c.level !== "GREEN" && c.level !== "YELLOW" && c.level !== "RED") return null;
    checks.push({ id: c.id, level: c.level });
  }
  return { blockOnRed: o.blockOnRed, overall: o.overall, checks };
}

export function serverShouldRejectOrder(gate: OrderPreTradeGatePayload | null | undefined): boolean {
  if (!gate) return false;
  const evald = evaluateTicketPreTradeGate({ blockOnRed: gate.blockOnRed, checks: gate.checks });
  return evald.shouldBlockSubmit;
}