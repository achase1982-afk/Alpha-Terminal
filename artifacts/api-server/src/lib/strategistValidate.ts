import { logger } from "./logger.js";
import {
  streamCallAnthropicWithSystemAndWebSearch,
  streamCallGeminiWithSystemAndWebSearch,
  type WebSearchResult,
  type WebSearchTrace,
} from "./aiLabAnalystClient.js";
import { getSettings, getStrategistModel } from "./strategistSettings.js";
import type { StrategistModelOption } from "./strategistSettings.js";

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
}

export interface ValidationInput {
  ticket: ValidationTicket;
  thesis?: string; // user-supplied thesis text
  rollingShort?: boolean;
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
  lines.push(`Asset: ${t.isOption ? (t.isMultiLeg ? "OPTIONS (multi-leg)" : "OPTIONS (single)") : "EQUITY"}`);
  lines.push(`Intent: ${t.mode === "opening" ? "OPEN new position" : "CLOSE existing position"}`);
  if (t.side) lines.push(`Side: ${t.side}`);
  lines.push(`Order type: ${t.orderType}${t.duration ? ` · ${t.duration}` : ""}`);
  lines.push(`Quantity: ${t.quantity} ${t.isOption ? "contract(s)" : "share(s)"}`);
  if (t.limitPrice != null) lines.push(`Limit price: ${fmtNum(t.limitPrice)}`);
  if (t.netPrice != null) lines.push(`Net price (spread): ${fmtNum(t.netPrice)} (${t.isCredit ? "CREDIT" : "DEBIT"})`);

  if (t.legs && t.legs.length > 0) {
    lines.push(``);
    lines.push(`## LEGS`);
    t.legs.forEach((leg, i) => {
      const parts = [
        `Leg ${i + 1}:`,
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

  if (t.mode === "closing") {
    lines.push(``);
    lines.push(`## CLOSING CONTEXT`);
    if (t.currentEntryPrice != null) lines.push(`Original entry price: ${fmtNum(t.currentEntryPrice)}`);
    if (t.currentPnl != null) lines.push(`Current P&L: ${fmtNum(t.currentPnl)}`);
    if (t.daysHeld != null) lines.push(`Days held: ${t.daysHeld}`);
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
}): Promise<{ text: string; trace: WebSearchTrace; turnId: string }> {
  const { modelOpt, systemPrompt, prompt, round, role, phase, callbacks } = args;
  const turnId = newTurnId();
  callbacks?.onTurnStart?.({
    id: turnId, round, role, phase,
    model: modelOpt.model, label: modelOpt.label, startedAt: Date.now(),
  });
  let acc = "";
  const onDelta = (delta: string) => { acc += delta; callbacks?.onTurnDelta?.(turnId, delta); };
  try {
    const r = await streamModel(modelOpt, systemPrompt, prompt, onDelta, (s) => callbacks?.onStatus?.(s));
    callbacks?.onTurnDone?.(turnId, r.text);
    return { text: r.text, trace: r.trace, turnId };
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

  // ── Round 1 (parallel) ──
  callbacks?.onStatus?.("Round 1 — Bull and Bear pitching cases on this trade…");
  const [r1a, r1b] = await Promise.all([
    runTurn({ modelOpt: labeledA, systemPrompt: sysA, prompt: ROUND_1(today, "BULL", input.ticket.mode, dataPackage), round: 1, role: "A", phase: "propose", callbacks }),
    runTurn({ modelOpt: labeledB, systemPrompt: sysB, prompt: ROUND_1(today, "BEAR", input.ticket.mode, dataPackage), round: 1, role: "B", phase: "propose", callbacks }),
  ]);

  // ── Round 2 (parallel) ──
  callbacks?.onStatus?.("Round 2 — rebutting…");
  const [r2a, r2b] = await Promise.all([
    runTurn({ modelOpt: labeledA, systemPrompt: sysA, prompt: ROUND_2("BULL", r1a.text, r1b.text), round: 2, role: "A", phase: "critique", callbacks }),
    runTurn({ modelOpt: labeledB, systemPrompt: sysB, prompt: ROUND_2("BEAR", r1b.text, r1a.text), round: 2, role: "B", phase: "critique", callbacks }),
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
    runTurn({ modelOpt: labeledA, systemPrompt: sysA, prompt: ROUND_3("BULL", input.ticket.mode, r1a.text, r2a.text, r1b.text, r2b.text), round: 3, role: "A", phase: "final", callbacks }),
    runTurn({ modelOpt: labeledB, systemPrompt: sysB, prompt: ROUND_3("BEAR", input.ticket.mode, r1b.text, r2b.text, r1a.text, r2a.text), round: 3, role: "B", phase: "final", callbacks }),
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
