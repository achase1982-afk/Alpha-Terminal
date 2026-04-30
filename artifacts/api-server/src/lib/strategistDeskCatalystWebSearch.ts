/**
 * Desk-only: sequential structured web searches for the Catalyst Analyst.
 * Runs before the Catalyst JSON turn so Vol/Flow are unchanged.
 */

import { logger } from "./logger.js";
import {
  callAnthropicWithSystemAndWebSearch,
  callGeminiWithSystemAndWebSearch,
  callOpenAIWithSystemAndWebSearch,
  callXaiWithSystemAndWebSearch,
  type WebSearchTrace,
  type WebSearchResult,
} from "./aiLabAnalystClient.js";
import type { StrategistModelOption } from "./strategistSettings.js";
import type { CatalystEvaluation } from "./catalystEvaluator.js";

const SEARCH_SYSTEM = `You are a research assistant for an options catalyst desk. You MUST use the web search tool to gather current facts. Output only bullet points (max 18 lines), one fact per line, no URLs, no markdown fences, no JSON. If you find nothing substantive, output a single line: NO_USEFUL_RESULTS`;

/** Hard cap per structured-search LLM call (all providers). No retry on timeout — empty slot in briefing. */
const SEARCH_STEP_TIMEOUT_MS = 45_000;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * When the Catalyst desk slot uses Gemini, the pre-search path runs 4–5 sequential
 * `callGeminiWithSystemAndWebSearch` calls (thinking + Google Search each). That blocks
 * the entire Desk run before Vol/Flow/Catalyst JSON and feels "stuck on Catalyst."
 * Opt in with DESK_CATALYST_GEMINI_PRESEARCH=1 if you accept multi-minute latency.
 */
export const GEMINI_CATALYST_PRESEARCH_SKIPPED_BRIEFING = `## STRUCTURED RESEARCH (catalyst desk)
Pre-run web research was **not** executed for this run (Gemini Catalyst slot: sequential search is disabled by default to avoid long stalls before the analyst JSON turn). Set server env DESK_CATALYST_GEMINI_PRESEARCH=1 to enable it.
For themes you would normally fill from web (IR events, sell-side actions, earnings reaction history, sector peers, news), write **data not surfaced** unless the calendar snapshot supports them.`;

function emptyTrace(): WebSearchTrace {
  return { webSearchUsed: false, queries: [], sources: [] };
}

function mergeTraces(a: WebSearchTrace, b: WebSearchTrace): WebSearchTrace {
  const seen = new Set<string>();
  const sources = [...a.sources, ...b.sources].filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
  return {
    webSearchUsed: a.webSearchUsed || b.webSearchUsed,
    queries: [...a.queries, ...b.queries],
    sources,
  };
}

type SearchLogCtx = { ticker: string; stepNum: number; query: string };

