import { logger } from "./logger.js";
import {
  streamCallAnthropicWithSystemAndWebSearch,
  streamCallGeminiWithSystemAndWebSearch,
  streamCallOpenAIWithSystemAndWebSearch,
  streamCallXaiWithSystemAndWebSearch,
  extractJson,
  type WebSearchResult,
  type WebSearchTrace,
} from "./aiLabAnalystClient.js";
import { getStrategistModel, type StrategistModelOption, type StrategistConfig } from "./strategistSettings.js";
import {
  VolAnalystOutputSchema,
  FlowAnalystOutputSchema,
  CatalystAnalystOutputSchema,
  PmOutputSchema,
  type VolAnalystOutput,
  type FlowAnalystOutput,
  type CatalystAnalystOutput,
  type PmOutput,
  type DeskResult,
} from "./strategistDeskSchemas.js";
import {
  buildVolAnalystPrompt,
  buildFlowAnalystPrompt,
  buildCatalystAnalystPrompt,
  buildPmPrompt,
} from "./strategistDeskPrompts.js";
import type { DebateRound, DebateRole, DebatePhase } from "./strategistDebate.js";

const TEMPERATURE = 0;

export interface DeskCallbacks {
  onTurnStart?: (turn: {
    id: string;
    round: DebateRound | "desk";
    role: DebateRole | "vol" | "flow" | "catalyst" | "pm";
    phase: DebatePhase | "analyst" | "pm";
    model: string;
    label: string;
    startedAt: number;
  }) => void;
  onTurnDelta?: (turnId: string, delta: string) => void;
  onTurnDone?: (turnId: string, finalText: string) => void;
  onStatus?: (status: string) => void;
}

let turnSeq = 0;
function newTurnId(): string {
  turnSeq += 1;
  return `desk_${Date.now().toString(36)}_${turnSeq}`;
}

async function streamModel(
  modelOpt: StrategistModelOption,
  systemPrompt: string,
  prompt: string,
  onDelta: (text: string) => void,
  onStatus?: (s: string) => void,
): Promise<WebSearchResult> {
  if (modelOpt.provider === "anthropic") {
    return streamCallAnthropicWithSystemAndWebSearch(modelOpt.model, TEMPERATURE, systemPrompt, prompt, onDelta, onStatus);
  }
  if (modelOpt.provider === "openai") {
    return streamCallOpenAIWithSystemAndWebSearch(modelOpt.model, TEMPERATURE, systemPrompt, prompt, onDelta, onStatus);
  }
  if (modelOpt.provider === "xai") {
    return streamCallXaiWithSystemAndWebSearch(modelOpt.model, TEMPERATURE, systemPrompt, prompt, onDelta, onStatus);
  }
  return streamCallGeminiWithSystemAndWebSearch(modelOpt.model, TEMPERATURE, systemPrompt, prompt, onDelta, onStatus);
}

async function runDeskTurn<T>(args: {
  modelOpt: StrategistModelOption;
  prompt: string;
  role: "vol" | "flow" | "catalyst" | "pm";
  label: string;
  callbacks?: DeskCallbacks;
}): Promise<{ text: string; trace: WebSearchTrace; turnId: string }> {
  const { modelOpt, prompt, role, label, callbacks } = args;
  const turnId = newTurnId();
  callbacks?.onTurnStart?.({
    id: turnId,
    round: "desk" as any,
    role: role as any,
    phase: role === "pm" ? "pm" as any : "analyst" as any,
    model: modelOpt.model,
    label,
    startedAt: Date.now(),
  });

  let acc = "";
  const onDelta = (delta: string) => {
    acc += delta;
    callbacks?.onTurnDelta?.(turnId, delta);
  };

  try {
    const systemPrompt = "You are a specialist analyst on an options trading desk. Respond only with JSON as instructed.";
    const r = await streamModel(modelOpt, systemPrompt, prompt, onDelta, (s) => callbacks?.onStatus?.(s));
    callbacks?.onTurnDone?.(turnId, r.text);
    return { text: r.text, trace: r.trace, turnId };
  } catch (err) {
    const errMsg = `\n\n[error: ${err instanceof Error ? err.message : String(err)}]`;
    callbacks?.onTurnDone?.(turnId, acc + errMsg);
    throw err;
  }
}

