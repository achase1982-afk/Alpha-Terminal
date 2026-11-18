export interface BracketPlaceOrderResult {
  orderId: string | null;
  entryAccepted: boolean;
  exitsAccepted: boolean;
  rejectedExitLabels: string[];
  userMessage: string | null;
}

export function interpretBracketPlaceOrderResult(data: unknown): BracketPlaceOrderResult | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (o.entryAccepted !== true && o.exitsRejected == null && o.exitsAccepted !== false) return null;

  const orderId = typeof o.orderId === "string" ? o.orderId : null;
  const entryAccepted = o.entryAccepted === true || !!orderId;
  const exitsAccepted = o.exitsAccepted !== false && !Array.isArray(o.exitsRejected);
  const rejectedExitLabels = Array.isArray(o.exitsRejected)
    ? o.exitsRejected.filter((x): x is string => typeof x === "string")
    : [];

  let userMessage: string | null = null;
  if (entryAccepted && !exitsAccepted) {
    userMessage =
      "Entry was accepted, but exit protection orders were rejected. Your position has no exit protection — add stops or closes in Schwab.";
  } else if (typeof o.message === "string" && o.message.trim()) {
    userMessage = o.message.trim();
  }

  return { orderId, entryAccepted, exitsAccepted, rejectedExitLabels, userMessage };
}