async function runOneSearch(
  model: StrategistModelOption,
  userPrompt: string,
  logCtx?: SearchLogCtx,
): Promise<WebSearchResult> {
  const temperature = 0;
  switch (model.provider) {
    case "anthropic":
      return callAnthropicWithSystemAndWebSearch(model.model, temperature, SEARCH_SYSTEM, userPrompt);
    case "google": {
      const gemStart = Date.now();
      logger.info(
        {
          op: "catalyst_structured_search_step",
          desk: "catalyst_structured_search",
          ticker: logCtx?.ticker,
          stepNum: logCtx?.stepNum,
          query: logCtx?.query,
          phase: "callGeminiWithSystemAndWebSearch_start",
          at: nowIso(),
        },
        "StrategistDesk: catalyst structured search — callGeminiWithSystemAndWebSearch starting",
      );
      const r = await callGeminiWithSystemAndWebSearch(model.model, temperature, SEARCH_SYSTEM, userPrompt);
      logger.info(
        {
          op: "catalyst_structured_search_step",
          desk: "catalyst_structured_search",
          ticker: logCtx?.ticker,
          stepNum: logCtx?.stepNum,
          query: logCtx?.query,
          phase: "callGeminiWithSystemAndWebSearch_return",
          at: nowIso(),
          elapsedMs: Date.now() - gemStart,
          textChars: r.text?.length ?? 0,
        },
        "StrategistDesk: catalyst structured search — callGeminiWithSystemAndWebSearch returned",
      );
      return r;
    }
    case "openai":
      return callOpenAIWithSystemAndWebSearch(model.model, temperature, SEARCH_SYSTEM, userPrompt);
    case "xai":
      return callXaiWithSystemAndWebSearch(model.model, temperature, SEARCH_SYSTEM, userPrompt);
    default:
      throw new Error(`Unsupported provider for catalyst web search: ${(model as StrategistModelOption).provider}`);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, stepNum: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`step ${stepNum} timed out after 45s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function positionWindowLabel(expirationISO: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${today}_to_${expirationISO}`;
}

/** Notable = idiosyncratic catalyst, residual, or multiple scheduled items (busier window). */
function shouldRunNewsSearch(catalystEval: CatalystEvaluation | null): boolean {
  if (!catalystEval?.catalystInWindow) return false;
  if (catalystEval.catalystScope === "NAME_SPECIFIC" || catalystEval.catalystScope === "BOTH") return true;
  if (catalystEval.residualCatalyst) return true;
  if (catalystEval.scheduledEvents.length >= 2) return true;
  return false;
}

export interface CatalystDeskSearchBundle {
  briefing: string;
  trace: WebSearchTrace;
}

/**
 * Runs up to 5 sequential web searches using the Catalyst desk model (same registry slot).
 * Logs query + source count per search for telemetry.
 */
export async function runCatalystDeskStructuredSearches(opts: {
  ticker: string;
  catalystEval: CatalystEvaluation | null;
  deskExpirationISO: string;
  model: StrategistModelOption;
  onStatus?: (s: string) => void;
}): Promise<CatalystDeskSearchBundle> {
  const { ticker, catalystEval, deskExpirationISO, model, onStatus } = opts;
  const upper = ticker.toUpperCase();

  if (model.provider === "google" && process.env["DESK_CATALYST_GEMINI_PRESEARCH"] !== "1") {
    logger.info(
      { ticker: upper, provider: "google", desk: "catalyst_structured_search" },
      "StrategistDesk: skipping sequential catalyst web pre-search for Gemini Catalyst (set DESK_CATALYST_GEMINI_PRESEARCH=1 to enable — each step can take several minutes)",
    );
    onStatus?.("Desk — Catalyst web pre-search skipped (Gemini; avoids long stall — set DESK_CATALYST_GEMINI_PRESEARCH=1 to enable)…");
    return { briefing: GEMINI_CATALYST_PRESEARCH_SKIPPED_BRIEFING, trace: emptyTrace() };
  }

  const y = new Date().getUTCFullYear();
  const windowDates = positionWindowLabel(deskExpirationISO);

  const q1 = `${upper} investor relations events calendar ${y}`;
  const q2 = `${upper} analyst price target upgrade downgrade ${y}`;
  const q3 = `${upper} earnings history reactions stock move 2025 2026`;
  const q4 = `${upper} sector ETF peers comparison`;
  const q5 = `${upper} news catalyst ${windowDates}`;

  const sections: string[] = [];
  let accTrace = emptyTrace();

  const run = async (stepNum: number, label: string, query: string, extraInstructions: string) => {
    onStatus?.(`Desk — Catalyst research: ${label}…`);
    const stepStartMs = Date.now();
    logger.info(
      {
        op: "catalyst_structured_search_step",
        desk: "catalyst_structured_search",
        ticker: upper,
        stepNum,
        label,
        phase: "step_start",
        query,
        at: nowIso(),
      },
      "StrategistDesk: catalyst structured search — step start",
    );

    const userPrompt =
      `Execute a web search focused on this exact query: ${query}\n\n` +
      `Source priority when choosing what to cite internally: (1) company IR and SEC, (2) major financial press, (3) established research aggregators, (4) corroborated secondary sources. Skip low-quality content farms.\n\n` +
      `${extraInstructions}`;

    const llmInvokeStartMs = Date.now();
    logger.info(
      {
        op: "catalyst_structured_search_step",
        desk: "catalyst_structured_search",
        ticker: upper,
        stepNum,
        label,
        phase: "provider_llm_call_start",
        provider: model.provider,
        query,
        at: nowIso(),
        msSinceStepStart: llmInvokeStartMs - stepStartMs,
      },
      "StrategistDesk: catalyst structured search — provider LLM call starting (wrapped in timeout)",
    );

    try {
      const r = await withTimeout(
        runOneSearch(model, userPrompt, { ticker: upper, stepNum, query }),
        SEARCH_STEP_TIMEOUT_MS,
        stepNum,
      );
      const doneMs = Date.now();
      const elapsedMs = doneMs - llmInvokeStartMs;
      const n = r.trace.sources.length;
      const body = r.text.trim() || "NO_USEFUL_RESULTS";
      logger.info(
        {
          op: "catalyst_structured_search_step",
          desk: "catalyst_structured_search",
          ticker: upper,
          stepNum,
          label,
          phase: "provider_llm_call_done",
          query,
          at: nowIso(),
          elapsedMs,
          textChars: r.text?.length ?? 0,
          trimmedBodyChars: body.length,
          resultCount: n,
        },
        "StrategistDesk: catalyst structured search — step completed",
      );
      accTrace = mergeTraces(accTrace, r.trace);
      sections.push(`### ${label}\nExecuted query: ${query}\nResults returned (sources): ${n}\n\n${body}`);
    } catch (err) {
      const doneMs = Date.now();
      const elapsedMs = doneMs - llmInvokeStartMs;
      const msg = err instanceof Error ? err.message : String(err);
      const timedOut = msg.includes("timed out after 45s");
      if (timedOut) {
        logger.warn(
          {
            op: "catalyst_structured_search_step",
            desk: "catalyst_structured_search",
            ticker: upper,
            stepNum,
            label,
            phase: "provider_llm_call_timeout",
            query,
            at: nowIso(),
            elapsedMs,
            errorMessage: msg,
            errorChars: msg.length,
            note: "Underlying HTTP request is not aborted; Gemini may still complete server-side.",
          },
          "StrategistDesk: catalyst structured search — step timed out (empty briefing slot)",
        );
      } else {
        logger.warn(
          {
            op: "catalyst_structured_search_step",
            desk: "catalyst_structured_search",
            ticker: upper,
            stepNum,
            label,
            phase: "provider_llm_call_error",
            query,
            at: nowIso(),
            elapsedMs,
            errorMessage: msg,
            errorChars: msg.length,
          },
          "StrategistDesk: catalyst structured search — step failed",
        );
      }
      // Empty briefing for this slot (no retry); keep heading for traceability in composed doc
      sections.push(`### ${label}\n`);
    }
  };

  await run(
    1,
    "Search 1 — IR / company-hosted events",
    q1,
    "Goal: investor days, conference participation, product or AI days, capital markets days, company-hosted events in the position window.",
  );
  await run(
    2,
    "Search 2 — Analyst targets and coverage",
    q2,
    "Goal: price target changes and upgrades/downgrades in roughly the last 60 days.",
  );
  await run(
    3,
    "Search 3 — Earnings history and reactions",
    q3,
    "Goal: implied vs realized moves, gap direction, magnitude patterns around past prints.",
  );
  await run(
    4,
    "Search 4 — Sector ETF and peers",
    q4,
    "Goal: sector ETF, key peers, relative industry context.",
  );

  if (shouldRunNewsSearch(catalystEval)) {
    await run(
      5,
      "Search 5 — News and event-driven (conditional)",
      q5,
      "Goal: recent news, regulatory actions, partnerships, or event-driven items relevant to the position window.",
    );
  } else {
    logger.info(
      {
        ticker: upper,
        desk: "catalyst_structured_search",
        stepNum: 5,
        label: "Search 5 skipped",
        phase: "step_skipped_gating",
        reason: "no_notable_window_trigger",
        at: nowIso(),
      },
      "StrategistDesk: catalyst structured search — Search 5 not run (gating)",
    );
  }

  const briefing =
    `## STRUCTURED RESEARCH (catalyst desk)\n` +
    `Use this block with the calendar snapshot. For any theme with no usable facts, write the phrase "data not surfaced" in the matching JSON field (primary_catalyst, bar_to_clear, asymmetry, historical_pattern, or read) instead of inventing.\n` +
    `Do not paste URLs or name where you read it; synthesize like a desk analyst.\n\n` +
    sections.join("\n\n");

  return { briefing, trace: accTrace };
}
