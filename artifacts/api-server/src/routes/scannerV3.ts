import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { emitTelemetry } from "../lib/telemetryStore.js";
import { logger } from "../lib/logger.js";
import {
  getScannerUniverseTickers,
  isScannerUniverseId,
  SCANNER_UNIVERSE_IDS,
  type ScannerUniverseId,
} from "../lib/scannerUniverses.js";
import { loadPresets, PRESET_ALIASES } from "../lib/scannerPresetLoad.js";
import { resolveScannerUniverseSymbolsForUser } from "./scanner.js";

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

function isCompositeUniverseId(s: string): boolean {
  return s.startsWith("preset:") || s.startsWith("watchlist:") || s.startsWith("screen:");
}

function parseUniverseQuery(raw: unknown): { ok: true; universeKey: string } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, universeKey: "liquid-core-130" };
  }
  if (typeof raw !== "string") return { ok: false };
  const s = raw.trim();
  if (s === "") return { ok: true, universeKey: "liquid-core-130" };
  if (isScannerUniverseId(s)) return { ok: true, universeKey: s };
  if (isCompositeUniverseId(s)) return { ok: true, universeKey: s };
  return { ok: false };
}

/** Layer 1: static or snapshot-backed universe — no DB for kebab ids except watchlist/screen composites. */
router.get("/v3/universe", async (req, res) => {
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

    const parsed = parseUniverseQuery(req.query.universe);
    if (!parsed.ok) {
      return res.status(400).json({
        error: "unknown universe",
        validUniverses: SCANNER_UNIVERSE_IDS,
      });
    }

    const universeKey = parsed.universeKey;

    if (universeKey.startsWith("preset:")) {
      const rawKey = universeKey.slice(7);
      const resolvedKey = PRESET_ALIASES[rawKey] ?? rawKey;
      const presets = loadPresets();
      if (!presets[resolvedKey]) {
        return res.status(400).json({
          error: "unknown universe",
          validUniverses: SCANNER_UNIVERSE_IDS,
        });
      }
    }

    let tickers: string[];
    if (isCompositeUniverseId(universeKey)) {
      tickers = await resolveScannerUniverseSymbolsForUser(universeKey, userId);
    } else {
      tickers = getScannerUniverseTickers(universeKey as ScannerUniverseId);
    }

    const scan_at = new Date().toISOString();
    const payload = {
      tickers,
      universe: universeKey,
      scan_at,
      count: tickers.length,
    };

    const duration_ms = Date.now() - started;
    try {
      emitTelemetry("SCANNER", "INFO", "scanner_v3_universe_returned", { duration_ms, count: tickers.length, universe: universeKey }, "SCANNER");
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
