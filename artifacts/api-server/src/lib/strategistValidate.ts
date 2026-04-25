import { logger } from "./logger.js";
import {
  streamCallAnthropicWithSystemAndWebSearch,
  streamCallGeminiWithSystemAndWebSearch,
  streamCallOpenAIWithSystemAndWebSearch,
  type WebSearchResult,
  type WebSearchTrace,
} from "./aiLabAnalystClient.js";
import { getSettings, getStrategistModel } from "./strategistSettings.js";
import type { StrategistModelOption } from "./strategistSettings.js";
import { scrubAll, hasAnyCanonical, type ScrubCanonical } from "./narrativeScrubbers.js";
import type { CatalystEvaluation } from "./catalystEvaluator.js";
import type { IOScoreResult } from "./ioScoreEngine.js";
import type { StructuredRegime } from "./regimePostProcessor.js";
import type { PolygonFlowHighlights } from "./polygonFlowHighlights.js";
import type { ChainSummary, ChainSource } from "./strategistV2.js";
import type { EquityDailyExtras } from "./equityDailyExtras.js";
import type { NextEarnings } from "./earningsService.js";

export type ValidationVerdict = "PROCEED" | "PROCEED_WITH_CAUTION" | "DO_NOT_PROCEED";
export type ValidationMode = "opening" | "closing";

export interface ValidationLeg {
  instruction: string; // BUY_TO_OPEN | SELL_TO_OPEN | BUY_TO_CLOSE | SELL_TO_CLOSE | BUY | SELL
  strike?: number;
  optionType?: "CALL" | "PUT";
  expiration?: string; // YYYY-MM-DD
  quantity?: number;
  bid?: number | null;
  ask?: number | null;
  delta?: number | null;
}

export interface ValidationTicket {
  ticker: string;
  isOption: boolean;
  isMultiLeg: boolean;
  mode: ValidationMode;
  side?: "BUY" | "SELL";
  orderType: string;
  duration?: string;
  quantity: number;
  limitPrice?: number | null;
  legs?: ValidationLeg[];
  netPrice?: number | null;
  isCredit?: boolean | null;
  // Closing-only context (best-effort; may be null)
  currentEntryPrice?: number | null;
  currentPnl?: number | null;
  daysHeld?: number | null;
  // Underlying snapshot (best-effort)
  underlyingPrice?: number | null;
  underlyingChangePct?: number | null;
  // Computed risk
  estMaxRisk?: number | null;
  estMaxProfit?: number | null;
  breakeven?: number | null;
  // Underlying-shares position the trader currently holds in the same
  // ticker. Critical for covered-call, covered-put, married/protective-put,
  // and assignment-cover validations — without this the bull/bear personas
  // only see the option leg(s) and miss the most important coverage fact.
  underlyingShares?: {
    side: "long" | "short";
    quantity: number;
    averagePrice?: number | null;
    marketValue?: number | null;
  } | null;
  // Stock leg attached to THIS order ticket (married put, covered call,
  // collar, buy-write, etc). Distinct from `underlyingShares` (already in
  // account). Both can be present simultaneously and BOTH must be evaluated
  // as part of the combined position. If this is set, the strategist must
  // treat the order as STOCK + OPTION combined, not options-only.
  stockLeg?: {
    instruction: "BUY" | "SELL";
    quantity: number;
    limitPrice?: number | null;
  } | null;
}

export interface ValidationInput {
  ticket: ValidationTicket;
  thesis?: string; // user-supplied thesis text
  rollingShort?: boolean;
  // Server-fetched market context. The route layer assembles this in parallel
  // (chain fetch, IVR, Polygon flow, catalyst, IO score, regime, equity
  // extras) so the validators see the same canonical numbers the per-ticker
  // strategist sees. Every field is optional and degrades gracefully — if a
  // sub-fetch fails or the symbol has no data, the corresponding section is
  // omitted from the data package rather than fabricating defaults.
  //
  // Same discipline as StrategistV2: no placeholder substitutions, no fake
  // numbers, no silent fallbacks. If we don't have it, the validators don't
  // see it and the prompt is shorter — they can still cite "data unavailable"
  // honestly.
  marketContext?: {
    // ── IVR (existing — unchanged) ────────────────────────────────────────
    ivr: number | null;
    ivrAsOfDate?: string | null;
    ivrSource?: "chain" | "flow" | "hv_proxy" | "canonical" | null;

    // ── Catalysts (earnings + FOMC + macro + residual) ────────────────────
    /** From evaluateCatalyst(ticker, expirationISO). Far-leg expiration is
     *  used as the in-window cutoff; for equity-only orders the route uses
     *  today + 45 DTE. */
    catalyst?: CatalystEvaluation | null;
    /** From getNextEarningsDate(ticker). Surfaces EPS/revenue estimates
     *  and earnings time (BMO/AMC) in addition to the date the catalyst
     *  block already conveys. */
    nextEarnings?: NextEarnings | null;

    // ── IO Score (beta, classification, residual Z) ───────────────────────
    /** From computeIOScore(ticker, catalystInfo). When `available === false`
     *  the data package emits "N/A — insufficient history" rather than the
     *  fallback numbers, so the validators never reason on fake regression
     *  output. */
    ioScore?: IOScoreResult | null;

    // ── Macro regime (global, 5-min cache) ────────────────────────────────
    regime?: StructuredRegime | null;

    // ── Polygon flow (EOD per-strike aggregates) ──────────────────────────
    polygonHighlights?: PolygonFlowHighlights | null;

    // ── Live options chain summary (Schwab primary, Polygon fallback) ─────
    chainSummary?: ChainSummary | null;
    chainSource?: ChainSource | null;

    // ── Equity-daily extras (iv30d, hv20d, IV/HV, sma, atr, RS, 52w) ──────
    equityExtras?: EquityDailyExtras | null;
  } | null;
}

export interface ValidationVerdictPayload {
  verdict: ValidationVerdict;
  confidence: number; // 0-100
  reasoningBullets: string[];
  risks: string[];
  improvements: string[]; // empty when verdict === PROCEED
  bullConfidence: number;
  bearConfidence: number;
  trace: WebSearchTrace;
}

// Transcript-shape used by the existing /thinking/:jobId poller.
export type ValidationTurn = {
  id: string;
  round: 1 | 2 | 3 | "synthesis";
  role: "A" | "B" | "synthesis" | "system";
  phase: "propose" | "critique" | "final" | "synthesis" | "info";
  model: string;
  label: string;
  text: string;
  ts: number;
  done: boolean;
};

export interface ValidationCallbacks {
  onStatus?: (s: string) => void;
  onTurnStart?: (turn: { id: string; round: ValidationTurn["round"]; role: ValidationTurn["role"]; phase: ValidationTurn["phase"]; model: string; label: string; startedAt: number }) => void;
  onTurnDelta?: (turnId: string, delta: string) => void;
  onTurnDone?: (turnId: string, finalText: string) => void;
}

