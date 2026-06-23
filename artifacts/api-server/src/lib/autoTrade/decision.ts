import { generateText } from "ai";
import { resolveChatLanguageModel } from "../chatModel.js";
import { logger } from "../logger.js";
import type { InstrumentMode } from "./config.js";
import type { AutoTradeSnapshot } from "./snapshot.js";

export type AutoTradeAction = "BUY_STOCK" | "BUY_CALL" | "BUY_PUT" | "SELL" | "HOLD";

export interface AutoTradeDecision {
  action: AutoTradeAction;
  notional: number;
  confidence: number;
  reasoning: string;
}

export interface DecisionContext {
  snapshot: AutoTradeSnapshot;
  modelId: string;
  instrumentMode: InstrumentMode;
  maxPerTrade: number;
  budgetRemaining: number;
  hasPosition: boolean;
  positionSummary: string;
  /** Pre-computed pattern memory playbook injected before the live snapshot. */
  playbook?: string | null;
}

function allowedActions(mode: InstrumentMode, hasPosition: boolean): AutoTradeAction[] {
  const actions: AutoTradeAction[] = ["HOLD"];
  if (hasPosition) actions.push("SELL");
  if (mode === "stock" || mode === "both") actions.push("BUY_STOCK");
  if (mode === "options" || mode === "both") actions.push("BUY_CALL", "BUY_PUT");
  return actions;
}

function buildSystemPrompt(ctx: DecisionContext): string {
  const actions = allowedActions(ctx.instrumentMode, ctx.hasPosition);
  return `You are an aggressive intraday momentum trader. Your edge is reading what the tape IS doing right now — not predicting reversals, not finding "value," not anchoring to where a stock was yesterday. You trade momentum, not opinions. Day-trading is unlimited — no PDT restriction.

INDIVIDUAL REGIME IS PRIMARY:
- Read the ticker's own trend label (BULLISH / BEARISH / PULLBACK / RECOVERY) and VWAP relationship first. That is your primary signal. A stock above its own VWAP, EMA50, and EMA200 with rising RSI is a valid long regardless of what SPY is doing.
- Idiosyncratic relative strength — a stock moving UP while SPY is flat or falling — is a stronger signal, not a weaker one. It means buyers are specifically targeting this name. Do not fade it because of the macro.

MACRO BACKDROP RULE (secondary tilt — read after the individual setup):
- The snapshot ends with a MACRO BACKDROP block showing SPY vs its own EMA200. Use it only to calibrate conviction on ambiguous setups, not to block clear ones.
- BULL SPY (above EMA200): no adjustment — trade clean setups at the normal 65 confidence threshold.
- BEAR SPY (below EMA200 or slope FALLING): raise your bar for long entries only — require 75+ confidence for BUY_STOCK or BUY_CALL. SELL and BUY_PUT are unaffected. A stock with a clear individual bull setup (above own VWAP + EMA50 + EMA200, RSI confirming) still qualifies — just needs stronger conviction to act in a hostile macro.

FALLING KNIFE RULE (non-negotiable):
- A stock down 5%, 10%, or 50% from a prior high is NOT a buy signal. Price history is irrelevant.
- If price is falling, RSI is falling, and volume is rising — that is CONTINUATION DOWN, not a reversal. Do not buy it no matter how "oversold" it looks.
- "Oversold" is not a trade thesis. Oversold can get more oversold for days.

TREND ENTRY RULE:
- When price > VWAP, price > EMA50, price > EMA200, and RSI is in the 50–70 range and rising — this is a valid momentum continuation long. Do not search for reasons to HOLD. Act.
- Chronic HOLD is not risk management — it is failure to trade. Use HOLD only when momentum is genuinely ambiguous: RSI flat 45–55, price chopping at VWAP, volume contracting.

CONFIDENCE RULE (non-negotiable):
- If your confidence in a BUY or PUT entry is below 65, output HOLD instead. Weak conviction is not a trade.
- Confidence reflects signal clarity, not hope.

RISK RULES:
- Never propose more than $${ctx.maxPerTrade.toFixed(0)} notional per entry.
- Never exceed $${ctx.budgetRemaining.toFixed(0)} budget remaining today.
- Allowed actions only: ${actions.join(", ")}.

Respond with ONLY a JSON object — no prose, no markdown fences:
{"action":"<one of ${actions.join("|")}>","notional":<usd amount, 0 for HOLD/SELL>,"confidence":<0-100>,"reasoning":"<one concise sentence naming the specific signal>"}`;
}

function buildUserPrompt(ctx: DecisionContext): string {
  const playbookSection = ctx.playbook ? `${ctx.playbook}\n\n` : "";
  return `${playbookSection}${ctx.snapshot.context}

CURRENT POSITION: ${ctx.hasPosition ? ctx.positionSummary : "None"}
BUDGET REMAINING TODAY: $${ctx.budgetRemaining.toFixed(0)}
MAX PER TRADE: $${ctx.maxPerTrade.toFixed(0)}

Decide now.`;
}

function parseDecision(raw: string, ctx: DecisionContext): AutoTradeDecision {
  const allowed = new Set(allowedActions(ctx.instrumentMode, ctx.hasPosition));
  const fallback: AutoTradeDecision = {
    action: "HOLD",
    notional: 0,
    confidence: 0,
    reasoning: "Unparseable model output — defaulting to HOLD.",
  };
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return fallback;
  try {
    const obj = JSON.parse(match[0]) as Partial<AutoTradeDecision>;
    const action = obj.action as AutoTradeAction;
    if (!action || !allowed.has(action)) {
      return { ...fallback, reasoning: `Model chose disallowed action "${obj.action}".` };
    }
    let notional = typeof obj.notional === "number" ? obj.notional : Number(obj.notional) || 0;
    notional = Math.max(0, Math.min(notional, ctx.maxPerTrade, ctx.budgetRemaining));
    const confidence = Math.max(0, Math.min(100, Number(obj.confidence) || 0));
    const reasoning =
      typeof obj.reasoning === "string" && obj.reasoning.trim()
        ? obj.reasoning.trim().slice(0, 500)
        : "(no reasoning provided)";

    // Hard confidence floor: BUY actions below 65 are demoted to HOLD.
    const isBuy = action === "BUY_STOCK" || action === "BUY_CALL" || action === "BUY_PUT";
    if (isBuy && confidence < 65) {
      return {
        action: "HOLD",
        notional: 0,
        confidence,
        reasoning: `${reasoning} (confidence ${confidence} < 65 floor — held)`,
      };
    }

    return { action, notional, confidence, reasoning };
  } catch {
    return fallback;
  }
}

/** Ask the configured LLM for a trade decision on a single symbol. */
export async function decideAutoTrade(ctx: DecisionContext): Promise<AutoTradeDecision> {
  const resolved = resolveChatLanguageModel(ctx.modelId, { extendedThinkingEnabled: false });
  const callOpts: Record<string, unknown> =
    "providerOptions" in resolved
      ? { providerOptions: resolved.providerOptions }
      : { temperature: resolved.temperature };

  try {
    const { text } = await generateText({
      model: resolved.model,
      system: buildSystemPrompt(ctx),
      prompt: buildUserPrompt(ctx),
      ...callOpts,
    } as Parameters<typeof generateText>[0]);
    return parseDecision(text, ctx);
  } catch (err) {
    logger.error({ err, ticker: ctx.snapshot.symbol }, "autoTrade decision LLM call failed");
    return {
      action: "HOLD",
      notional: 0,
      confidence: 0,
      reasoning: "LLM call failed — holding.",
    };
  }
}
