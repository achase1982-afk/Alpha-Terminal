import { logger } from "./logger.js";
import {
  streamCallAnthropicWithSystemAndWebSearch,
  streamCallGeminiWithSystemAndWebSearch,
  type WebSearchResult,
  type WebSearchTrace,
} from "./aiLabAnalystClient.js";
import type { StrategistModelOption } from "./strategistSettings.js";

export type DebateRound = 1 | 2 | 3 | "synthesis";
export type DebateRole = "A" | "B" | "synthesis" | "system";
export type DebatePhase = "propose" | "critique" | "final" | "synthesis" | "info";

export interface TurnStartEvent {
  id: string;
  round: DebateRound;
  role: DebateRole;
  phase: DebatePhase;
  model: string;
  label: string;
  startedAt: number;
}

export interface DebateCallbacks {
  onTurnStart?: (turn: TurnStartEvent) => void;
  onTurnDelta?: (turnId: string, delta: string) => void;
  onTurnDone?: (turnId: string, finalText: string) => void;
  onStatus?: (status: string) => void;
}

export interface DebateConfig {
  modelA: StrategistModelOption;
  modelB: StrategistModelOption;
  /**
   * Convergence is reinterpreted as the tie-band width (in confidence points)
   * for the verdict step. Tighter bands push more results to a directional
   * winner; wider bands push more results to SIDEWAYS.
   *  1 = tight band (5 pts) — almost always picks a directional winner
   *  2 = wide band (20 pts) — favors SIDEWAYS / vol-neutral when sides are close
   *  3 = medium band (10 pts) — balanced (default)
   */
  convergence: 1 | 2 | 3;
}

export type DebateVerdict = "BULLISH" | "BEARISH" | "SIDEWAYS";

export interface DebateOutcome {
  /** The full trade JSON produced by the trade-build phase. */
  finalRawText: string;
  trace: WebSearchTrace;
  /** Side that ended up shipping the trade: A, B, or synthesis (= sideways/neutral build). */
  chosenSide: "A" | "B" | "synthesis";
  chosenLabel: string;
  /** Round-2 (post-rebuttal) raw outputs for downstream context, not validation. */
  finalAText: string;
  finalBText: string;
  /** Verdict from phase 1 — ships in the outcome so callers can log it. */
  verdict: DebateVerdict;
  bullConfidence: number;
  bearConfidence: number;
}

const TEMPERATURE = 0;

let turnSeq = 0;
function newTurnId(): string {
  turnSeq += 1;
  return `t_${Date.now().toString(36)}_${turnSeq}`;
}

async function streamModel(
  modelOpt: StrategistModelOption,
  systemPrompt: string,
  prompt: string,
  onDelta: (text: string) => void,
  onStatus?: (s: string) => void,
): Promise<WebSearchResult> {
  if (modelOpt.provider === "anthropic") {
    return streamCallAnthropicWithSystemAndWebSearch(
      modelOpt.model,
      TEMPERATURE,
      systemPrompt,
      prompt,
      onDelta,
      onStatus,
    );
  }
  return streamCallGeminiWithSystemAndWebSearch(
    modelOpt.model,
    TEMPERATURE,
    systemPrompt,
    prompt,
    onDelta,
    onStatus,
  );
}

async function runTurn(args: {
  modelOpt: StrategistModelOption;
  systemPrompt: string;
  prompt: string;
  round: DebateRound;
  role: DebateRole;
  phase: DebatePhase;
  callbacks?: DebateCallbacks;
}): Promise<{ text: string; trace: WebSearchTrace; turnId: string }> {
  const { modelOpt, systemPrompt, prompt, round, role, phase, callbacks } = args;
  const turnId = newTurnId();
  callbacks?.onTurnStart?.({
    id: turnId,
    round,
    role,
    phase,
    model: modelOpt.model,
    label: modelOpt.label,
    startedAt: Date.now(),
  });

  let acc = "";
  const onDelta = (delta: string) => {
    acc += delta;
    callbacks?.onTurnDelta?.(turnId, delta);
  };

  try {
    const r = await streamModel(modelOpt, systemPrompt, prompt, onDelta, (s) => callbacks?.onStatus?.(s));
    callbacks?.onTurnDone?.(turnId, r.text);
    return { text: r.text, trace: r.trace, turnId };
  } catch (err) {
    callbacks?.onTurnDone?.(turnId, acc + `\n\n[error: ${err instanceof Error ? err.message : String(err)}]`);
    throw err;
  }
}

