import { logger } from "./logger.js";
import {
  streamCallAnthropicWithSystemAndWebSearch,
  streamCallGeminiWithSystemAndWebSearch,
  streamCallOpenAIWithSystemAndWebSearch,
  streamCallXaiWithSystemAndWebSearch,
  type WebSearchResult,
  type WebSearchTrace,
} from "./aiLabAnalystClient.js";
import type { StrategistModelOption } from "./strategistSettings.js";
import { scrubAll, hasAnyCanonical, type ScrubCanonical } from "./narrativeScrubbers.js";

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
  cancelSignal?: AbortSignal;
  onTurnStart?: (turn: TurnStartEvent) => void;
  onTurnDelta?: (turnId: string, delta: string) => void;
  onTurnDone?: (turnId: string, finalText: string) => void;
  onStatus?: (status: string) => void;
}

export interface DebateConfig {
  modelA: StrategistModelOption;
  modelB: StrategistModelOption;
  /**
   * Phase 3 arbitrator. May be the same as A, B, a third independent model, or
   * the literal string "winner" — in which case the side whose model wins the
   * directional verdict in Phase 1 is promoted to Senior PM. SIDEWAYS verdicts
   * fall back to modelA (no clear winner).
   */
  arbitratorModel: StrategistModelOption | "winner";
  /**
   * How the single final report is produced after both sides finish debating.
   *  1 = highest confidence wins (no extra LLM call)
   *  2 = synthesis pass (one extra LLM merges both)
   *  3 = hybrid — agree → synthesis, disagree → highest confidence (default)
   */
  convergence: 1 | 2 | 3;
  /**
   * Tie-band width in confidence points for the BULL/BEAR/SIDEWAYS verdict.
   * If |bullConfidence − bearConfidence| ≤ tieBand, the verdict is SIDEWAYS.
   * Smaller = more directional verdicts; larger = more SIDEWAYS / vol-neutral.
   * Common settings: 5 (tight), 10 (medium, default), 20 (wide). Independent
   * of `convergence` — set per-user via `strategistTieBand` in settings.
   */
  tieBand: number;
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
  cancelSignal?: AbortSignal,
): Promise<WebSearchResult> {
  if (modelOpt.provider === "anthropic") {
    return streamCallAnthropicWithSystemAndWebSearch(
      modelOpt.model,
      TEMPERATURE,
      systemPrompt,
      prompt,
      onDelta,
      onStatus,
      cancelSignal,
    );
  }
  if (modelOpt.provider === "openai") {
    return streamCallOpenAIWithSystemAndWebSearch(
      modelOpt.model,
      TEMPERATURE,
      systemPrompt,
      prompt,
      onDelta,
      onStatus,
      cancelSignal,
    );
  }
  if (modelOpt.provider === "xai") {
    return streamCallXaiWithSystemAndWebSearch(
      modelOpt.model,
      TEMPERATURE,
      systemPrompt,
      prompt,
      onDelta,
      onStatus,
      cancelSignal,
    );
  }
  return streamCallGeminiWithSystemAndWebSearch(
    modelOpt.model,
    TEMPERATURE,
    systemPrompt,
    prompt,
    onDelta,
    onStatus,
    cancelSignal,
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
  /** Canonical scalars used to scrub hallucinated `{{IVR}}` / `{{PC_RATIO}}`
   *  / `{{IV30}}` / `{{HV20}}` / `{{IVHV}}` / `{{BETA}}` / `{{EARNINGS_DAYS}}`
   *  / `{{PC_RATIO_FLOW}}` tokens out of EVERY debate turn (R1/R2/R3 ×
   *  Bull/Bear) before they hit the transcript and before downstream rounds
   *  feed the scrubbed text back as context. Without this, the synthesis
   *  card is clean but the debate transcript shown to the user still leaks
   *  raw placeholders. */
  scrubCanonical?: ScrubCanonical;
}): Promise<{ text: string; trace: WebSearchTrace; turnId: string }> {
  const { modelOpt, systemPrompt, prompt, round, role, phase, callbacks, scrubCanonical } = args;
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
    const r = await streamModel(modelOpt, systemPrompt, prompt, onDelta, (s) => callbacks?.onStatus?.(s), callbacks?.cancelSignal);
    let finalText = r.text;
    if (scrubCanonical && hasAnyCanonical(scrubCanonical)) {
      const sr = scrubAll(finalText, scrubCanonical);
      if (sr.replacements.length > 0) {
        logger.warn(
          { round, role, phase, replacements: sr.replacements, canonical: scrubCanonical },
          "StrategistDebate: scrubber replaced hallucinated values in turn output",
        );
        finalText = sr.text;
      }
    }
    // onTurnDone REPLACES the streaming-accumulated text with finalText, so
    // the user-visible transcript ends up scrubbed even if mid-stream
    // tokens briefly showed `{{IVR}}`. The returned `text` is also the
    // scrubbed copy so downstream rounds (R2 rebuttal, R3 structure) feed
    // on the cleaned prior-round arguments, preventing placeholder
    // propagation.
    callbacks?.onTurnDone?.(turnId, finalText);
    return { text: finalText, trace: r.trace, turnId };
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
  `You are the **${myPersonaName}** in a fast bull/bear directional debate against the **${otherPersonaName}**. This is PHASE 1 / ROUND 1 — directional argument only. NO trade structure yet.

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

// ---------- Phase 2 prompt — both sides propose a SPECIFIC structure ----------

const TRADE_STRUCTURE_PROPOSE_INSTRUCTION = (
  myPersonaName: string,
  otherPersonaName: string,
  verdict: DebateVerdict,
  bullConf: number,
  bearConf: number,
  myR1: string,
  myR2: string,
  otherR1: string,
  otherR2: string,
  dataPackage: string,
) => {
  const verdictBlock = (() => {
    if (verdict === "BULLISH") {
      return `VERDICT: BULLISH (Bull ${bullConf} vs Bear ${bearConf}). The trade must express bullish edge.
- Allowed structures: long call, debit call vertical, put credit spread, call ratio, call calendar, risk reversal, bullish broken-wing butterfly. Pick whichever the chain + IVR + DTE actually rewards.
- ${myPersonaName === "Bull" ? "You won the debate — propose the structure that best monetizes your thesis given the actual chain liquidity, IVR, and DTE." : "You LOST the debate — your job now is risk-management input. Propose the bullish structure with the LOWEST risk-of-ruin given your bear thesis is the residual risk. No bear structures allowed; the verdict is bullish."}`;
    }
    if (verdict === "BEARISH") {
      return `VERDICT: BEARISH (Bear ${bearConf} vs Bull ${bullConf}). The trade must express bearish edge.
- Allowed structures: long put, debit put vertical, call credit spread, put ratio, put calendar, bearish broken-wing butterfly. Pick whichever the chain + IVR + DTE actually rewards.
- ${myPersonaName === "Bear" ? "You won the debate — propose the structure that best monetizes your thesis given the actual chain liquidity, IVR, and DTE." : "You LOST the debate — your job now is risk-management input. Propose the bearish structure with the LOWEST risk-of-ruin given your bull thesis is the residual risk. No bull structures allowed; the verdict is bearish."}`;
    }
    return `VERDICT: SIDEWAYS (Bull ${bullConf} vs Bear ${bearConf} — within tie band; both sides have real but cancelling edge). The trade must be vol-neutral / range-bound.
- Allowed structures: iron condor, iron butterfly, double calendar, short strangle wrapped as defined-risk. Pick whichever the chain + IVR + DTE actually rewards.
- Place wings/strikes that respect BOTH sides' flagged risk levels. No directional structures allowed.`;
  })();

  return `PHASE 2 / ROUND 3 — Trade Structure Vote. The directional debate is over. Now you and the **${otherPersonaName}** must each propose the SPECIFIC trade structure that best expresses the verdict. Both proposals will be presented to the senior PM, who will arbitrate.

${verdictBlock}

You are still the **${myPersonaName}** — bring your perspective to the structural choice. Use the chain summary, IVR, DTE math, regime, and catalyst window in the data package below. Honor the WEB SEARCH MANDATE if catalyst timing/IV expectations need confirmation.

Output ONLY this JSON object — no markdown fences, no extra prose:
{
  "side": "${myPersonaName.toUpperCase()}",
  "strategy": "<one of: long_call | long_put | call_debit_spread | put_debit_spread | call_credit_spread | put_credit_spread | call_calendar | put_calendar | call_ratio | put_ratio | iron_condor | iron_butterfly | double_calendar | risk_reversal | broken_wing_butterfly>",
  "expiry": "<YYYY-MM-DD — the exact expiry to use, picked from the chain>",
  "dte": <integer days to expiry>,
  "legs": [
    { "action": "buy"|"sell", "type": "call"|"put", "strike": <number>, "qty": <integer> },
    ...
  ],
  "rationale": "<3-5 sentences: why this structure, why these strikes, why this DTE, given the data and the verdict. Cite specific IVR, delta, OI, or catalyst dates from the data package.>",
  "biggestRisk": "<1 sentence: the single biggest thing that breaks this structure>",
  "confidence": <integer 0-100, calibrated to how strongly the chain actually supports this structure>
}

Calibration rule: confidence reflects how well the CHAIN supports the structure (liquidity, IVR fit, DTE fit), NOT how badly you want to be right. If the chain is illiquid or IVR is wrong for your structure, say so in biggestRisk and lower confidence.

VERDICT FROM PHASE 1:
- Bull confidence: ${bullConf}
- Bear confidence: ${bearConf}
- Verdict: ${verdict}

YOUR DIRECTIONAL ARGUMENTS:
- R1: ${myR1}
- R2: ${myR2}

OTHER SIDE'S DIRECTIONAL ARGUMENTS (for context — do NOT re-debate direction):
- R1: ${otherR1}
- R2: ${otherR2}

DATA PACKAGE:
${dataPackage}`;
};

