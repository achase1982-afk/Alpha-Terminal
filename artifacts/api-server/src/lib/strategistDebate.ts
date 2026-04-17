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

const PROPOSE_INSTRUCTION = (today: string, dataPackage: string) =>
  `Today is ${today}. You are one of TWO strategists who will debate this trade. Right now this is ROUND 1 — propose your initial trade independently. Use web search per the WEB SEARCH MANDATE in your system prompt. Then output ONLY the JSON object specified by your system prompt. No markdown, no commentary.\n\n${dataPackage}`;

const CRITIQUE_INSTRUCTION = (mySide: "A" | "B", myProposal: string, otherProposal: string) =>
  `ROUND 2 — critique and (optionally) revise. You are Strategist ${mySide}. Below is your Round-1 proposal and the other strategist's Round-1 proposal. Compare them honestly. If their structure is materially better, say so and adopt the better elements. If yours is better, defend it. If neither is right, propose something different.

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

const FINAL_INSTRUCTION = (mySide: "A" | "B", myRevised: string, otherRevised: string, otherCritique: string) =>
  `ROUND 3 — final commit. You are Strategist ${mySide}. You have seen the other strategist's Round-2 critique of your work and their revised proposal. Commit to your final position now and set your confidence honestly.

Output ONLY the JSON object specified by your system prompt — your final, committed trade. No markdown, no commentary.

YOUR Round-2 revised proposal:
${myRevised}

OTHER strategist's Round-2 critique of your proposal:
${otherCritique}

OTHER strategist's Round-2 revised proposal:
${otherRevised}`;

const SYNTHESIS_INSTRUCTION = (finalA: string, finalB: string) =>
  `Two strategists just finished a 3-round debate. Both have committed final proposals. Your job: produce ONE merged final trade JSON. Take the structure that has the strongest combined edge — borrow strikes/expiry/sizing from whichever side argued it best. If they agree on direction and structure, lean toward the higher-confidence version but harmonize the thesis prose. If they disagree on direction, pick the side with the stronger documented edge (not just higher confidence) and explain why in the thesis. Confidence should reflect the merged conviction, not the average.

Output ONLY the JSON object specified by your system prompt. No fences, no extra prose.

Strategist A's final commit:
${finalA}

Strategist B's final commit:
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
  callbacks?: DebateCallbacks;
}): Promise<DebateOutcome> {
  const { systemPrompt, dataPackage, config, callbacks } = args;
  const today = new Date().toISOString().slice(0, 10);

  callbacks?.onStatus?.("Round 1 — strategists drafting independent proposals…");

  const r1Prompt = PROPOSE_INSTRUCTION(today, dataPackage);

  // Round 1 — run A and B in parallel for speed (no cross-dependency yet).
  const [r1a, r1b] = await Promise.all([
    runTurn({
      modelOpt: config.modelA, systemPrompt, prompt: r1Prompt,
      round: 1, role: "A", phase: "propose", callbacks,
    }),
    runTurn({
      modelOpt: config.modelB, systemPrompt, prompt: r1Prompt,
      round: 1, role: "B", phase: "propose", callbacks,
    }),
  ]);

  callbacks?.onStatus?.("Round 2 — strategists critiquing each other…");

  // Round 2 — each sees the other's R1 proposal and critiques + revises.
  const [r2a, r2b] = await Promise.all([
    runTurn({
      modelOpt: config.modelA, systemPrompt,
      prompt: CRITIQUE_INSTRUCTION("A", r1a.text, r1b.text),
      round: 2, role: "A", phase: "critique", callbacks,
    }),
    runTurn({
      modelOpt: config.modelB, systemPrompt,
      prompt: CRITIQUE_INSTRUCTION("B", r1b.text, r1a.text),
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

  callbacks?.onStatus?.("Round 3 — strategists committing final positions…");

  // Round 3 — final commit. Each sees the other's revised proposal and critique.
  const [r3a, r3b] = await Promise.all([
    runTurn({
      modelOpt: config.modelA, systemPrompt,
      prompt: FINAL_INSTRUCTION("A", r2aParsed.revised, r2bParsed.revised, r2bParsed.critique),
      round: 3, role: "A", phase: "final", callbacks,
    }),
    runTurn({
      modelOpt: config.modelB, systemPrompt,
      prompt: FINAL_INSTRUCTION("B", r2bParsed.revised, r2aParsed.revised, r2aParsed.critique),
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
    callbacks?.onStatus?.("Synthesis pass — merging both finals into one report…");
    const synth = await runTurn({
      modelOpt: config.modelA, // synthesis runs on Strategist A's model by convention
      systemPrompt,
      prompt: SYNTHESIS_INSTRUCTION(r3a.text, r3b.text),
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
    chosenLabel = winner === "A" ? `Strategist A (${config.modelA.label})` : `Strategist B (${config.modelB.label})`;
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