/**
 * Emits a synthetic "system" turn into the transcript without making any LLM
 * call. Used for the verdict announcement.
 */
function emitSystemTurn(args: {
  text: string;
  round: DebateRound;
  phase: DebatePhase;
  label: string;
  callbacks?: DebateCallbacks;
}): void {
  const { text, round, phase, label, callbacks } = args;
  const id = newTurnId();
  callbacks?.onTurnStart?.({
    id,
    round,
    role: "system",
    phase,
    model: "system",
    label,
    startedAt: Date.now(),
  });
  callbacks?.onTurnDelta?.(id, text);
  callbacks?.onTurnDone?.(id, text);
}

// ---------- Phase 1 prompts (lightweight directional debate) ----------

const DIRECTIONAL_PROPOSE_INSTRUCTION = (
  today: string,
  dataPackage: string,
  myPersonaName: string,
  otherPersonaName: string,
) =>
  `Today is ${today}. You are the **${myPersonaName}** in a fast bull/bear directional debate against the **${otherPersonaName}**. This is PHASE 1 / ROUND 1 — directional argument only. NO trade structure yet.

Your job: deliver the strongest possible **${myPersonaName.toLowerCase()}** case for this name based on the data below. Use web search per the WEB SEARCH MANDATE in your system prompt for fresh catalysts and flow.

Output ONLY this JSON object — no markdown fences, no extra prose:
{
  "side": "${myPersonaName.toUpperCase()}",
  "thesis": "<3-6 sentences making your directional case using vol, flow, Greeks, catalyst, technicals>",
  "keyEvidence": ["<short bullet>", "<short bullet>", "<3-5 most important data points supporting your view>"],
  "biggestRisk": "<1-2 sentences: the strongest counter-argument you must defend against>",
  "confidence": <integer 0-100, calibrated honestly to how strong your case actually is given the data>
}

Calibration rule: if the data is genuinely against your assigned side, you MUST say so in "biggestRisk" and return confidence below 30 rather than fabricating a case. Honesty beats theatrics.

DATA PACKAGE:
${dataPackage}`;

const DIRECTIONAL_REBUT_INSTRUCTION = (
  myPersonaName: string,
  otherPersonaName: string,
  myR1Json: string,
  otherR1Json: string,
) =>
  `PHASE 1 / ROUND 2 — rebuttal. You are still the **${myPersonaName}**. STAY IN ROLE — do not flip sides. The **${otherPersonaName}** has now made their case. Read it, address their strongest point honestly, defend yours, concede where genuinely weak, and revise your confidence.

Output ONLY this JSON object — no markdown fences, no extra prose:
{
  "side": "${myPersonaName.toUpperCase()}",
  "rebuttal": "<2-4 sentences directly addressing the other side's strongest point>",
  "concession": "<1 sentence: any point of theirs that is genuinely valid, or 'none' if you stand by your full thesis>",
  "revisedConfidence": <integer 0-100, your honest confidence AFTER seeing the other side>
}

Calibration rule: if their case is materially stronger than yours, drop your confidence accordingly. Inflated confidence to "win" the debate produces bad live trades.

YOUR ROUND-1 ARGUMENT:
${myR1Json}

OTHER SIDE'S ROUND-1 ARGUMENT:
${otherR1Json}`;