// ---------- Phase 3 prompt — arbitrator builds final trade from BOTH proposals ----------

const TRADE_BUILD_FROM_PROPOSALS_INSTRUCTION = (
  verdict: DebateVerdict,
  bullConf: number,
  bearConf: number,
  bullStructureProposal: string,
  bearStructureProposal: string,
  bullR1: string,
  bullR2: string,
  bearR1: string,
  bearR2: string,
  dataPackage: string,
) =>
  `PHASE 3 — Final Trade Construction. You are the senior PM. The Bull and Bear have completed a directional debate (verdict: ${verdict}, Bull ${bullConf} / Bear ${bearConf}) AND each proposed a specific trade structure. Your ONLY job now is to arbitrate between the two structure proposals and ship the final trade.

ARBITRATION RULES (apply in order):
1. If both sides proposed the SAME strategy, use it. If their strikes/expiry differ, take the more liquid / better-IVR-fit version per the chain.
2. If they proposed DIFFERENT strategies, pick the one whose "rationale" is more concretely grounded in the actual chain data (cited deltas, OI, IVR, catalyst date), not the one with higher self-reported confidence.
3. You may adjust strikes by ±1 increment if the chain shows materially better liquidity nearby — but DO NOT invent a structure neither side proposed. If you reject both, default to the higher-confidence side's structure with their strikes unchanged.
4. The verdict is binding on direction. BULLISH/BEARISH structures only for those verdicts; vol-neutral only for SIDEWAYS. No exceptions.
5. State your arbitration choice explicitly in the "thesis" field: which proposal you took, why, and what (if anything) you adjusted.

Output ONLY the full trade JSON object specified by your system prompt — strategy, legs, entryPrice, entryRangeMin/Max, maxRisk, maxProfit, breakeven, companyContext, thesis, exitTargets, bullInvalidation, bearInvalidation, riskOfRuin, confidence, warnings. No markdown fences, no extra prose. Honor the WEB SEARCH MANDATE only if you need to confirm a catalyst date.

BULL'S STRUCTURE PROPOSAL:
${bullStructureProposal}

BEAR'S STRUCTURE PROPOSAL:
${bearStructureProposal}

DIRECTIONAL DEBATE CONTEXT (for the thesis field — do NOT re-debate):
- Bull R1: ${bullR1}
- Bull R2: ${bullR2}
- Bear R1: ${bearR1}
- Bear R2: ${bearR2}

ORIGINAL DATA PACKAGE:
${dataPackage}`;

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