// ────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT — validation-specific. Reuses identity & web-search mandate
// from the main strategist prompt but replaces OUTPUT FORMAT to be a verdict,
// not a trade structure.
// ────────────────────────────────────────────────────────────────────────────
const VALIDATION_SYSTEM_PROMPT = `## IDENTITY

You are a senior options trader on a discretionary prop desk at a firm like Jane Street or SIG. You came up as a volatility trader at a tier-one quant shop, where you learned to think in Greeks, vol surface dynamics, skew, term structure, and probability rather than in simple directional bias.

Today your role is **trade validator**. A trader has built a specific options or equity ticket and is asking the desk for a sanity check before sending it to the broker. You are not designing a trade from scratch. You are evaluating the exact trade in front of you on its own merits, and recommending PROCEED, PROCEED WITH CAUTION, or DO NOT PROCEED.

## WEB SEARCH MANDATE (NON-NEGOTIABLE)

Web search is enabled and you MUST use it on every validation BEFORE producing your verdict. At minimum:

1. \`<TICKER> news today\` and \`<TICKER> news <TODAY_DATE>\` — same-day catalysts.
2. \`<TICKER> analyst upgrade downgrade price target\` (last 7 days).
3. \`<TICKER> earnings\` if earnings within 14 days.
4. Sector / competitor moves obviously driving the tape.

If a same-day catalyst clearly contradicts the trade direction, that is grounds for DO_NOT_PROCEED unless the trader's thesis explicitly addresses it.

## SAME-DAY MOVE AWARENESS

If the ticker is moving > 3% on the day, your verdict MUST reference what is driving the move. Validating a trade while ignoring a 5%+ same-day move is unacceptable.

## GROUNDING DISCIPLINE

- Every number you cite about the trade (strike, expiration, limit price, quantity) must match the ticket exactly. Do not round, paraphrase, or invent legs.
- When you reference outside information (news, earnings, analyst actions, sector dynamics) briefly cite the source.
- If something you want to evaluate is not in the ticket and not in search results, say so — do not guess.
- For canonical market scalars (IV Rank, P/C ratio, 30-day IV, 20-day HV, IV/HV ratio, beta, days-to-earnings, Polygon flow P/C) you MAY use the literal placeholder syntax in your narrative — \`{{IVR}}\`, \`{{PC_RATIO}}\`, \`{{IV30}}\`, \`{{HV20}}\`, \`{{IVHV}}\`, \`{{BETA}}\`, \`{{EARNINGS_DAYS}}\`, \`{{PC_RATIO_FLOW}}\` — and the server will substitute the canonical value before the user sees the text. If you cite a numeric value for these fields directly, it MUST exactly match what the data package shows. Do NOT invent a different number.

## WHAT YOU EVALUATE

Opening tickets: technical setup, valuation context, structure quality (DTE, strike selection, debit/credit choice), liquidity (bid-ask spread, OI), implied vol context, macro/regime fit, position sizing, execution timing, risk/reward.

Closing tickets: is this the right moment to exit? Is the original thesis still intact, or has it broken? Is the trader clipping winners early, panic-selling losers, or correctly cutting a thesis that died? Was there a clear catalyst that changed the picture?

## OUTPUT FORMAT

You will be told whether you are arguing the BULL or BEAR side and which round you are in. Each round has its own JSON schema specified in the user prompt — follow it exactly. No markdown fences, no extra prose.

You are ruthlessly honest. If the trade is bad, say so. If the trade is good and the other side is reaching, say that too. Inflated arguments to "win" the debate produce bad live trades.`;

// ────────────────────────────────────────────────────────────────────────────
// PERSONAS
// ────────────────────────────────────────────────────────────────────────────
const BULL_VALIDATOR_ENTRY = `## DEBATE ROLE: BULL VALIDATOR (defending entry)

You are arguing **FOR** taking this specific trade as built. You are not the bull on the underlying — you are the bull on the trader's exact ticket. Your job is to articulate the strongest honest case for why this entry is good: thesis, structure, strike selection, expiration, debit/credit choice, timing, risk/reward, edge vs. cost.

You may concede legitimate weaknesses. If the trade is genuinely bad you will say so and dial confidence below 30 — better to lose the debate than rubber-stamp a bad trade.`;

const BEAR_VALIDATOR_ENTRY = `## DEBATE ROLE: BEAR VALIDATOR (challenging entry)

You are arguing **AGAINST** taking this specific trade as built. Your job is to find the strongest honest reasons NOT to enter: weak thesis, wrong structure for the regime, bad strike, wrong DTE, paying too much premium, overpaying for skew, fighting flow, ignoring an obvious catalyst, overconcentration, poor liquidity, etc.

You may concede the trade is reasonable if it genuinely is. If you cannot find serious objections, say so and dial confidence below 30 — better to clear a good trade than block it on weak grounds.`;

const BULL_VALIDATOR_EXIT = `## DEBATE ROLE: BULL VALIDATOR (defending stay-in)

The trader is closing a position. You argue **AGAINST** the close — the original thesis is intact, do not clip a winner early, do not panic-sell a paper loss, give the trade time to work. Use the entry price, current P&L, days held, and what has happened since entry. If the catalyst has not actually changed, the right move is usually to stay in.

You may concede a close is correct if the thesis is genuinely dead. If the trade should clearly be cut, say so and dial confidence below 30.`;

const BEAR_VALIDATOR_EXIT = `## DEBATE ROLE: BEAR VALIDATOR (defending close)

The trader is closing a position. You argue **FOR** the close — the original thesis is broken, price action confirms the bear case, macro shifted, time decay is winning, take it off and redeploy capital. Use entry price, P&L, days held, what changed.

You may concede the trade should stay on if the thesis genuinely still has gas. If the close is clearly correct, you defend it; if the close is premature, say so and dial confidence below 30.`;

// ────────────────────────────────────────────────────────────────────────────
// PROMPTS
// ────────────────────────────────────────────────────────────────────────────
const ROUND_1 = (today: string, side: "BULL" | "BEAR", mode: ValidationMode, dataPackage: string) => {
  const action = mode === "opening"
    ? (side === "BULL" ? "the strongest case FOR entering this exact trade" : "the strongest case AGAINST entering this exact trade")
    : (side === "BULL" ? "the strongest case AGAINST closing this position now" : "the strongest case FOR closing this position now");
  return `Today is ${today}. PHASE 1 / ROUND 1 — initial pitch. You are the **${side}** validator. Run web searches per the WEB SEARCH MANDATE first, then deliver ${action} based on the data below.

Output ONLY this JSON object — no markdown fences, no prose:
{
  "side": "${side}",
  "thesis": "<3-6 sentences: your strongest honest argument>",
  "keyPoints": ["<bullet>", "<bullet>", "<3-5 most important supporting points>"],
  "biggestCounter": "<1-2 sentences: the strongest argument the other side will make>",
  "confidence": <integer 0-100, calibrated honestly to how strong your case actually is>
}

Calibration rule: if the data is genuinely against your assigned side, set confidence below 30 and say so in biggestCounter. Inflated confidence to "win" produces bad trades.

DATA PACKAGE:
${dataPackage}`;
};

const ROUND_2 = (side: "BULL" | "BEAR", myR1: string, otherR1: string) =>
  `PHASE 1 / ROUND 2 — rebuttal. You are still the **${side}** validator. STAY IN ROLE. The other side has now made their case. Address their strongest point, defend yours, concede where genuinely weak, and revise your confidence.

Output ONLY this JSON object — no fences, no prose:
{
  "side": "${side}",
  "rebuttal": "<2-4 sentences directly addressing the other side's strongest point>",
  "concession": "<1 sentence: any point of theirs that is genuinely valid, or 'none'>",
  "revisedConfidence": <integer 0-100>
}

YOUR ROUND-1:
${myR1}

OTHER SIDE'S ROUND-1:
${otherR1}`;

