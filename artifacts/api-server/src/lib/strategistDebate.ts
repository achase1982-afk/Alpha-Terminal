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
  convergence: 1 | 2 | 3;
}

export interface DebateOutcome {
  finalRawText: string;
  trace: WebSearchTrace;
  chosenSide: "A" | "B" | "synthesis";
  chosenLabel: string;
  finalAText: string;
  finalBText: string;
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

const PROPOSE_INSTRUCTION = (
  today: string,
  dataPackage: string,
  myPersonaName: string,
  otherPersonaName: string,
) =>
  `Today is ${today}. You are one of TWO strategists who will debate this trade. You are the **${myPersonaName}** strategist; the other side is the **${otherPersonaName}** strategist. Right now this is ROUND 1 — propose your initial trade independently, fully in role. Use web search per the WEB SEARCH MANDATE in your system prompt. Then output ONLY the JSON object specified by your system prompt. No markdown, no commentary.\n\n${dataPackage}`;

const CRITIQUE_INSTRUCTION = (
  mySide: "A" | "B",
  myProposal: string,
  otherProposal: string,
  myPersonaName: string,
  otherPersonaName: string,
) =>
  `ROUND 2 — critique and (optionally) revise. You are Strategist ${mySide} (the **${myPersonaName}** strategist). Below is your Round-1 proposal and the **${otherPersonaName}** strategist's Round-1 proposal. STAY IN ROLE — do not flip sides. You may adopt better technical elements (strikes, expiry, structure) from the other side IF they strengthen YOUR ${myPersonaName.toLowerCase()} thesis. Do not concede the directional view. If their analysis is technically wrong, say so. If yours is the better expression of your view, defend it.

Output a single JSON object with EXACTLY these two fields:
{
  "critique": "<2-5 sentences: what you think of the other proposal vs yours, focusing on edge, structure, vol, risk/reward, and catalyst>",
  "revisedProposal": <full strategist JSON object using your normal schema; this is what you currently believe is the best trade>
}

YOUR Round-1 proposal:
${myProposal}

OTHER strategist's Round-1 proposal:
${otherProposal}

Respond with ONLY the JSON object. No fences, no extra prose.`;

const CONVERGENCE_RULE = (convergence: 1 | 2 | 3) => {
  if (convergence === 1) {
    return `CONVERGENCE RULE FOR THIS DEBATE: After Round 3, the system compares both finals and SHIPS THE ONE WITH HIGHER CONFIDENCE — winner takes all, no merge. Calibrate your confidence honestly: do not inflate it to "win" the debate, and do not deflate it out of false humility. If the other strategist's case is genuinely stronger, your honest lower confidence will (and should) lose. If yours is stronger, set confidence accordingly.`;
  }
  if (convergence === 2) {
    return `CONVERGENCE RULE FOR THIS DEBATE: After Round 3, a synthesis pass will MERGE both your final and the other strategist's final into ONE trade. Your final does not have to "beat" theirs — it has to contribute the strongest version of your view. Lean into what is distinctly best in your analysis (a strike, a structure, a thesis angle, a risk you alone flagged). Do not hedge or try to cover both sides; the synthesis layer handles reconciliation.`;
  }
  return `CONVERGENCE RULE FOR THIS DEBATE: After Round 3, if you and the other strategist AGREE on direction (both bullish or both bearish), a synthesis pass merges both finals into one trade. If you DISAGREE on direction, the higher-confidence final ships and the other is discarded. Implication: when you genuinely converge with the other side, contribute the strongest distinct elements of your view (the synthesis will harmonize them). When you genuinely disagree, calibrate confidence honestly — inflated confidence to "win" a disagreement will produce a bad live trade.`;
};

const FINAL_INSTRUCTION = (
  mySide: "A" | "B",
  myRevised: string,
  otherRevised: string,
  otherCritique: string,
  convergence: 1 | 2 | 3,
  myPersonaName: string,
  otherPersonaName: string,
) =>
  `ROUND 3 — final commit. You are Strategist ${mySide} (the **${myPersonaName}** strategist). You have seen the **${otherPersonaName}** strategist's Round-2 critique of your work and their revised proposal. STAY IN ROLE. Commit to your final position now — the strongest possible expression of the ${myPersonaName.toLowerCase()} case for this name — and set your confidence honestly.

${CONVERGENCE_RULE(convergence)}

Output ONLY the JSON object specified by your system prompt — your final, committed trade. No markdown, no commentary.

YOUR Round-2 revised proposal:
${myRevised}

OTHER strategist's Round-2 critique of your proposal:
${otherCritique}

OTHER strategist's Round-2 revised proposal:
${otherRevised}`;

const SYNTHESIS_INSTRUCTION = (
  finalA: string,
  finalB: string,
  personaNameA: string,
  personaNameB: string,
) =>
  `Two strategists just finished a 3-round debate. Strategist A argued the **${personaNameA}** case; Strategist B argued the **${personaNameB}** case. You are now NEUTRAL — drop both roles and act as the senior PM making the actual capital allocation decision.

Your job: produce ONE merged final trade JSON. Weigh both sides on their evidence (vol, flow, Greeks, catalyst, structure, edge) — not on rhetoric. If one side's edge is materially stronger, ship that side's structure and explain why in the thesis. If both sides surface real edge in opposing directions, you may pick a vol-neutral or defined-risk structure that respects both views (iron condor, calendar, ratio) — but only if the data actually supports it; do not manufacture a "compromise" trade. If neither side has edge, set confidence low and warn accordingly. Confidence should reflect the merged conviction, not the average of the two.

Output ONLY the JSON object specified by your system prompt. No fences, no extra prose.

Strategist A (${personaNameA}) final commit:
${finalA}

Strategist B (${personaNameB}) final commit:
${finalB}`;

interface ParsedFinalForConvergence {
  raw: string;
  confidence: number;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL" | "UNKNOWN";
}

function quickParseFinal(raw: string): ParsedFinalForConvergence {
  // Best-effort extraction of confidence and inferred direction without
  // running the full validation. Convergence only needs these two fields;
  // the heavy parsing happens downstream in strategistV2.
  let confidence = 0;
  let direction: ParsedFinalForConvergence["direction"] = "UNKNOWN";
  try {
    const stripped = raw.replace(/^```(json)?/i, "").replace(/```\s*$/i, "").trim();
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const obj = JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
      const c = Number(obj.confidence);
      if (Number.isFinite(c)) confidence = c;
      const legs = Array.isArray(obj.legs) ? (obj.legs as Array<Record<string, unknown>>) : [];
      const buys = legs.filter((l) => l.action === "buy");
      const sells = legs.filter((l) => l.action === "sell");
      // Heuristic: net long calls or net short puts → bullish; net long puts or net short calls → bearish
      let bullishScore = 0;
      let bearishScore = 0;
      for (const l of buys) {
        if (l.type === "call") bullishScore += 1;
        if (l.type === "put") bearishScore += 1;
      }
      for (const l of sells) {
        if (l.type === "put") bullishScore += 1;
        if (l.type === "call") bearishScore += 1;
      }
      if (bullishScore > bearishScore) direction = "BULLISH";
      else if (bearishScore > bullishScore) direction = "BEARISH";
      else direction = "NEUTRAL";
    }
  } catch {
    // leave defaults
  }
  return { raw, confidence, direction };
}

