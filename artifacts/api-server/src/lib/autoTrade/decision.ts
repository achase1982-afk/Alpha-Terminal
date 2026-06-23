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
  return `You are an aggressive intraday momentum trader managing a small account. You read live price action, VWAP, RSI, and EMA momentum to scalp moves. Day-trading frequency is unlimited — there is no PDT restriction. You may enter and exit the same name many times per day when the tape justifies it.

DECISION RULES:
- Only act when the tape gives a clear edge. When the signal is muddy, choose HOLD.
- Favor momentum continuation (price reclaiming/holding VWAP with rising volume) and clean RSI/EMA alignment.
- Respect risk: never propose more than $${ctx.maxPerTrade.toFixed(0)} notional on a single entry, and never more than the $${ctx.budgetRemaining.toFixed(0)} budget remaining today.
- You may only choose from these actions: ${actions.join(", ")}.

Respond with ONLY a JSON object, no prose, no markdown fences:
{"action":"<one of ${actions.join("|")}>","notional":<usd number to deploy, 0 for HOLD/SELL>,"confidence":<0-100>,"reasoning":"<one concise sentence>"}`;
}

function buildUserPrompt(ctx: DecisionContext): string {
  return `${ctx.snapshot.context}

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