/** Clamp + sanitize the user-configured tie band. Falls back to 10 (medium)
 *  if the value is missing, NaN, ≤0, or absurdly large. */
function sanitizeTieBand(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 10;
  if (raw < 1) return 1;
  if (raw > 100) return 100;
  return Math.round(raw);
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
  /** Forwarded to every inner runTurn (R1/R2/R3 × Bull/Bear + Senior PM
   *  build) so debate transcript turns are scrubbed identically to the
   *  final synthesis card. See runTurn for substitution policy. */
  scrubCanonical?: ScrubCanonical;
}): Promise<DebateOutcome> {
  const { systemPrompt, dataPackage, config, callbacks, scrubCanonical } = args;
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
      scrubCanonical,
    }),
    runTurn({
      modelOpt: modelBDisplay,
      systemPrompt: sysB,
      prompt: DIRECTIONAL_PROPOSE_INSTRUCTION(today, dataPackage, personaNameB, personaNameA),
      round: 1,
      role: "B",
      phase: "propose",
      callbacks,
      scrubCanonical,
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
      scrubCanonical,
    }),
    runTurn({
      modelOpt: modelBDisplay,
      systemPrompt: sysB,
      prompt: DIRECTIONAL_REBUT_INSTRUCTION(personaNameB, personaNameA, r1b.text, r1a.text),
      round: 2,
      role: "B",
      phase: "critique",
      callbacks,
      scrubCanonical,
    }),
  ]);

  // ---------- VERDICT (no LLM call) ----------
  const bullConfidence =
    extractConfidence(r2a.text, ["revisedConfidence", "confidence"]) ||
    extractConfidence(r1a.text, ["confidence"]);
  const bearConfidence =
    extractConfidence(r2b.text, ["revisedConfidence", "confidence"]) ||
    extractConfidence(r1b.text, ["confidence"]);
  const band = sanitizeTieBand(config.tieBand);
  const verdict = computeVerdict(bullConfidence, bearConfidence, band);

  const verdictJson = JSON.stringify(
    {
      phase: "VERDICT",
      bullConfidence,
      bearConfidence,
      delta: bullConfidence - bearConfidence,
      tieBand: band,
      tieBandSource:
        band <= 5 ? `${band} pts (tight)` : band >= 20 ? `${band} pts (wide)` : `${band} pts (medium)`,
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

  // ---------- PHASE 2: Trade Structure Vote (parallel) ----------
  // Both sides propose a SPECIFIC structure consistent with the verdict.
  // Winner of the directional debate gets to optimize for upside; loser
  // contributes a risk-management structural alternative. The senior PM
  // (phase 3) then arbitrates between the two proposals.
  callbacks?.onStatus?.(
    `Phase 2 / Round 3 — ${personaNameA} and ${personaNameB} proposing trade structures…`,
  );
  const [s3a, s3b] = await Promise.all([
    runTurn({
      modelOpt: modelADisplay,
      systemPrompt: sysA,
      prompt: TRADE_STRUCTURE_PROPOSE_INSTRUCTION(
        personaNameA,
        personaNameB,
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
      role: "A",
      phase: "propose",
      callbacks,
      scrubCanonical,
    }),
    runTurn({
      modelOpt: modelBDisplay,
      systemPrompt: sysB,
      prompt: TRADE_STRUCTURE_PROPOSE_INSTRUCTION(
        personaNameB,
        personaNameA,
        verdict,
        bullConfidence,
        bearConfidence,
        r1b.text,
        r2b.text,
        r1a.text,
        r2a.text,
        dataPackage,
      ),
      round: 3,
      role: "B",
      phase: "propose",
      callbacks,
      scrubCanonical,
    }),
  ]);

  // ---------- PHASE 3: Senior-PM arbitration → final trade card ----------
  // Builder uses the configured Arbitrator model with the NEUTRAL system prompt
  // (no Bull/Bear persona). Its ONLY job is to arbitrate between the two
  // structure proposals and ship the trade — it cannot invent a structure
  // neither side proposed. The arbitrator is normally independent of A/B, but
  // the user can also pick "winner" to promote whichever side won the
  // directional verdict to Senior PM.
  let arbitrator: StrategistModelOption;
  let arbitratorOriginLabel: string;
  if (config.arbitratorModel === "winner") {
    if (verdict === "BULLISH") {
      arbitrator = config.modelA; // Bull persona is always A
      arbitratorOriginLabel = `${arbitrator.label} — promoted as Bull won verdict`;
    } else if (verdict === "BEARISH") {
      arbitrator = config.modelB; // Bear persona is always B
      arbitratorOriginLabel = `${arbitrator.label} — promoted as Bear won verdict`;
    } else {
      // SIDEWAYS — no clear winner; fall back to A so the run is deterministic.
      arbitrator = config.modelA;
      arbitratorOriginLabel = `${arbitrator.label} — sideways verdict, A picked as tiebreaker`;
    }
  } else {
    arbitrator = config.arbitratorModel;
    arbitratorOriginLabel = arbitrator.label;
  }
  const builderModelOpt: StrategistModelOption = {
    ...arbitrator,
    label: `Senior PM · ${arbitratorOriginLabel}`,
  };
  const chosenSide: "A" | "B" | "synthesis" = "synthesis";
  const chosenLabel = `Senior PM (${arbitratorOriginLabel}) — verdict: ${verdict}`;

  callbacks?.onStatus?.("Phase 3 — Senior PM arbitrating between structure proposals…");

  const buildResult = await runTurn({
    modelOpt: builderModelOpt,
    systemPrompt, // neutral — no persona suffix
    prompt: TRADE_BUILD_FROM_PROPOSALS_INSTRUCTION(
      verdict,
      bullConfidence,
      bearConfidence,
      s3a.text,
      s3b.text,
      r1a.text,
      r2a.text,
      r1b.text,
      r2b.text,
      dataPackage,
    ),
    round: "synthesis",
    role: "synthesis",
    phase: "final",
    callbacks,
    scrubCanonical,
  });

  const aggregateTrace = mergeTraces(
    mergeTraces(
      mergeTraces(mergeTraces(r1a.trace, r1b.trace), mergeTraces(r2a.trace, r2b.trace)),
      mergeTraces(s3a.trace, s3b.trace),
    ),
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