const ROUND_3 = (side: "BULL" | "BEAR", mode: ValidationMode, myR1: string, myR2: string, otherR1: string, otherR2: string) =>
  `PHASE 2 / ROUND 3 — final verdict. You are still the **${side}** validator. The directional debate is complete. Now deliver your final verdict on this specific trade.

Output ONLY this JSON object — no fences, no prose:
{
  "side": "${side}",
  "finalVerdict": "PROCEED" | "PROCEED_WITH_CAUTION" | "DO_NOT_PROCEED",
  "finalConfidence": <integer 0-100, your honest confidence in finalVerdict>,
  "reasoningBullets": ["<bullet>", "<bullet>", "<2-4 concise bullets justifying your verdict>"],
  "topRisks": ["<bullet>", "<bullet>", "<1-3 concrete risks the trader must accept>"],
  "improvements": ["<bullet>", "<bullet>", "<0-3 concrete suggestions to improve the trade ${mode === "opening" ? "(different strike, different expiration, wait for pullback, reduce size, switch to credit/debit, etc.)" : "(stay in until catalyst X, scale out partial, set tighter stop, etc.)"} — empty array if you said PROCEED>"]
}

Calibration: a BULL validator can absolutely return PROCEED_WITH_CAUTION or DO_NOT_PROCEED if the trade is genuinely flawed even though they argued for it. A BEAR can return PROCEED if their objections were rebutted. Honesty over loyalty to your assigned side.

YOUR ROUND-1:
${myR1}

YOUR ROUND-2:
${myR2}

OTHER SIDE'S ROUND-1:
${otherR1}

OTHER SIDE'S ROUND-2:
${otherR2}`;

