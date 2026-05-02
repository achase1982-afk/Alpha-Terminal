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
      tier: "unknown",
      successCount: 0,
      failureCount: 0,
      rateLimited: false,
      elapsedMs: 0,
      message: "POLYGON_API_KEY not set",
    };
  }

  const url = `${POLYGON_API}/v3/reference/tickers/SPY?apiKey=${apiKey}`;
  const start = Date.now();

  try {
    const r = await fetch(url);
    const elapsedMs = Date.now() - start;

    if (r.ok) {
      logger.info(
        { tier: "developer_or_advanced", successCount: 1, failureCount: 0, rateLimited: false, elapsedMs },
        "Polygon rate probe: Developer or Advanced plan (single reference tickers request OK)",
      );
      return {
        tier: "developer_or_advanced",
        successCount: 1,
        failureCount: 0,
        rateLimited: false,
        elapsedMs,
        message: "Developer or Advanced plan (reference tickers endpoint returned OK).",
      };
    }

    if (r.status === 401 || r.status === 403) {
      logger.info({ status: r.status, elapsedMs }, "Polygon rate probe: auth error");
      return {
        tier: "unknown",
        successCount: 0,
        failureCount: 1,
        rateLimited: false,
        elapsedMs,
        message: `Authentication or authorization failed (HTTP ${r.status}). Check POLYGON_API_KEY.`,
      };
    }

    if (r.status === 429) {
      logger.info({ status: 429, elapsedMs }, "Polygon rate probe: transient rate limit");
      return {
        tier: "unknown",
        successCount: 0,
        failureCount: 0,
        rateLimited: true,
        elapsedMs,
        message: "Transient rate limit (HTTP 429) on probe — subscription tier not inferred from this response.",
      };
    }

    logger.info({ status: r.status, elapsedMs }, "Polygon rate probe: non-OK response");
    return {
      tier: "unknown",
      successCount: 0,
      failureCount: 1,
      rateLimited: false,
      elapsedMs,
      message: `Unexpected HTTP ${r.status} from /v3/reference/tickers/SPY.`,
    };
  } catch (err) {
    const elapsedMs = Date.now() - start;
    const text = err instanceof Error ? err.message : String(err);
    logger.info({ err: text, elapsedMs }, "Polygon rate probe: network error");
    return {
      tier: "unknown",
      successCount: 0,
      failureCount: 1,
      rateLimited: false,
      elapsedMs,
      message: `Network error: ${text}`,
    };
  }
}
