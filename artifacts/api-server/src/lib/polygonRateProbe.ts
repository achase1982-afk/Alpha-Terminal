import { logger } from "./logger";

export interface RateProbe {
  tier: "starter" | "developer_or_advanced" | "unknown";
  successCount: number;
  failureCount: number;
  rateLimited: boolean;
  elapsedMs: number;
  message: string;
}

const POLYGON_API = "https://api.polygon.io";

export async function probePolygonRate(): Promise<RateProbe> {
  const apiKey = process.env["POLYGON_API_KEY"];
  if (!apiKey) {
    return {
      tier: "unknown", successCount: 0, failureCount: 0,
      rateLimited: false, elapsedMs: 0,
      message: "POLYGON_API_KEY not set",
    };
  }

  const url = `${POLYGON_API}/v3/reference/tickers/SPY?apiKey=${apiKey}`;
  const start = Date.now();
  let success = 0;
  let failure = 0;
  let rateLimited = false;

  for (let i = 0; i < 10; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 429) {
        rateLimited = true;
        failure++;
        break;
      } else if (r.ok) {
        success++;
      } else {
        failure++;
      }
    } catch {
      failure++;
    }
  }

  const elapsedMs = Date.now() - start;
  let tier: RateProbe["tier"];
  let message: string;
  if (rateLimited || success < 8) {
    tier = "starter";
    message = `Likely Starter plan (5 req/min). ${success}/10 succeeded${rateLimited ? ", 429 hit" : ""}. Backfill aborted.`;
  } else {
    tier = "developer_or_advanced";
    message = `Developer or Advanced plan. ${success}/10 succeeded in ${elapsedMs}ms. Backfill cleared.`;
  }

  logger.info({ tier, success, failure, rateLimited, elapsedMs }, "Polygon rate probe");
  return { tier, successCount: success, failureCount: failure, rateLimited, elapsedMs, message };
}