// ────────────────────────────────────────────────────────────────────────────
// DATA PACKAGE BUILDER
// ────────────────────────────────────────────────────────────────────────────
function fmtNum(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function buildDataPackage(input: ValidationInput): string {
  const t = input.ticket;
  const lines: string[] = [];
  lines.push(`## TRADE TICKET UNDER VALIDATION`);
  lines.push(`Ticker: ${t.ticker}`);
  const hasStockLeg = !!(t.stockLeg && t.stockLeg.quantity > 0);
  const assetLabel = hasStockLeg
    ? "STOCK + OPTIONS (combined order)"
    : (t.isOption ? (t.isMultiLeg ? "OPTIONS (multi-leg)" : "OPTIONS (single)") : "EQUITY");
  lines.push(`Asset: ${assetLabel}`);
  lines.push(`Intent: ${t.mode === "opening" ? "OPEN new position" : "CLOSE existing position"}`);
  if (t.side) lines.push(`Side: ${t.side}`);
  lines.push(`Order type: ${t.orderType}${t.duration ? ` · ${t.duration}` : ""}`);
  if (!hasStockLeg) {
    // When a stock leg is present, t.quantity duplicates the share count and
    // would be misread as "contracts" — the per-leg breakdown below carries
    // the authoritative quantities, so we suppress this line in mixed mode.
    lines.push(`Quantity: ${t.quantity} ${t.isOption ? "contract(s)" : "share(s)"}`);
  }
  if (t.limitPrice != null) lines.push(`Limit price: ${fmtNum(t.limitPrice)}`);
  if (t.netPrice != null) lines.push(`Net price (spread): ${fmtNum(t.netPrice)} (${t.isCredit ? "CREDIT" : "DEBIT"})`);

  const hasOptionLegs = !!(t.legs && t.legs.length > 0);
  if (hasStockLeg || hasOptionLegs) {
    lines.push(``);
    lines.push(`## LEGS`);
    if (hasStockLeg) {
      const sl = t.stockLeg!;
      const px = sl.limitPrice != null ? ` @ ${fmtNum(sl.limitPrice)}` : "";
      lines.push(
        `Stock leg: ${sl.instruction} ${sl.quantity} share(s) of ${t.ticker}${px}`,
      );
    }
    if (hasOptionLegs) {
      t.legs!.forEach((leg, i) => {
        const parts = [
          `Option leg ${i + 1}:`,
          leg.instruction,
          leg.quantity != null ? `qty ${leg.quantity}` : "",
          leg.strike != null ? `${leg.strike} ${leg.optionType ?? ""}` : "",
          leg.expiration ? `exp ${leg.expiration}` : "",
          leg.bid != null && leg.ask != null ? `bid ${fmtNum(leg.bid)}/ask ${fmtNum(leg.ask)}` : "",
          leg.delta != null ? `Δ ${fmtNum(leg.delta, 3)}` : "",
        ].filter(Boolean);
        lines.push(parts.join(" "));
      });
    }

    // ── Combined-position label so the LLM cannot ignore the share leg ──
    // We always emit this section when both stock and option legs are present
    // — even if no specific named structure is detected. This guarantees the
    // model sees a hard "evaluate as combined position" directive instead of
    // silently treating the option leg in isolation.
    if (hasStockLeg && hasOptionLegs) {
      const sl = t.stockLeg!;
      const stockSide = sl.instruction === "BUY" ? "long" : "short";
      const labels: string[] = [];

      // Detect multi-leg structures FIRST so they aren't swallowed by the
      // simpler per-leg branches below.
      const longPuts = t.legs!.filter(l => l.optionType === "PUT" && (l.instruction || "").toUpperCase().startsWith("BUY"));
      const shortCalls = t.legs!.filter(l => l.optionType === "CALL" && (l.instruction || "").toUpperCase().startsWith("SELL"));

      const matched = new Set<ValidationLeg>();

      if (stockSide === "long" && longPuts.length > 0 && shortCalls.length > 0) {
        labels.push(`COLLAR — ${sl.quantity} long shares + ${longPuts.reduce((s, l) => s + (l.quantity ?? 1), 0)} long put(s) + ${shortCalls.reduce((s, l) => s + (l.quantity ?? 1), 0)} short call(s).`);
        for (const l of longPuts) matched.add(l);
        for (const l of shortCalls) matched.add(l);
      }

      // Per-leg structure detection for the remaining unmatched legs.
      for (const leg of t.legs!) {
        if (matched.has(leg) || !leg.optionType) continue;
        const isShortOpt = (leg.instruction || "").toUpperCase().startsWith("SELL");
        const isLongOpt = (leg.instruction || "").toUpperCase().startsWith("BUY");
        const contracts = leg.quantity ?? 1;
        if (stockSide === "long" && isLongOpt && leg.optionType === "PUT") {
          labels.push(`MARRIED / PROTECTIVE PUT — ${sl.quantity} long shares + ${contracts} long put(s).`);
        } else if (stockSide === "long" && isShortOpt && leg.optionType === "CALL") {
          labels.push(`COVERED CALL / BUY-WRITE — ${sl.quantity} long shares + ${contracts} short call(s).`);
        } else if (stockSide === "short" && isShortOpt && leg.optionType === "PUT") {
          labels.push(`COVERED PUT — ${sl.quantity} short shares + ${contracts} short put(s).`);
        } else if (stockSide === "short" && isLongOpt && leg.optionType === "CALL") {
          labels.push(`PROTECTIVE CALL — ${sl.quantity} short shares + ${contracts} long call(s).`);
        }
      }

      lines.push(``);
      lines.push(`## COMBINED-ORDER STRUCTURE (this single ticket)`);
      lines.push(
        `This order combines a STOCK leg (${sl.instruction} ${sl.quantity} share(s) of ${t.ticker}) with ${t.legs!.length} OPTION leg(s) above.`,
      );
      if (labels.length > 0) {
        for (const l of labels) lines.push(`- ${l}`);
      } else {
        lines.push(`- Structure: custom stock+options combination (no canonical name detected).`);
      }
      lines.push(`You MUST evaluate the order as the combined position above. Reasoning that addresses only the option leg(s) is incomplete and counts as a failed validation.`);
    }
  }

  lines.push(``);
  lines.push(`## ECONOMICS`);
  if (t.estMaxRisk != null) lines.push(`Est. max risk: ${fmtNum(t.estMaxRisk)}`);
  if (t.estMaxProfit != null) lines.push(`Est. max profit: ${fmtNum(t.estMaxProfit)}`);
  if (t.breakeven != null) lines.push(`Breakeven: ${fmtNum(t.breakeven)}`);
  if (t.estMaxRisk && t.estMaxProfit && t.estMaxRisk > 0) {
    lines.push(`R:R ≈ ${fmtNum(t.estMaxProfit / t.estMaxRisk, 2)}:1`);
  }

  if (t.underlyingPrice != null || t.underlyingChangePct != null) {
    lines.push(``);
    lines.push(`## UNDERLYING SNAPSHOT`);
    if (t.underlyingPrice != null) lines.push(`Last: ${fmtNum(t.underlyingPrice)}`);
    if (t.underlyingChangePct != null) lines.push(`Day change: ${fmtNum(t.underlyingChangePct, 2)}%`);
  }

  // ── EXISTING SHARES (covered / married / protective context) ──────────────
  // The trader may already hold shares of the same underlying. This radically
  // changes the risk profile of any option leg the ticket adds. If you ignore
  // this block you will mis-evaluate covered calls, covered puts, married
  // puts, protective puts, and assignment-cover trades.
  if (t.underlyingShares && t.underlyingShares.quantity > 0) {
    const us = t.underlyingShares;
    lines.push(``);
    lines.push(`## EXISTING UNDERLYING SHARES POSITION (already in account)`);
    lines.push(
      `${us.side.toUpperCase()} ${us.quantity} shares of ${t.ticker}` +
      (us.averagePrice != null ? ` @ avg cost ${fmtNum(us.averagePrice)}` : "") +
      (us.marketValue != null ? ` (market value ${fmtNum(us.marketValue)})` : ""),
    );

    // Heuristic coverage label so the LLM cannot miss the structure.
    const coverageLabels: string[] = [];
    if (t.legs && t.legs.length > 0) {
      for (const leg of t.legs) {
        if (!leg.optionType) continue;
        const isShort = (leg.instruction || "").toUpperCase().startsWith("SELL");
        const isLong = (leg.instruction || "").toUpperCase().startsWith("BUY");
        const contracts = leg.quantity ?? t.quantity ?? 1;
        const sharesCovered = contracts * 100;
        if (us.side === "long" && isShort && leg.optionType === "CALL") {
          coverageLabels.push(`COVERED CALL — ${us.quantity} long shares vs ${contracts} short calls (${sharesCovered} shares covered).`);
        } else if (us.side === "long" && isLong && leg.optionType === "PUT") {
          coverageLabels.push(`MARRIED / PROTECTIVE PUT — ${us.quantity} long shares hedged by ${contracts} long puts (${sharesCovered} shares hedged).`);
        } else if (us.side === "short" && isShort && leg.optionType === "PUT") {
          coverageLabels.push(`COVERED PUT — ${us.quantity} short shares paired with ${contracts} short puts (${sharesCovered} shares).`);
        } else if (us.side === "short" && isLong && leg.optionType === "CALL") {
          coverageLabels.push(`PROTECTIVE CALL — ${us.quantity} short shares hedged by ${contracts} long calls (${sharesCovered} shares hedged).`);
        }
      }
    }
    if (coverageLabels.length > 0) {
      lines.push(`Detected coverage:`);
      for (const cl of coverageLabels) lines.push(`  • ${cl}`);
    }
    lines.push(
      `You MUST evaluate this trade as a combined position (shares + this ticket), not just the option leg(s) in isolation. If your reasoning does not address the share leg you have failed the validation.`,
    );
  }

  if (t.mode === "closing") {
    lines.push(``);
    lines.push(`## CLOSING CONTEXT`);
    if (t.currentEntryPrice != null) lines.push(`Original entry price: ${fmtNum(t.currentEntryPrice)}`);
    if (t.currentPnl != null) lines.push(`Current P&L: ${fmtNum(t.currentPnl)}`);
    if (t.daysHeld != null) lines.push(`Days held: ${t.daysHeld}`);
  }

  // ── VOL CONTEXT ────────────────────────────────────────────────────────
  // Canonical IVR from equity_daily.ivr (same source the per-ticker
  // strategist and scanner use). Server-fetched so the model sees an
  // authoritative number rather than reaching for placeholder syntax.
  const mc = input.marketContext;
  if (mc && mc.ivr != null && Number.isFinite(mc.ivr)) {
    const ivrInt = Math.round(mc.ivr);
    let band: string;
    if (ivrInt < 30) band = "LOW (favors debit structures — premium is cheap)";
    else if (ivrInt < 50) band = "BELOW-AVERAGE (slight debit lean)";
    else if (ivrInt < 70) band = "ELEVATED (slight credit lean)";
    else band = "HIGH (favors credit structures — premium is rich, IV-crush risk on long premium)";
    lines.push(``);
    lines.push(`## VOL CONTEXT`);
    lines.push(`IVR (IV Rank, 252-day, 0-100): ${ivrInt} — ${band}`);
    if (mc.ivrAsOfDate) lines.push(`IVR as of: ${mc.ivrAsOfDate}`);
    if (mc.ivrSource) {
      const sourceNote = mc.ivrSource === "hv_proxy"
        ? "hv_proxy (derived from realized vol × VRP — true IV often runs 5-15% higher; lean slightly toward credits in low-IVR proxy reads, demand stronger directional thesis before paying premium)"
        : `${mc.ivrSource} (treat with full confidence)`;
      lines.push(`IVR source: ${sourceNote}`);
    }
    lines.push(`Cite IVR in your reasoning when it's relevant to debit-vs-credit choice or IV-crush risk. Use the literal value above; do NOT invent a different number.`);
  }

  // ── VOL EXTRAS (iv30d / hv20d / IV-vs-HV richness) ──────────────────────
  // Pulled from equity_daily.iv_30d / hv_20d / hv_30d. Decimals on disk
  // (0.41 = 41%). Skipped silently when the row is missing — better to
  // omit than fabricate. IV/HV ratio is computed in the helper.
  const ex = mc?.equityExtras ?? null;
  if (ex && (ex.iv30d != null || ex.hv20d != null || ex.hv30d != null || ex.ivHvRatio != null)) {
    lines.push(``);
    lines.push(`## VOL EXTRAS`);
    if (ex.iv30d   != null) lines.push(`30-day IV: ${(ex.iv30d  * 100).toFixed(1)}%${ex.iv30dProxy != null && ex.iv30d === ex.iv30dProxy ? " (proxy — derived from HV × VRP, true IV may run 5-15% higher)" : ""}`);
    if (ex.hv20d   != null) lines.push(`20-day HV: ${(ex.hv20d  * 100).toFixed(1)}%`);
    if (ex.hv30d   != null) lines.push(`30-day HV: ${(ex.hv30d  * 100).toFixed(1)}%`);
    if (ex.ivHvRatio != null) {
      const richness = ex.ivHvRatio >= 1.3
        ? "RICH (IV materially above realized — favors premium selling)"
        : ex.ivHvRatio <= 0.85
          ? "CHEAP (IV at or below realized — long premium under-priced for the actual move)"
          : "FAIR";
      lines.push(`IV/HV ratio: ${ex.ivHvRatio.toFixed(2)} — ${richness}`);
    }
    if (ex.asOfDate) lines.push(`As of: ${ex.asOfDate}`);
  }

  // ── TECHNICALS (sma20, atr20, RS, momentum, 52-week range) ──────────────
  if (ex && (ex.sma20 != null || ex.atr20 != null || ex.rsRatio != null
          || ex.priceChangePct5d != null || ex.priceChangePct10d != null
          || ex.fiftyTwoWeekHigh != null || ex.fiftyTwoWeekLow != null)) {
    lines.push(``);
    lines.push(`## TECHNICALS`);
    if (ex.close != null) lines.push(`Latest close: ${fmtNum(ex.close)}`);
    if (ex.sma20 != null) {
      const vsClose = ex.close != null
        ? ` (close is ${ex.close >= ex.sma20 ? "above" : "below"} SMA20 by ${fmtNum(Math.abs(ex.close - ex.sma20))})`
        : "";
      lines.push(`20-day SMA: ${fmtNum(ex.sma20)}${vsClose}`);
    }
    if (ex.atr20 != null) {
      const atrPct = ex.close != null && ex.close > 0 ? ` (${(ex.atr20 / ex.close * 100).toFixed(2)}% of price)` : "";
      lines.push(`20-day ATR: ${fmtNum(ex.atr20)}${atrPct}`);
    }
    if (ex.rsRatio != null) {
      const rsCall = ex.rsRatio > 1 ? "outperforming SPY" : ex.rsRatio < 1 ? "underperforming SPY" : "tracking SPY";
      lines.push(`RS vs SPY: ${ex.rsRatio.toFixed(3)} (${rsCall})`);
    }
    if (ex.priceChangePct5d  != null) lines.push(`5-day price change: ${(ex.priceChangePct5d  * 100).toFixed(2)}%`);
    if (ex.priceChangePct10d != null) lines.push(`10-day price change: ${(ex.priceChangePct10d * 100).toFixed(2)}%`);
    if (ex.fiftyTwoWeekHigh != null && ex.fiftyTwoWeekLow != null) {
      const pctOffHigh = ex.close != null && ex.fiftyTwoWeekHigh > 0
        ? ` (${((ex.close - ex.fiftyTwoWeekHigh) / ex.fiftyTwoWeekHigh * 100).toFixed(1)}% from 52w high)` : "";
      lines.push(`52-week range: ${fmtNum(ex.fiftyTwoWeekLow)} → ${fmtNum(ex.fiftyTwoWeekHigh)}${pctOffHigh}`);
    }
  }

  // ── OPTIONS CHAIN SNAPSHOT (Schwab primary, Polygon fallback) ───────────
  // ATM bid/ask/IV give a feel for the live spread + IV that the bull/bear
  // are trading against. Top-volume strikes signal where flow is leaning.
  // Term structure (front vs back IV) tells the model whether vol is in
  // backwardation (event-driven) or contango (normal). P/C ratio here is
  // the chain-derived ratio — distinct from the Polygon EOD ratio below.
  const cs = mc?.chainSummary ?? null;
  if (cs) {
    lines.push(``);
    lines.push(`## OPTIONS CHAIN SNAPSHOT${mc?.chainSource ? ` (source: ${mc.chainSource})` : ""}`);
    lines.push(`ATM strike: ${fmtNum(cs.atmStrike)}`);
    // ChainSummary IVs are ALREADY percent values (summarizeOptionsChain
    // calls ivToPct → e.g. 41.25 means 41.25%). Do NOT multiply by 100
    // here — that produced 4125% in earlier drafts.
    const ivRender = (iv: number) => iv > 0 && Number.isFinite(iv) ? `${iv.toFixed(1)}%` : "—";
    lines.push(`ATM call: bid ${fmtNum(cs.atmCallBid)} / ask ${fmtNum(cs.atmCallAsk)} / IV ${ivRender(cs.atmCallIV)} / OI ${cs.atmCallOI}`);
    lines.push(`ATM put : bid ${fmtNum(cs.atmPutBid)} / ask ${fmtNum(cs.atmPutAsk)} / IV ${ivRender(cs.atmPutIV)} / OI ${cs.atmPutOI}`);
    if (cs.frontMonthIV != null && cs.backMonthIV != null) {
      const term = cs.frontMonthIV > cs.backMonthIV
        ? "BACKWARDATION (front > back — typically event-driven)"
        : cs.frontMonthIV < cs.backMonthIV
          ? "CONTANGO (back > front — normal term structure)"
          : "FLAT";
      lines.push(`Term structure: front IV ${ivRender(cs.frontMonthIV)} vs back IV ${ivRender(cs.backMonthIV)} → ${term}`);
    }
    if (Number.isFinite(cs.putCallVolumeRatio) && cs.putCallVolumeRatio > 0) {
      const pcCall = cs.putCallVolumeRatio < 0.7 ? "call-skewed" : cs.putCallVolumeRatio > 1.3 ? "put-skewed" : "balanced";
      lines.push(`P/C volume (chain): ${cs.putCallVolumeRatio.toFixed(2)} (${pcCall})`);
    }
    if (cs.topVolumeCalls.length > 0) {
      lines.push(`Top call volume: ${cs.topVolumeCalls.slice(0, 3).map(c => `${c.strike}c ${c.expiration} (vol ${c.volume}, OI ${c.oi})`).join(" | ")}`);
    }
    if (cs.topVolumePuts.length > 0) {
      lines.push(`Top put volume : ${cs.topVolumePuts.slice(0, 3).map(p => `${p.strike}p ${p.expiration} (vol ${p.volume}, OI ${p.oi})`).join(" | ")}`);
    }
    if (cs.unusualActivity.length > 0) {
      lines.push(`Unusual vol/OI: ${cs.unusualActivity.slice(0, 3).map(u => `${u.strike}${u.type[0]} ${u.expiration} (vol/OI ${u.volOiRatio.toFixed(1)}×)`).join(" | ")}`);
    }
  }

  // ── POLYGON OPTIONS FLOW (EOD per-strike aggregates) ───────────────────
  // Distinct from chain snapshot above — this is end-of-day flow data with
  // a 5-calendar-day staleness ceiling enforced upstream. When unusual
  // skew is "bullish" or "bearish", that's a real directional flow signal.
  const ph = mc?.polygonHighlights ?? null;
  if (ph) {
    lines.push(``);
    lines.push(`## OPTIONS FLOW (Polygon EOD, as of ${ph.asOfDate})`);
    lines.push(`Total call volume: ${ph.totalCallVolume.toLocaleString()} | Total put volume: ${ph.totalPutVolume.toLocaleString()}`);
    if (ph.putCallVolumeRatio > 0) {
      lines.push(`P/C volume (flow): ${ph.putCallVolumeRatio.toFixed(2)}`);
    }
    if (ph.unusualStrikeCount > 0) {
      lines.push(`Unusual strikes: ${ph.unusualStrikeCount} (calls ${ph.unusualCallVolume.toLocaleString()} / puts ${ph.unusualPutVolume.toLocaleString()}) — skew: ${ph.unusualSkew.toUpperCase()}`);
    } else {
      lines.push(`Unusual activity: none flagged`);
    }
    if (ph.topByVolume.length > 0) {
      lines.push(`Top by volume: ${ph.topByVolume.slice(0, 3).map(s => `${s.strike}${s.optionType[0]} ${s.expiration} (vol ${s.volume.toLocaleString()}, OI ${s.openInterest.toLocaleString()})`).join(" | ")}`);
    }
    if (ph.topByVolOiRatio.length > 0) {
      lines.push(`Top by vol/OI: ${ph.topByVolOiRatio.slice(0, 3).map(s => `${s.strike}${s.optionType[0]} ${s.expiration} (${s.volOiRatio.toFixed(1)}×)`).join(" | ")}`);
    }
  }

  // ── CATALYSTS (earnings + macro + residual + scope) ─────────────────────
  // The catalystEvaluator returns a unified picture: in-window earnings,
  // FOMC dates, macro releases, residual catalysts (post-window risk that
  // still affects vol now). nextEarnings layers in EPS/revenue estimates
  // that the catalyst block alone does not surface.
  const cat = mc?.catalyst ?? null;
  const ne  = mc?.nextEarnings ?? null;
  if (cat || ne) {
    lines.push(``);
    lines.push(`## CATALYSTS`);
    if (cat) {
      lines.push(`In-window catalyst: ${cat.catalystInWindow ? "YES" : "no"} | type: ${cat.catalystType} | scope: ${cat.catalystScope} | alignment: ${cat.catalystAlignment}`);
      if (cat.catalystDate) lines.push(`Catalyst date: ${cat.catalystDate}`);
      if (cat.catalystSummary) lines.push(`Summary: ${cat.catalystSummary}`);
      if (cat.residualCatalyst) {
        lines.push(`Residual (post-expiry) catalyst: ${cat.residualCatalyst.type ?? "unknown"}${cat.residualCatalyst.date ? ` on ${cat.residualCatalyst.date}` : ""}`);
      }
      if (cat.scheduledEvents && cat.scheduledEvents.length > 0) {
        lines.push(`Scheduled events: ${cat.scheduledEvents.slice(0, 5).map(e => `${e.type}@${e.date}`).join(", ")}`);
      }
    }
    if (ne && (ne.epsEstimate || ne.revenueEstimate || ne.daysAway != null)) {
      const parts: string[] = [];
      if (ne.daysAway != null) parts.push(`{{EARNINGS_DAYS}} days away`);
      if (ne.time) parts.push(`time: ${ne.time}`);
      if (ne.epsEstimate) parts.push(`EPS est ${ne.epsEstimate}${ne.epsPrior ? ` (prior ${ne.epsPrior})` : ""}`);
      if (ne.revenueEstimate) parts.push(`Rev est ${ne.revenueEstimate}${ne.revenuePrior ? ` (prior ${ne.revenuePrior})` : ""}`);
      if (parts.length > 0) lines.push(`Next earnings: ${parts.join(" | ")}${ne.confirmed === false ? " (unconfirmed)" : ""}`);
      if (ne.lastEarningsDate && ne.lastEarningsDaysSince != null) {
        lines.push(`Last earnings: ${ne.lastEarningsDate} (${ne.lastEarningsDaysSince}d ago)`);
      }
    }
  }

  // ── IO SCORE (idiosyncratic-vs-macro classification) ────────────────────
  // computeIOScore returns `available: false` when there's not enough
  // history — surface that honestly rather than the fallback regression
  // numbers, which would mislead the validators into reasoning on noise.
  const io = mc?.ioScore ?? null;
  if (io) {
    lines.push(``);
    lines.push(`## IO SCORE`);
    if (io.available === false) {
      lines.push(`IO Score: N/A — insufficient history (equityDays=${io.dataAvailability.equityDays}, spyDays=${io.dataAvailability.spyDays}, pairs=${io.dataAvailability.pairs}). Treat this name as having no idiosyncratic-vs-macro signal; do NOT cite a beta or residual Z below.`);
    } else {
      lines.push(`IO Score: ${io.final.toFixed(1)} → classification: ${io.classification}`);
      lines.push(`Beta vs SPY: {{BETA}} | Residual return Z (recent): ${io.residualReturnZScore.toFixed(2)} | R²: ${io.components.marketIndependence.rSquared.toFixed(3)}`);
      if (io.components.flowDivergence) {
        lines.push(`Flow divergence: vol/OI ${io.components.flowDivergence.volOiRatio.toFixed(2)}, skew div ${io.components.flowDivergence.skewDivergence.toFixed(3)}, final ${io.components.flowDivergence.final.toFixed(2)}`);
      }
    }
  }

  // ── MACRO REGIME (global, 5-min cache) ──────────────────────────────────
  const reg = mc?.regime ?? null;
  if (reg) {
    lines.push(``);
    lines.push(`## MACRO REGIME`);
    lines.push(`Directional: ${reg.directionalConviction} | Systemic risk: ${reg.systemicRiskLevel} | Correlation: ${reg.correlationRegime}`);
    lines.push(`Composite score: ${reg.compositeScore.toFixed(2)}${reg.idioOpportunityFlag ? " | IDIO OPPORTUNITY FLAG: ON (low correlation environment favors single-name plays)" : ""}`);
    lines.push(`Updated: ${reg.updatedAt}`);
  }

  if (input.thesis && input.thesis.trim().length > 0) {
    lines.push(``);
    lines.push(`## TRADER THESIS (verbatim, user-supplied)`);
    lines.push(input.thesis.trim().slice(0, 2000));
  }

  if (input.rollingShort) {
    lines.push(``);
    lines.push(`## ROLLING-SHORT FLAG`);
    lines.push(`Trader has flagged this as a rolling-short structure: the short leg expires before the long leg. Treat this as an explicit calendar/diagonal intent — evaluate accordingly. The trader plans to roll the short leg forward at expiration to harvest theta against the long.`);
  }

  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// MODEL STREAMING
// ────────────────────────────────────────────────────────────────────────────
const TEMPERATURE = 0;

async function streamModel(
  modelOpt: StrategistModelOption,
  systemPrompt: string,
  prompt: string,
  onDelta: (text: string) => void,
  onStatus?: (s: string) => void,
): Promise<WebSearchResult> {
  if (modelOpt.provider === "anthropic") {
    return streamCallAnthropicWithSystemAndWebSearch(
      modelOpt.model, TEMPERATURE, systemPrompt, prompt, onDelta, onStatus,
    );
  }
  if (modelOpt.provider === "openai") {
    return streamCallOpenAIWithSystemAndWebSearch(
      modelOpt.model, TEMPERATURE, systemPrompt, prompt, onDelta, onStatus,
    );
  }
  return streamCallGeminiWithSystemAndWebSearch(
    modelOpt.model, TEMPERATURE, systemPrompt, prompt, onDelta, onStatus,
  );
}

let turnSeq = 0;
function newTurnId(): string {
  turnSeq += 1;
  return `vt_${Date.now().toString(36)}_${turnSeq}`;
}

async function runTurn(args: {
  modelOpt: StrategistModelOption;
  systemPrompt: string;
  prompt: string;
  round: ValidationTurn["round"];
  role: ValidationTurn["role"];
  phase: ValidationTurn["phase"];
  callbacks?: ValidationCallbacks;
  // Canonical scalars used to scrub hallucinated `{{IVR}}` / `{{PC_RATIO}}`
  // / `{{IV30}}` / `{{HV20}}` / `{{IVHV}}` / `{{BETA}}` / `{{EARNINGS_DAYS}}`
  // / `{{PC_RATIO_FLOW}}` tokens out of the model output before it lands in
  // the transcript and before JSON parsing. Same scrubber the StrategistV2
  // narrative pipeline uses; null fields = no-op for that field (token
  // survives, which is the correct truthful signal that we have no
  // canonical to substitute).
  scrubCanonical?: ScrubCanonical;
}): Promise<{ text: string; trace: WebSearchTrace; turnId: string }> {
  const { modelOpt, systemPrompt, prompt, round, role, phase, callbacks, scrubCanonical } = args;
  const turnId = newTurnId();
  callbacks?.onTurnStart?.({
    id: turnId, round, role, phase,
    model: modelOpt.model, label: modelOpt.label, startedAt: Date.now(),
  });
  let acc = "";
  const onDelta = (delta: string) => { acc += delta; callbacks?.onTurnDelta?.(turnId, delta); };
  try {
    const r = await streamModel(modelOpt, systemPrompt, prompt, onDelta, (s) => callbacks?.onStatus?.(s));
    let finalText = r.text;
    // Always run the scrubber when ANY canonical scalar is present — not
    // just IVR/PC. Skipping when only one field is null would leave
    // {{IV30}} / {{HV20}} / {{BETA}} etc. unsubstituted in the transcript
    // even when their canonical values are available, defeating the
    // entire placeholder protocol.
    if (scrubCanonical && hasAnyCanonical(scrubCanonical)) {
      const sr = scrubAll(finalText, scrubCanonical);
      if (sr.replacements.length > 0) {
        logger.warn(
          { round, role, phase, replacements: sr.replacements, canonical: scrubCanonical },
          "TradeValidation: scrubber replaced hallucinated values in turn output",
        );
        finalText = sr.text;
      }
    }
    // onTurnDone REPLACES the streaming-accumulated text with finalText, so
    // the user-visible transcript ends up with the scrubbed copy even if
    // mid-stream tokens briefly showed `{{IVR}}`.
    callbacks?.onTurnDone?.(turnId, finalText);
    return { text: finalText, trace: r.trace, turnId };
  } catch (err) {
    callbacks?.onTurnDone?.(turnId, acc + `\n\n[error: ${err instanceof Error ? err.message : String(err)}]`);
    throw err;
  }
}

function emitSystemTurn(text: string, label: string, round: ValidationTurn["round"], phase: ValidationTurn["phase"], cb?: ValidationCallbacks) {
  const id = newTurnId();
  cb?.onTurnStart?.({ id, round, role: "system", phase, model: "system", label, startedAt: Date.now() });
  cb?.onTurnDelta?.(id, text);
  cb?.onTurnDone?.(id, text);
}

// ────────────────────────────────────────────────────────────────────────────
// JSON EXTRACTION
// ────────────────────────────────────────────────────────────────────────────
function safeParseJsonObject(s: string): Record<string, unknown> | null {
  if (!s) return null;
  // Strip code fences
  const cleaned = s.replace(/^```(?:json)?/i, "").replace(/```$/m, "").trim();
  // Find first { ... last }
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  const slice = cleaned.slice(first, last + 1);
  try { return JSON.parse(slice) as Record<string, unknown>; } catch { /* fall through */ }
  return null;
}

function asInt(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.min(100, Math.round(v)));
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(n)));
  }
  return fallback;
}