// ---------- Phase 2 prompt (build ONE trade from the verdict) ----------

const TRADE_BUILD_INSTRUCTION = (
  verdict: DebateVerdict,
  bullConf: number,
  bearConf: number,
  bullR1: string,
  bullR2: string,
  bearR1: string,
  bearR2: string,
  dataPackage: string,
) => {
  const verdictGuidance = (() => {
    if (verdict === "BULLISH") {
      return `VERDICT: BULLISH (Bull confidence ${bullConf} vs Bear confidence ${bearConf}). The Bull won the directional debate. Build a BULLISH defined-risk options structure that expresses the bull thesis: long calls, call verticals (debit), call ratios, put credit spreads, call calendars, risk reversals, or bullish butterflies. Pick the structure where the actual edge lives in the chain — do NOT default to any one structure.`;
    }
    if (verdict === "BEARISH") {
      return `VERDICT: BEARISH (Bear confidence ${bearConf} vs Bull confidence ${bullConf}). The Bear won the directional debate. Build a BEARISH defined-risk options structure that expresses the bear thesis: long puts, put verticals (debit), put ratios, call credit spreads, put calendars, or bearish butterflies. Pick the structure where the actual edge lives in the chain — do NOT default to any one structure.`;
    }
    return `VERDICT: SIDEWAYS (Bull ${bullConf} vs Bear ${bearConf} — within tie band; both sides have real but cancelling edge). Build a VOL-NEUTRAL defined-risk structure that profits from range-bound action: iron condor, iron butterfly, calendar spread, or short strangle expressed as defined-risk. Place strikes that respect BOTH the bull's upside risk and the bear's downside risk — i.e. between or just outside the levels each side flagged. Do NOT manufacture a directional view; the debate genuinely failed to resolve a winner, which is itself a tradeable signal.`;
  })();

  return `The bull/bear directional debate has concluded. You are now the senior PM constructing the actual trade. You are NEUTRAL — drop persona, build the cleanest expression of the verdict.

${verdictGuidance}

Use the original data package (chain summary, IVR, regime, IO score, catalyst window) plus both sides' arguments below to pick strikes, expiry, and sizing. Honor the WEB SEARCH MANDATE for catalyst confirmation if useful. Output ONLY the full trade JSON object specified by your system prompt — strategy, legs, entryPrice, entryRangeMin/Max, maxRisk, maxProfit, breakeven, companyContext, thesis, exitTargets, bullInvalidation, bearInvalidation, riskOfRuin, confidence, warnings. No markdown fences, no extra prose.

In the "thesis" field, briefly cite the verdict and the strongest 1-2 evidence points from whichever side(s) the trade is honoring.

BULL ROUND-1 ARGUMENT:
${bullR1}

BULL ROUND-2 REBUTTAL:
${bullR2}

BEAR ROUND-1 ARGUMENT:
${bearR1}

BEAR ROUND-2 REBUTTAL:
${bearR2}

ORIGINAL DATA PACKAGE:
${dataPackage}`;
};

// ---------- JSON parsing for verdict computation ----------

