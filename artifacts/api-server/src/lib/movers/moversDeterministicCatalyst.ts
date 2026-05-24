import type { FlaggedName, MoversCatalystType, Situation } from "@workspace/movers-types";
import { classifyCatalystTypeFromHeadline } from "@workspace/movers-types";
import pLimit from "p-limit";
import { fetchHeadlinesForSituation } from "./fmpMoversNews.js";
import { buildMoversNewsKey, pickDrivingHeadline } from "./moversNewsKey.js";
import { logger } from "../logger.js";

const classifyLimit = pLimit(6);

const TELEMETRY_CATALYST_TYPES: MoversCatalystType[] = [
  "GOV",
  "ANALYST",
  "CONTRACT",
  "EARNINGS",
  "MA",
  "SECTOR",
  "UNKNOWN",
  "NONE",
];

function logMoversCatalystTypeCounts(situations: Situation[]): void {
  const catalystTypeCounts = Object.fromEntries(
    TELEMETRY_CATALYST_TYPES.map((t) => [t, 0]),
  ) as Record<MoversCatalystType, number>;
  for (const s of situations) {
    const key = TELEMETRY_CATALYST_TYPES.includes(s.catalystType)
      ? s.catalystType
      : "UNKNOWN";
    catalystTypeCounts[key] += 1;
  }
  logger.info(
    { catalystTypeCounts, situations: situations.length },
    "Movers catalyst type counts",
  );
}

export async function applyDeterministicCatalystToSituations(
  situations: Situation[],
): Promise<{ situations: Situation[]; flagged: FlaggedName[] }> {
  const results: Array<
    { index: number; situation: Situation } | { index: number; flagged: FlaggedName[] }
  > = [];

  await Promise.all(
    situations.map((situation, index) =>
      classifyLimit(async () => {
        try {
          const headlines = await fetchHeadlinesForSituation(situation);
          const driving = pickDrivingHeadline(headlines);
          if (!driving) {
            results.push({
              index,
              situation: {
                ...situation,
                catalystType: "NONE",
                catalyst: "",
                newsKey: "",
              },
            });
            return;
          }
          const catalystType = classifyCatalystTypeFromHeadline(driving.title);
          results.push({
            index,
            situation: {
              ...situation,
              catalystType,
              catalyst: driving.title.trim(),
              newsKey: buildMoversNewsKey(driving),
            },
          });
        } catch (err) {
          logger.warn({ err, situationId: situation.id }, "Movers deterministic catalyst failed");
          results.push({
            index,
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

  const situationsOut: Situation[] = [];
  const flaggedOut: FlaggedName[] = [];
  results.sort((a, b) => a.index - b.index);
  for (const r of results) {
    if ("situation" in r) situationsOut.push(r.situation);
    else flaggedOut.push(...r.flagged);
  }

  situationsOut.sort((a, b) => {
    const aPct = Math.max(...a.tickers.map((t) => Math.abs(t.changePct)));
    const bPct = Math.max(...b.tickers.map((t) => Math.abs(t.changePct)));
    return bPct - aPct;
  });

  logMoversCatalystTypeCounts(situationsOut);

  return { situations: situationsOut, flagged: flaggedOut };
}