function asStringArray(v: unknown, max = 5): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).slice(0, max);
}

function asVerdict(v: unknown): ValidationVerdict | null {
  if (typeof v !== "string") return null;
  const u = v.toUpperCase().replace(/\s+/g, "_");
  if (u === "PROCEED" || u === "PROCEED_WITH_CAUTION" || u === "DO_NOT_PROCEED") return u;
  return null;
}

function mergeTraces(a: WebSearchTrace, b: WebSearchTrace): WebSearchTrace {
  const seen = new Set<string>();
  const sources = [...a.sources, ...b.sources].filter((s) => { if (seen.has(s.url)) return false; seen.add(s.url); return true; });
  return { webSearchUsed: a.webSearchUsed || b.webSearchUsed, queries: [...new Set([...a.queries, ...b.queries])], sources };
}

// ────────────────────────────────────────────────────────────────────────────
// SYNTHESIS
// ────────────────────────────────────────────────────────────────────────────
function dedupeBullets(items: string[], max = 4): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const key = it.toLowerCase().replace(/\s+/g, " ").trim();
    if (key.length < 4) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it.trim());
    if (out.length >= max) break;
  }
  return out;
}

function synthesizeVerdict(
  bullR3: Record<string, unknown> | null,
  bearR3: Record<string, unknown> | null,
  bullConfFromR2: number,
  bearConfFromR2: number,
): { verdict: ValidationVerdict; confidence: number; bullets: string[]; risks: string[]; improvements: string[] } {
  const bullVerdict = bullR3 ? asVerdict(bullR3["finalVerdict"]) : null;
  const bearVerdict = bearR3 ? asVerdict(bearR3["finalVerdict"]) : null;
  const bullConf = bullR3 ? asInt(bullR3["finalConfidence"], bullConfFromR2) : bullConfFromR2;
  const bearConf = bearR3 ? asInt(bearR3["finalConfidence"], bearConfFromR2) : bearConfFromR2;

  const order: Record<ValidationVerdict, number> = { PROCEED: 0, PROCEED_WITH_CAUTION: 1, DO_NOT_PROCEED: 2 };
  let verdict: ValidationVerdict = "PROCEED_WITH_CAUTION";

  // If both sides agree, take that verdict.
  if (bullVerdict && bearVerdict && bullVerdict === bearVerdict) {
    verdict = bullVerdict;
  } else if (bullVerdict && bearVerdict) {
    // Disagreement: take the more cautious of the two, but if confidences clearly favor one, that one wins.
    const bullScore = (3 - order[bullVerdict]) * (bullConf / 100);
    const bearScore = (3 - order[bearVerdict]) * (bearConf / 100);
    verdict = bullScore >= bearScore ? bullVerdict : bearVerdict;
  } else if (bullVerdict) {
    verdict = bullVerdict;
  } else if (bearVerdict) {
    verdict = bearVerdict;
  } else {
    // Both failed to give a structured verdict — fall back to confidence delta.
    const delta = bullConf - bearConf;
    if (delta > 15) verdict = "PROCEED";
    else if (delta < -15) verdict = "DO_NOT_PROCEED";
    else verdict = "PROCEED_WITH_CAUTION";
  }

  // Confidence: average the two sides, then bias toward the winner's confidence.
  const baseConf = Math.round((bullConf + bearConf) / 2);
  let confidence = baseConf;
  if (verdict === "PROCEED") confidence = Math.round((baseConf + bullConf) / 2);
  if (verdict === "DO_NOT_PROCEED") confidence = Math.round((baseConf + bearConf) / 2);
  confidence = Math.max(0, Math.min(100, confidence));

  // Bullets: take from the WINNING side's reasoningBullets, plus 1-2 from the loser as concessions.
  const bullBullets = bullR3 ? asStringArray(bullR3["reasoningBullets"], 4) : [];
  const bearBullets = bearR3 ? asStringArray(bearR3["reasoningBullets"], 4) : [];
  const bullRisks = bullR3 ? asStringArray(bullR3["topRisks"], 3) : [];
  const bearRisks = bearR3 ? asStringArray(bearR3["topRisks"], 3) : [];
  const bullImprovs = bullR3 ? asStringArray(bullR3["improvements"], 3) : [];
  const bearImprovs = bearR3 ? asStringArray(bearR3["improvements"], 3) : [];

  let primary: string[] = [];
  let secondary: string[] = [];
  if (verdict === "PROCEED") { primary = bullBullets; secondary = bearBullets.slice(0, 1); }
  else if (verdict === "DO_NOT_PROCEED") { primary = bearBullets; secondary = bullBullets.slice(0, 1); }
  else { primary = [...bullBullets.slice(0, 2), ...bearBullets.slice(0, 2)]; secondary = []; }

  const bullets = dedupeBullets([...primary, ...secondary], 4);
  const risks = dedupeBullets([...bullRisks, ...bearRisks], 3);
  const improvements = verdict === "PROCEED" ? [] : dedupeBullets([...bearImprovs, ...bullImprovs], 3);

  return { verdict, confidence, bullets, risks, improvements };
}

