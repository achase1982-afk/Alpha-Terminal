import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { LIQUID_CORE_SYMBOL_STRINGS } from "../data/liquidCore130.js";
import { emitTelemetry } from "../lib/telemetryStore.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const log = logger.child({ route: "scannerV3" });

const DEV_BYPASS = process.env.DEV_BYPASS_AUTH === "true";
const DEV_USER_ID = "dev_user";

function requireUserId(req: Parameters<typeof getAuth>[0]): string | null {
  if (DEV_BYPASS) return DEV_USER_ID;
  try {
    return getAuth(req).userId ?? null;
  } catch {
    return null;
  }
}

function errorClass(err: unknown): string {
  if (err instanceof Error) return err.name;
  return typeof err === "string" ? "string" : typeof err;
}

/** Layer 1: static LC130 universe — no DB, no external APIs. */
router.get("/v3/universe", (req, res) => {
  const started = Date.now();

  const emitUniverseFailed = (error_class: string) => {
    const duration_ms = Date.now() - started;
    try {
      emitTelemetry(
        "SCANNER",
        "ERROR",
        "scanner_v3_universe_failed",
        { duration_ms, error_class },
        "SCANNER",
      );
    } catch (err) {
      log.error({ err, duration_ms, error_class }, "scanner_v3_universe_failed telemetry emit failed");
    }
  };

  try {
    const userId = requireUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const tickers = [...LIQUID_CORE_SYMBOL_STRINGS];
    const scan_at = new Date().toISOString();
    const payload = {
      tickers,
      scan_at,
      count: tickers.length,
    };

    const duration_ms = Date.now() - started;
    try {
      emitTelemetry(
        "SCANNER",
        "INFO",
        "scanner_v3_universe_returned",
        { duration_ms, count: tickers.length },
        "SCANNER",
      );
    } catch (err) {
      log.error({ err, duration_ms }, "scanner_v3_universe_returned telemetry emit failed");
    }

    return res.json(payload);
  } catch (err) {
    emitUniverseFailed(errorClass(err));
    log.error({ err }, "scanner v3 universe handler failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
