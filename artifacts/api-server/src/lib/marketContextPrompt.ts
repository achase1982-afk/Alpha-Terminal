import type { MarketContext } from "./getMarketContext.js";

export const MARKET_CONTEXT_GUARDRAILS = `SESSION GUARDRAILS (mandatory):
- If session is not OPEN: do not describe intraday mechanics — no max-pain pinning, no market makers anchoring through the close, no "the market's verdict today."
- If session is PREMARKET or AFTERHOURS: explicitly caveat prints as thin, low-volume, and not regular-session price discovery.
- If equity options market is CLOSED: options-flow commentary must state its origin session and must not be framed as live or current positioning.
- Any dataset tagged PRIOR_SESSION or STALE must be labeled as such wherever referenced in the narrative.`;

export function formatMarketContextUserBlock(ctx: MarketContext): string {
  const optionsState = ctx.optionsLive ? "OPEN" : "CLOSED";
  return `MARKET CONTEXT — authoritative. Do NOT infer or compute time or session.
Current time: ${ctx.localLabel}
Session: ${ctx.session}  (regular session 9:30 AM–4:00 PM ET)
Equity options market: ${optionsState}

${MARKET_CONTEXT_GUARDRAILS}`;
}

export function prependMarketContextToUserMessage(userMessage: string, ctx: MarketContext): string {
  const block = formatMarketContextUserBlock(ctx);
  if (userMessage.includes("MARKET CONTEXT — authoritative")) return userMessage;
  return `${block}\n\n${userMessage}`;
}