// ────────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ────────────────────────────────────────────────────────────────────────────
export async function runTradeValidation(
  input: ValidationInput,
  callbacks?: ValidationCallbacks,
): Promise<ValidationVerdictPayload> {
  const today = new Date().toISOString().slice(0, 10);
  const settings = await getSettings();

  // Pick personas based on opening vs closing.
  const isExit = input.ticket.mode === "closing";
  const personaA = isExit ? BULL_VALIDATOR_EXIT : BULL_VALIDATOR_ENTRY;
  const personaB = isExit ? BEAR_VALIDATOR_EXIT : BEAR_VALIDATOR_ENTRY;
  const sysA = `${VALIDATION_SYSTEM_PROMPT}\n\n${personaA}`;
  const sysB = `${VALIDATION_SYSTEM_PROMPT}\n\n${personaB}`;

  // Models — reuse user's debate config when available, fall back to solo.
  const isDebateMode = settings.strategistMode === 2;
  const modelA: StrategistModelOption = isDebateMode
    ? getStrategistModel(settings.strategistDebateAModelIdx)
    : getStrategistModel(settings.strategistSoloModelIdx);
  const modelB: StrategistModelOption = isDebateMode
    ? getStrategistModel(settings.strategistDebateBModelIdx)
    : getStrategistModel(settings.strategistSoloModelIdx);

  const labeledA: StrategistModelOption = { ...modelA, label: `Bull · ${modelA.label}` };
  const labeledB: StrategistModelOption = { ...modelB, label: `Bear · ${modelB.label}` };

  const dataPackage = buildDataPackage(input);

  // Canonical scalars for the post-stream scrubber. Pulled from the same
  // marketContext we expose in the data package, so any `{{IVR}}`, `{{IV30}}`,
  // etc. tokens the model emits get replaced with the same numbers the
  // validators were shown.
  //
  // Source-of-truth precedence for P/C ratio (avoid double-counting): chain
  // P/C is preferred when present (it's live-quote derived); Polygon-flow
  // P/C is the fallback. The Polygon-flow value is also surfaced separately
  // as `{{PC_RATIO_FLOW}}` so the model can cite both when they diverge.
  const mctx = input.marketContext;
  const chainPc =
    mctx?.chainSummary && Number.isFinite(mctx.chainSummary.putCallVolumeRatio) && mctx.chainSummary.putCallVolumeRatio > 0
      ? mctx.chainSummary.putCallVolumeRatio
      : null;
  const flowPc =
    mctx?.polygonHighlights && Number.isFinite(mctx.polygonHighlights.putCallVolumeRatio) && mctx.polygonHighlights.putCallVolumeRatio > 0
      ? mctx.polygonHighlights.putCallVolumeRatio
      : null;
  const scrubCanonical: ScrubCanonical = {
    ivr: mctx?.ivr ?? null,
    pcRatio: chainPc ?? flowPc,
    iv30: mctx?.equityExtras?.iv30d ?? null,
    hv20: mctx?.equityExtras?.hv20d ?? null,
    ivHv: mctx?.equityExtras?.ivHvRatio ?? null,
    // Only surface beta when the IO-score regression actually fit — fallback
    // betas are misleading (see IOScoreResult.available comment).
    beta: mctx?.ioScore?.available ? mctx.ioScore.beta : null,
    earningsDays: mctx?.nextEarnings?.daysAway ?? null,
    pcRatioFlow: flowPc,
  };

  // ── Round 1 (parallel) ──
  callbacks?.onStatus?.("Round 1 — Bull and Bear pitching cases on this trade…");
  const [r1a, r1b] = await Promise.all([
    runTurn({ modelOpt: labeledA, systemPrompt: sysA, prompt: ROUND_1(today, "BULL", input.ticket.mode, dataPackage), round: 1, role: "A", phase: "propose", callbacks, scrubCanonical }),
    runTurn({ modelOpt: labeledB, systemPrompt: sysB, prompt: ROUND_1(today, "BEAR", input.ticket.mode, dataPackage), round: 1, role: "B", phase: "propose", callbacks, scrubCanonical }),
  ]);

  // ── Round 2 (parallel) ──
  callbacks?.onStatus?.("Round 2 — rebutting…");
  const [r2a, r2b] = await Promise.all([
    runTurn({ modelOpt: labeledA, systemPrompt: sysA, prompt: ROUND_2("BULL", r1a.text, r1b.text), round: 2, role: "A", phase: "critique", callbacks, scrubCanonical }),
    runTurn({ modelOpt: labeledB, systemPrompt: sysB, prompt: ROUND_2("BEAR", r1b.text, r1a.text), round: 2, role: "B", phase: "critique", callbacks, scrubCanonical }),
  ]);

  // Confidence after R2 (used as fallback if R3 JSON is malformed).
  const r2aJson = safeParseJsonObject(r2a.text);
  const r2bJson = safeParseJsonObject(r2b.text);
  const r1aJson = safeParseJsonObject(r1a.text);
  const r1bJson = safeParseJsonObject(r1b.text);
  const bullConfR2 = asInt(r2aJson?.["revisedConfidence"] ?? r1aJson?.["confidence"], 50);
  const bearConfR2 = asInt(r2bJson?.["revisedConfidence"] ?? r1bJson?.["confidence"], 50);

  // ── Round 3 (parallel) — final verdicts ──
  callbacks?.onStatus?.("Round 3 — final verdicts…");
  const [r3a, r3b] = await Promise.all([
    runTurn({ modelOpt: labeledA, systemPrompt: sysA, prompt: ROUND_3("BULL", input.ticket.mode, r1a.text, r2a.text, r1b.text, r2b.text), round: 3, role: "A", phase: "final", callbacks, scrubCanonical }),
    runTurn({ modelOpt: labeledB, systemPrompt: sysB, prompt: ROUND_3("BEAR", input.ticket.mode, r1b.text, r2b.text, r1a.text, r2a.text), round: 3, role: "B", phase: "final", callbacks, scrubCanonical }),
  ]);

  const r3aJson = safeParseJsonObject(r3a.text);
  const r3bJson = safeParseJsonObject(r3b.text);

  const synth = synthesizeVerdict(r3aJson, r3bJson, bullConfR2, bearConfR2);

  // Emit verdict as a system turn so the live transcript ends with it.
  emitSystemTurn(
    JSON.stringify({
      phase: "VERDICT",
      verdict: synth.verdict,
      confidence: synth.confidence,
      bullConfidence: bullConfR2,
      bearConfidence: bearConfR2,
      reasoningBullets: synth.bullets,
      risks: synth.risks,
      improvements: synth.improvements,
    }, null, 2),
    "Verdict",
    "synthesis",
    "info",
    callbacks,
  );

  const aggregateTrace = mergeTraces(
    mergeTraces(mergeTraces(r1a.trace, r1b.trace), mergeTraces(r2a.trace, r2b.trace)),
    mergeTraces(r3a.trace, r3b.trace),
  );

  logger.info(
    {
      verdict: synth.verdict,
      confidence: synth.confidence,
      bullConfR2,
      bearConfR2,
      ticker: input.ticket.ticker,
      mode: input.ticket.mode,
    },
    "TradeValidation: completed",
  );

  return {
    verdict: synth.verdict,
    confidence: synth.confidence,
    reasoningBullets: synth.bullets,
    risks: synth.risks,
    improvements: synth.improvements,
    bullConfidence: bullConfR2,
    bearConfidence: bearConfR2,
    trace: aggregateTrace,
  };
}
