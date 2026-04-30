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

async function runOneSearch(
  model: StrategistModelOption,
  userPrompt: string,
): Promise<WebSearchResult> {
  const temperature = 0;
  switch (model.provider) {
    case "anthropic":
      return callAnthropicWithSystemAndWebSearch(model.model, temperature, SEARCH_SYSTEM, userPrompt);
    case "google":
      return callGeminiWithSystemAndWebSearch(model.model, temperature, SEARCH_SYSTEM, userPrompt);
    case "openai":
      return callOpenAIWithSystemAndWebSearch(model.model, temperature, SEARCH_SYSTEM, userPrompt);
    case "xai":
      return callXaiWithSystemAndWebSearch(model.model, temperature, SEARCH_SYSTEM, userPrompt);
    default:
      throw new Error(`Unsupported provider for catalyst web search: ${(model as StrategistModelOption).provider}`);
  }
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
  const y = new Date().getUTCFullYear();
  const windowDates = positionWindowLabel(deskExpirationISO);

  const q1 = `${upper} investor relations events calendar ${y}`;
  const q2 = `${upper} analyst price target upgrade downgrade ${y}`;
  const q3 = `${upper} earnings history reactions stock move 2025 2026`;
  const q4 = `${upper} sector ETF peers comparison`;
  const q5 = `${upper} news catalyst ${windowDates}`;

  const sections: string[] = [];
  let accTrace = emptyTrace();

  const run = async (label: string, query: string, extraInstructions: string) => {
    onStatus?.(`Desk — Catalyst research: ${label}…`);
    const userPrompt =
      `Execute a web search focused on this exact query: ${query}\n\n` +
      `Source priority when choosing what to cite internally: (1) company IR and SEC, (2) major financial press, (3) established research aggregators, (4) corroborated secondary sources. Skip low-quality content farms.\n\n` +
      `${extraInstructions}`;
    try {
      const r = await runOneSearch(model, userPrompt);
      const n = r.trace.sources.length;
      logger.info(
        { ticker: upper, desk: "catalyst_structured_search", label, query, resultCount: n },
        "StrategistDesk: catalyst structured search step",
      );
      accTrace = mergeTraces(accTrace, r.trace);
      const body = r.text.trim() || "NO_USEFUL_RESULTS";
      sections.push(`### ${label}\nExecuted query: ${query}\nResults returned (sources): ${n}\n\n${body}`);
    } catch (err) {
      logger.warn(
        { ticker: upper, desk: "catalyst_structured_search", label, query, err: err instanceof Error ? err.message : String(err) },
        "StrategistDesk: catalyst structured search step failed",
      );
      sections.push(`### ${label}\nExecuted query: ${query}\nResults returned (sources): 0\n\nSEARCH_FAILED`);
    }
  };

  await run(
    "Search 1 — IR / company-hosted events",
    q1,
    "Goal: investor days, conference participation, product or AI days, capital markets days, company-hosted events in the position window.",
  );
  await run(
    "Search 2 — Analyst targets and coverage",
    q2,
    "Goal: price target changes and upgrades/downgrades in roughly the last 60 days.",
  );
  await run(
    "Search 3 — Earnings history and reactions",
    q3,
    "Goal: implied vs realized moves, gap direction, magnitude patterns around past prints.",
  );
  await run(
    "Search 4 — Sector ETF and peers",
    q4,
    "Goal: sector ETF, key peers, relative industry context.",
  );

  if (shouldRunNewsSearch(catalystEval)) {
    await run(
      "Search 5 — News and event-driven (conditional)",
      q5,
      "Goal: recent news, regulatory actions, partnerships, or event-driven items relevant to the position window.",
    );
  } else {
    logger.info(
      { ticker: upper, desk: "catalyst_structured_search", label: "Search 5 skipped", reason: "no_notable_window_trigger" },
      "StrategistDesk: catalyst structured search step",
    );
  }

  const briefing =
    `## STRUCTURED RESEARCH (catalyst desk)\n` +
    `Use this block with the calendar snapshot. For any theme with no usable facts, write the phrase "data not surfaced" in the matching JSON field (primary_catalyst, bar_to_clear, asymmetry, historical_pattern, or read) instead of inventing.\n` +
    `Do not paste URLs or name where you read it; synthesize like a desk analyst.\n\n` +
    sections.join("\n\n");

  return { briefing, trace: accTrace };
}