function tryParseJson(raw: string): Record<string, unknown> | null {
  try {
    const stripped = raw.replace(/^```(json)?/i, "").replace(/```\s*$/i, "").trim();
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    return JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractConfidence(raw: string, fields: string[]): number {
  const obj = tryParseJson(raw);
  if (!obj) return 0;
  for (const f of fields) {
    const v = Number(obj[f]);
    if (Number.isFinite(v)) return Math.max(0, Math.min(100, v));
  }
  return 0;
}

function tieBandFor(convergence: 1 | 2 | 3): number {
  if (convergence === 1) return 5;
  if (convergence === 2) return 20;
  return 10;
}

function computeVerdict(bullConf: number, bearConf: number, band: number): DebateVerdict {
  const delta = bullConf - bearConf;
  if (delta > band) return "BULLISH";
  if (delta < -band) return "BEARISH";
  return "SIDEWAYS";
}

function mergeTraces(a: WebSearchTrace, b: WebSearchTrace): WebSearchTrace {
  const seenUrls = new Set<string>();
  const sources = [...a.sources, ...b.sources].filter((s) => {
    if (seenUrls.has(s.url)) return false;
    seenUrls.add(s.url);
    return true;
  });
  return {
    webSearchUsed: a.webSearchUsed || b.webSearchUsed,
    queries: [...new Set([...a.queries, ...b.queries])],
    sources,
  };
}

// ---------- Orchestrator ----------

export async function runDebate(args: {
  systemPrompt: string;
  dataPackage: string;
  config: DebateConfig;
  /** Optional persona suffix appended to systemPrompt for Strategist A (Bull). */
  personaA?: string;
  /** Optional persona suffix appended to systemPrompt for Strategist B (Bear). */
  personaB?: string;
  /** Short display name for A's persona (default "Bull"). */
  personaNameA?: string;
  /** Short display name for B's persona (default "Bear"). */
  personaNameB?: string;
  callbacks?: DebateCallbacks;
}): Promise<DebateOutcome> {
  const { systemPrompt, dataPackage, config, callbacks } = args;
  const personaNameA = args.personaNameA ?? "Bull";
  const personaNameB = args.personaNameB ?? "Bear";
  const sysA = args.personaA ? `${systemPrompt}\n\n${args.personaA}` : systemPrompt;
  const sysB = args.personaB ? `${systemPrompt}\n\n${args.personaB}` : systemPrompt;

  const modelADisplay: StrategistModelOption = {
    ...config.modelA,
    label: `${personaNameA} · ${config.modelA.label}`,
  };
  const modelBDisplay: StrategistModelOption = {
    ...config.modelB,
    label: `${personaNameB} · ${config.modelB.label}`,
  };

  const today = new Date().toISOString().slice(0, 10);

  // ---------- PHASE 1: Round 1 — directional propose (parallel) ----------
  callbacks?.onStatus?.(`Phase 1 / Round 1 — ${personaNameA} and ${personaNameB} pitching directional cases…`);
  const [r1a, r1b] = await Promise.all([
    runTurn({
      modelOpt: modelADisplay,
      systemPrompt: sysA,
      prompt: DIRECTIONAL_PROPOSE_INSTRUCTION(today, dataPackage, personaNameA, personaNameB),
      round: 1,
      role: "A",
      phase: "propose",
      callbacks,
    }),
    runTurn({
      modelOpt: modelBDisplay,
      systemPrompt: sysB,
      prompt: DIRECTIONAL_PROPOSE_INSTRUCTION(today, dataPackage, personaNameB, personaNameA),
      round: 1,
      role: "B",
      phase: "propose",
      callbacks,
    }),
  ]);

  // ---------- PHASE 1: Round 2 — rebuttals (parallel) ----------
  callbacks?.onStatus?.(`Phase 1 / Round 2 — ${personaNameA} and ${personaNameB} rebutting…`);
  const [r2a, r2b] = await Promise.all([
    runTurn({
      modelOpt: modelADisplay,
      systemPrompt: sysA,
      prompt: DIRECTIONAL_REBUT_INSTRUCTION(personaNameA, personaNameB, r1a.text, r1b.text),
      round: 2,
      role: "A",
      phase: "critique",
      callbacks,
    }),
    runTurn({
      modelOpt: modelBDisplay,
      systemPrompt: sysB,
      prompt: DIRECTIONAL_REBUT_INSTRUCTION(personaNameB, personaNameA, r1b.text, r1a.text),
      round: 2,
      role: "B",
      phase: "critique",
      callbacks,
    }),
  ]);

  // ---------- VERDICT (no LLM call) ----------
  const bullConfidence =
    extractConfidence(r2a.text, ["revisedConfidence", "confidence"]) ||
    extractConfidence(r1a.text, ["confidence"]);
  const bearConfidence =
    extractConfidence(r2b.text, ["revisedConfidence", "confidence"]) ||
    extractConfidence(r1b.text, ["confidence"]);
  const band = tieBandFor(config.convergence);
  const verdict = computeVerdict(bullConfidence, bearConfidence, band);

  const verdictJson = JSON.stringify(
    {
      phase: "VERDICT",
      bullConfidence,
      bearConfidence,
      delta: bullConfidence - bearConfidence,
      tieBand: band,
      tieBandSource:
        config.convergence === 1 ? "tight (setting #1)" : config.convergence === 2 ? "wide (setting #2)" : "medium (setting #3)",
      verdict,
      nextStep:
        verdict === "SIDEWAYS"
          ? "Build vol-neutral defined-risk structure (iron condor / butterfly / calendar)."
          : verdict === "BULLISH"
            ? `Build bullish defined-risk structure on ${personaNameA}'s model.`
            : `Build bearish defined-risk structure on ${personaNameB}'s model.`,
    },
    null,
    2,
  );

  emitSystemTurn({
    text: verdictJson,
    round: 2,
    phase: "info",
    label: "Verdict",
    callbacks,
  });

  logger.info(
    {
      verdict,
      bullConfidence,
      bearConfidence,
      delta: bullConfidence - bearConfidence,
      tieBand: band,
      modelA: config.modelA.model,
      modelB: config.modelB.model,
    },
    "StrategistDebate: Phase-1 verdict computed",
  );

  // ---------- PHASE 2: Trade construction (single call) ----------
  // Builder uses the winning side's model (or A's model for SIDEWAYS) and the
  // NEUTRAL system prompt — verdict already constrains direction, persona is
  // redundant and would bias structure selection.
  let builderModelOpt: StrategistModelOption;
  let chosenSide: "A" | "B" | "synthesis";
  let chosenLabel: string;
  if (verdict === "BULLISH") {
    builderModelOpt = { ...config.modelA, label: `Trade Builder · ${config.modelA.label}` };
    chosenSide = "A";
    chosenLabel = `${personaNameA} (${config.modelA.label})`;
  } else if (verdict === "BEARISH") {
    builderModelOpt = { ...config.modelB, label: `Trade Builder · ${config.modelB.label}` };
    chosenSide = "B";
    chosenLabel = `${personaNameB} (${config.modelB.label})`;
  } else {
    builderModelOpt = { ...config.modelA, label: `Sideways Builder · ${config.modelA.label}` };
    chosenSide = "synthesis";
    chosenLabel = `Sideways / Vol-Neutral (${config.modelA.label})`;
  }

  callbacks?.onStatus?.(
    verdict === "SIDEWAYS"
      ? "Phase 2 — building vol-neutral trade for SIDEWAYS verdict…"
      : `Phase 2 — building ${verdict.toLowerCase()} trade…`,
  );

  const buildResult = await runTurn({
    modelOpt: builderModelOpt,
    systemPrompt, // neutral — no persona suffix
    prompt: TRADE_BUILD_INSTRUCTION(
      verdict,
      bullConfidence,
      bearConfidence,
      r1a.text,
      r2a.text,
      r1b.text,
      r2b.text,
      dataPackage,
    ),
    round: 3,
    role: chosenSide === "A" ? "A" : chosenSide === "B" ? "B" : "synthesis",
    phase: "final",
    callbacks,
  });

  const aggregateTrace = mergeTraces(
    mergeTraces(mergeTraces(r1a.trace, r1b.trace), mergeTraces(r2a.trace, r2b.trace)),
    buildResult.trace,
  );

  return {
    finalRawText: buildResult.text,
    trace: aggregateTrace,
    chosenSide,
    chosenLabel,
    finalAText: r2a.text,
    finalBText: r2b.text,
    verdict,
    bullConfidence,
    bearConfidence,
  };
}
