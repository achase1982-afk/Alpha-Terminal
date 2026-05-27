import type { FlaggedName, MoversCatalystType, Situation } from "@workspace/movers-types";
import { classifyCatalystTypeFromHeadline } from "@workspace/movers-types";
import pLimit from "p-limit";
import type { MoversNewsHeadline } from "./fmpMoversNews.js";
import { fetchHeadlinesForSituation } from "./fmpMoversNews.js";
import { getCatalystAttributionFromCache } from "./moversCatalystAttributionCache.js";
import { buildMoversNewsKey, pickCatalystHeadline } from "./moversNewsKey.js";
import {
  classifyUnknownResidualWithTier2,
  type Tier2UnknownCandidate,
} from "./moversTier2Catalyst.js";
import { logger } from "../logger.js";

const classifyLimit = pLimit(6);

const DEFINITE_TYPES: MoversCatalystType[] = [
  "GOV",
  "ANALYST",
  "CONTRACT",
  "EARNINGS",
  "MA",
  "SECTOR",
];

type Tier1Outcome =
  | { kind: "classified"; situation: Situation; headlines: MoversNewsHeadline[] }
  | { kind: "flagged"; flagged: FlaggedName[] };

function isTier1Definite(type: MoversCatalystType): boolean {
  return DEFINITE_TYPES.includes(type);
}

function logMoversCatalystTelemetry(
  tier1Assigned: number,
  tier2Assigned: number,
  tier2CacheHits: number,
  tier2LlmBatchSize: number,
  situations: Situation[],
): void {
  let finalNone = 0;
  for (const s of situations) {
    if (s.catalystType === "NONE") finalNone += 1;
  }
  logger.info(
    {
      tier1Assigned,
      tier2Assigned,
      tier2CacheHits,
      tier2LlmBatchSize,
      finalNone,
      situations: situations.length,
    },
    "Movers catalyst tier counts",
  );
}

export async function applyDeterministicCatalystToSituations(
  situations: Situation[],
): Promise<{ situations: Situation[]; flagged: FlaggedName[] }> {
  const results: Array<Tier1Outcome & { index: number }> = [];
  let tier1Assigned = 0;

  await Promise.all(
    situations.map((situation, index) =>
      classifyLimit(async () => {
        try {
          const headlines = await fetchHeadlinesForSituation(situation);
          const driving = pickCatalystHeadline(headlines);
          if (!driving) {
            results.push({
              index,
              kind: "classified",
              headlines,
              situation: {
                ...situation,
                catalystType: "NONE",
                catalyst: "",
                newsKey: "",
              },
            });
            return;
          }
          const newsKey = buildMoversNewsKey(driving);
          let catalystType = classifyCatalystTypeFromHeadline(driving.title);
          let catalyst = driving.title.trim();

          const cachedAttr = await getCatalystAttributionFromCache(newsKey);
          if (cachedAttr) {
            catalystType = cachedAttr.catalystType;
            catalyst = cachedAttr.catalystSummary;
            if (isTier1Definite(catalystType)) tier1Assigned += 1;
          } else if (isTier1Definite(catalystType)) {
            tier1Assigned += 1;
          }

          results.push({
            index,
            kind: "classified",
            headlines,
            situation: {
              ...situation,
              catalystType,
              catalyst,
              newsKey,
            },
          });
        } catch (err) {
          logger.warn({ err, situationId: situation.id }, "Movers deterministic catalyst failed");
          results.push({
            index,
            kind: "flagged",
            flagged: situation.tickers.map((t) => ({
              symbol: t.symbol,
              name: t.name,
              price: t.price,
              changePct: t.changePct,
              note: "Catalyst classification unavailable",
            })),
          });
        }
      }),
    ),
  );

  const flaggedOut: FlaggedName[] = [];
  const tier1ByIndex = new Map<number, Tier1Outcome & { kind: "classified" }>();
  for (const r of results) {
    if (r.kind === "flagged") {
      flaggedOut.push(...r.flagged);
      continue;
    }
    tier1ByIndex.set(r.index, r);
  }

  const unknownCandidates: Tier2UnknownCandidate[] = [];
  for (const r of tier1ByIndex.values()) {
    if (r.situation.catalystType !== "UNKNOWN") continue;
    const cachedAttr = r.situation.newsKey
      ? await getCatalystAttributionFromCache(r.situation.newsKey)
      : null;
    if (cachedAttr) continue;
    unknownCandidates.push({ situation: r.situation, headlines: r.headlines });
  }

  const {
    situations: tier2Updated,
    tier2Assigned,
    tier2CacheHits,
    tier2LlmBatchSize,
  } = await classifyUnknownResidualWithTier2(unknownCandidates);

  const tier2ById = new Map(tier2Updated.map((s) => [s.id, s]));

  const situationsOut: Situation[] = [];
  for (let i = 0; i < situations.length; i++) {
    const row = tier1ByIndex.get(i);
    if (!row) continue;
    situationsOut.push(tier2ById.get(row.situation.id) ?? row.situation);
  }

  situationsOut.sort((a, b) => {
    const aPct = Math.max(...a.tickers.map((t) => Math.abs(t.changePct)));
    const bPct = Math.max(...b.tickers.map((t) => Math.abs(t.changePct)));
    return bPct - aPct;
  });

  logMoversCatalystTelemetry(
    tier1Assigned,
    tier2Assigned,
    tier2CacheHits,
    tier2LlmBatchSize,
    situationsOut,
  );

  return { situations: situationsOut, flagged: flaggedOut };
}