function pickHigherConfidence(
  finalA: ParsedFinalForConvergence,
  finalB: ParsedFinalForConvergence,
): "A" | "B" {
  return finalB.confidence > finalA.confidence ? "B" : "A";
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

export async function runDebate(args: {
  systemPrompt: string;
  dataPackage: string;
  config: DebateConfig;
  /** Optional persona suffix appended to systemPrompt for Strategist A. */
  personaA?: string;
  /** Optional persona suffix appended to systemPrompt for Strategist B. */
  personaB?: string;
  /** Short display name for A's persona (e.g. "Bull"). Used in transcript chips and prompts. */
  personaNameA?: string;
  /** Short display name for B's persona (e.g. "Bear"). */
  personaNameB?: string;
  callbacks?: DebateCallbacks;
}): Promise<DebateOutcome> {
  const { systemPrompt, dataPackage, config, callbacks } = args;
  const personaNameA = args.personaNameA ?? "Strategist A";
  const personaNameB = args.personaNameB ?? "Strategist B";
  const sysA = args.personaA ? `${systemPrompt}\n\n${args.personaA}` : systemPrompt;
  const sysB = args.personaB ? `${systemPrompt}\n\n${args.personaB}` : systemPrompt;
  // Per-side display labels used in transcript chips and chosenLabel.
  // Wrap the model so its `label` carries the persona prefix without mutating
  // the caller's modelOpt.
  const modelADisplay: StrategistModelOption = {
    ...config.modelA,
    label: `${personaNameA} · ${config.modelA.label}`,
  };
  const modelBDisplay: StrategistModelOption = {
    ...config.modelB,
    label: `${personaNameB} · ${config.modelB.label}`,
  };
  const today = new Date().toISOString().slice(0, 10);

  callbacks?.onStatus?.(`Round 1 — ${personaNameA} and ${personaNameB} drafting independent proposals…`);

  // Round 1 — run A and B in parallel for speed (no cross-dependency yet).
  const [r1a, r1b] = await Promise.all([
    runTurn({
      modelOpt: modelADisplay, systemPrompt: sysA,
      prompt: PROPOSE_INSTRUCTION(today, dataPackage, personaNameA, personaNameB),
      round: 1, role: "A", phase: "propose", callbacks,
    }),
    runTurn({
      modelOpt: modelBDisplay, systemPrompt: sysB,
      prompt: PROPOSE_INSTRUCTION(today, dataPackage, personaNameB, personaNameA),
      round: 1, role: "B", phase: "propose", callbacks,
    }),
  ]);

  callbacks?.onStatus?.(`Round 2 — ${personaNameA} and ${personaNameB} critiquing each other…`);

  // Round 2 — each sees the other's R1 proposal and critiques + revises.
  const [r2a, r2b] = await Promise.all([
    runTurn({
      modelOpt: modelADisplay, systemPrompt: sysA,
      prompt: CRITIQUE_INSTRUCTION("A", r1a.text, r1b.text, personaNameA, personaNameB),
      round: 2, role: "A", phase: "critique", callbacks,
    }),
    runTurn({
      modelOpt: modelBDisplay, systemPrompt: sysB,
      prompt: CRITIQUE_INSTRUCTION("B", r1b.text, r1a.text, personaNameB, personaNameA),
      round: 2, role: "B", phase: "critique", callbacks,
    }),
  ]);

  // Extract revisedProposal text from each round-2 wrapper for use in round 3.
  const extractRevised = (raw: string): { critique: string; revised: string } => {
    try {
      const stripped = raw.replace(/^```(json)?/i, "").replace(/```\s*$/i, "").trim();
      const start = stripped.indexOf("{");
      const end = stripped.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const obj = JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
        const critique = typeof obj.critique === "string" ? obj.critique : "";
        const revised = obj.revisedProposal !== undefined ? JSON.stringify(obj.revisedProposal) : raw;
        return { critique, revised };
      }
    } catch {
      // fall through
    }
    return { critique: "", revised: raw };
  };
  const r2aParsed = extractRevised(r2a.text);
  const r2bParsed = extractRevised(r2b.text);

  callbacks?.onStatus?.(`Round 3 — ${personaNameA} and ${personaNameB} committing final positions…`);

  // Round 3 — final commit. Each sees the other's revised proposal and critique.
  const [r3a, r3b] = await Promise.all([
    runTurn({
      modelOpt: modelADisplay, systemPrompt: sysA,
      prompt: FINAL_INSTRUCTION("A", r2aParsed.revised, r2bParsed.revised, r2bParsed.critique, config.convergence, personaNameA, personaNameB),
      round: 3, role: "A", phase: "final", callbacks,
    }),
    runTurn({
      modelOpt: modelBDisplay, systemPrompt: sysB,
      prompt: FINAL_INSTRUCTION("B", r2bParsed.revised, r2aParsed.revised, r2aParsed.critique, config.convergence, personaNameB, personaNameA),
      round: 3, role: "B", phase: "final", callbacks,
    }),
  ]);

  const finalA = quickParseFinal(r3a.text);
  const finalB = quickParseFinal(r3b.text);

  logger.info(
    {
      convergence: config.convergence,
      finalAConfidence: finalA.confidence,
      finalADirection: finalA.direction,
      finalBConfidence: finalB.confidence,
      finalBDirection: finalB.direction,
      modelA: config.modelA.model,
      modelB: config.modelB.model,
    },
    "StrategistDebate: round 3 finals received",
  );

  // Choose convergence path
  const useSynthesis =
    config.convergence === 2 ||
    (config.convergence === 3 && finalA.direction === finalB.direction && finalA.direction !== "UNKNOWN");

  let chosenSide: "A" | "B" | "synthesis";
  let chosenLabel: string;
  let finalRawText: string;
  let aggregateTrace = mergeTraces(
    mergeTraces(mergeTraces(r1a.trace, r1b.trace), mergeTraces(r2a.trace, r2b.trace)),
    mergeTraces(r3a.trace, r3b.trace),
  );

  if (useSynthesis) {
    callbacks?.onStatus?.("Synthesis pass — neutral PM merging bull and bear into one trade…");
    // Synthesis is intentionally NEUTRAL — uses base systemPrompt without
    // either persona suffix so the synthesizer can pick the better-supported
    // side (or a vol-neutral structure) on its merits.
    const synthModel: StrategistModelOption = {
      ...config.modelA,
      label: `Synthesis · ${config.modelA.label}`,
    };
    const synth = await runTurn({
      modelOpt: synthModel,
      systemPrompt, // base, no persona
      prompt: SYNTHESIS_INSTRUCTION(r3a.text, r3b.text, personaNameA, personaNameB),
      round: "synthesis",
      role: "synthesis",
      phase: "synthesis",
      callbacks,
    });
    chosenSide = "synthesis";
    chosenLabel = `Synthesis (${config.modelA.label})`;
    finalRawText = synth.text;
    aggregateTrace = mergeTraces(aggregateTrace, synth.trace);
  } else {
    const winner = pickHigherConfidence(finalA, finalB);
    chosenSide = winner;
    chosenLabel =
      winner === "A"
        ? `${personaNameA} (${config.modelA.label})`
        : `${personaNameB} (${config.modelB.label})`;
    finalRawText = winner === "A" ? r3a.text : r3b.text;
  }

  return {
    finalRawText,
    trace: aggregateTrace,
    chosenSide,
    chosenLabel,
    finalAText: r3a.text,
    finalBText: r3b.text,
  };
}