function parseJsonFromText(raw: string): Record<string, unknown> | null {
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

function mergeTraces(...traces: WebSearchTrace[]): WebSearchTrace {
  const seenUrls = new Set<string>();
  const sources = traces.flatMap(t => t.sources).filter(s => {
    if (seenUrls.has(s.url)) return false;
    seenUrls.add(s.url);
    return true;
  });
  return {
    webSearchUsed: traces.some(t => t.webSearchUsed),
    queries: [...new Set(traces.flatMap(t => t.queries))],
    sources,
  };
}

export async function runDeskAnalysis(args: {
  dataPackage: string;
  settings: StrategistConfig;
  ticker: string;
  callbacks?: DeskCallbacks;
}): Promise<DeskResult> {
  const { dataPackage, settings, ticker, callbacks } = args;

  const volModel = getStrategistModel(settings.strategistSoloModelIdx);
  const flowModel = getStrategistModel(settings.strategistDebateAModelIdx);
  const catalystModel = getStrategistModel(settings.strategistDebateBModelIdx);
  const pmModelIdx = settings.strategistArbitratorModelIdx === -1 ? 0 : settings.strategistArbitratorModelIdx;
  const pmModel = getStrategistModel(pmModelIdx);

  const errors: string[] = [];

  callbacks?.onStatus?.("Desk — Vol, Flow, and Catalyst analysts running in parallel…");

  const [volResult, flowResult, catalystResult] = await Promise.all([
    runAnalystWithRetry("vol", volModel, buildVolAnalystPrompt(dataPackage), VolAnalystOutputSchema, callbacks, errors),
    runAnalystWithRetry("flow", flowModel, buildFlowAnalystPrompt(dataPackage), FlowAnalystOutputSchema, callbacks, errors),
    runAnalystWithRetry("catalyst", catalystModel, buildCatalystAnalystPrompt(dataPackage), CatalystAnalystOutputSchema, callbacks, errors),
  ]);

  callbacks?.onStatus?.("Desk — PM synthesizing analyst reads…");

  const pmPrompt = buildPmPrompt(
    dataPackage,
    JSON.stringify(volResult.parsed),
    JSON.stringify(flowResult.parsed),
    JSON.stringify(catalystResult.parsed),
  );

  const pmTurn = await runDeskTurn({
    modelOpt: pmModel,
    prompt: pmPrompt,
    role: "pm",
    label: `PM · ${pmModel.label}`,
    callbacks,
  });

  let pmParsed: PmOutput;
  const pmJson = parseJsonFromText(pmTurn.text);
  const pmValidation = PmOutputSchema.safeParse(pmJson);
  if (pmValidation.success) {
    pmParsed = pmValidation.data;
  } else {
    callbacks?.onStatus?.("Desk — PM output failed validation, retrying…");
    logger.warn({ errors: pmValidation.error.issues, ticker }, "StrategistDesk: PM output failed validation, retrying");
    const retryTurn = await runDeskTurn({
      modelOpt: pmModel,
      prompt: pmPrompt + "\n\nYour previous response failed JSON validation. Please respond with ONLY valid JSON matching the schema exactly.",
      role: "pm",
      label: `PM (retry) · ${pmModel.label}`,
      callbacks,
    });
    const retryJson = parseJsonFromText(retryTurn.text);
    const retryValidation = PmOutputSchema.safeParse(retryJson);
    if (retryValidation.success) {
      pmParsed = retryValidation.data;
    } else {
      errors.push(`PM output failed validation after retry: ${retryValidation.error.issues.map(i => i.message).join("; ")}`);
      pmParsed = {
        decision: "pass",
        structure: null,
        thesis: retryTurn.text.slice(0, 500),
        size: "small",
        whose_side: "neither",
        biggest_risk: "PM output could not be parsed",
        exit_plan: { profit_target: 0, stop_loss: 0, time_stop: "" },
        watch_for: "PM validation failure — retry the analysis",
      };
    }
  }

  return {
    mode: "desk",
    ticker,
    vol: volResult.parsed,
    flow: flowResult.parsed,
    catalyst: catalystResult.parsed,
    pm: pmParsed,
    models: {
      vol: volModel.label,
      flow: flowModel.label,
      catalyst: catalystModel.label,
      pm: pmModel.label,
    },
    errors: errors.length > 0 ? errors : undefined,
  };
}

async function runAnalystWithRetry<T>(
  role: "vol" | "flow" | "catalyst",
  model: StrategistModelOption,
  prompt: string,
  schema: { safeParse: (d: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } } },
  callbacks: DeskCallbacks | undefined,
  errors: string[],
): Promise<{ parsed: T; trace: WebSearchTrace }> {
  const labels: Record<string, string> = {
    vol: "Vol Analyst",
    flow: "Flow Analyst",
    catalyst: "Catalyst Analyst",
  };
  const label = `${labels[role]} · ${model.label}`;

  const turn = await runDeskTurn({ modelOpt: model, prompt, role, label, callbacks });
  const json = parseJsonFromText(turn.text);
  const validation = schema.safeParse(json);

  if (validation.success) {
    return { parsed: validation.data, trace: turn.trace };
  }

  logger.warn({ role, errors: validation.error.issues }, `StrategistDesk: ${role} output failed validation, retrying`);
  callbacks?.onStatus?.(`Desk — ${labels[role]} output failed validation, retrying…`);

  const retryTurn = await runDeskTurn({
    modelOpt: model,
    prompt: prompt + "\n\nYour previous response failed JSON validation. Please respond with ONLY valid JSON matching the schema exactly.",
    role,
    label: `${labels[role]} (retry) · ${model.label}`,
    callbacks,
  });

  const retryJson = parseJsonFromText(retryTurn.text);
  const retryValidation = schema.safeParse(retryJson);

  if (retryValidation.success) {
    return { parsed: retryValidation.data, trace: mergeTraces(turn.trace, retryTurn.trace) };
  }

  const errorMsg = `${labels[role]} output failed validation after retry: ${retryValidation.error.issues.map(i => i.message).join("; ")}`;
  errors.push(errorMsg);
  logger.error({ role, ticker: "unknown" }, `StrategistDesk: ${errorMsg}`);

  const fallback = buildFallbackOutput(role, retryTurn.text);
  return { parsed: fallback as T, trace: mergeTraces(turn.trace, retryTurn.trace) };
}

function buildFallbackOutput(role: "vol" | "flow" | "catalyst", rawText: string): unknown {
  const snippet = rawText.slice(0, 500);
  if (role === "vol") {
    return {
      iv_state: "Unable to parse — see raw output",
      term_structure: "Unable to parse",
      skew: "Unable to parse",
      implied_vs_realized: "Unable to parse",
      read: snippet,
    };
  }
  if (role === "flow") {
    return {
      dominant_flow: "Unable to parse — see raw output",
      institutional_signal: "Unable to parse",
      retail_signal: "Unable to parse",
      key_strikes: [],
      read: snippet,
    };
  }
  return {
    primary_catalyst: "Unable to parse — see raw output",
    bar_to_clear: "Unable to parse",
    asymmetry: "Unable to parse",
    historical_pattern: "Unable to parse",
    read: snippet,
  };
}
