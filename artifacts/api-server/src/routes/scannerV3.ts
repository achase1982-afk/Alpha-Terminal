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
import { fetchSchwabBatchQuotesForSymbolsBestToken } from "../lib/schwabBatchQuotes.js";
import { fetchScannerVolContextForSymbols } from "../lib/scannerVolContext.js";
import { fetchScannerCatalystsForSymbols } from "../lib/scannerCatalysts.js";
import { fetchScannerFlowContextForSymbols } from "../lib/scannerFlowContext.js";
import {
  EMPTY_SCANNER_TECHNICAL_LAYER6_WIRE,
  fetchScannerTechnicalContextForSymbols,
  technicalLayer6HasAnyData,
} from "../lib/scannerTechnicalContext.js";
import { computeScannerLayer7Scores } from "../lib/scannerLayer7Scores.js";
import { matchScannerTradingPreset } from "../lib/scannerTradingPresets.js";
import { getBestAccessToken } from "../lib/tokenStore.js";

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

    const schwab_access_token_present = !!getBestAccessToken();
    const quoteMap = schwab_access_token_present
      ? await fetchSchwabBatchQuotesForSymbolsBestToken(tickers)
      : new Map();

    const schwabIvBySymbol = new Map<string, number | null>();
    for (const [sym, q] of quoteMap) {
      schwabIvBySymbol.set(sym, q.impliedVolatility ?? null);
    }

    const volMap = await fetchScannerVolContextForSymbols(tickers, schwabIvBySymbol);

    const catalystMap = await fetchScannerCatalystsForSymbols(tickers);

    const priceBySymbol = new Map<string, number | null>();
    for (const [sym, q] of quoteMap) {
      priceBySymbol.set(sym, q.price ?? null);
    }
    const flowBatch = await fetchScannerFlowContextForSymbols(tickers, priceBySymbol);
    const flowMap = flowBatch.bySymbol;
    const layer5_flow_diag = flowBatch.diagnostics;

    if (layer5_flow_diag.rows_in_window === 0 && tickers.length > 0) {
      log.info(
        {
          op: "scanner_v3.layer5_empty_window",
          universe: universeKey,
          window_ms: layer5_flow_diag.window_ms,
          cutoff_iso: layer5_flow_diag.cutoff_iso,
          rows_in_window: 0,
        },
        "Layer 5 Flow: no options_flow_raw_trades rows in rolling window (UI shows dashes). Check tape backfill / watcher; optional env SCANNER_FLOW_LAYER5_WINDOW_MS widens the window.",
      );
    }

    const technicalMap = await fetchScannerTechnicalContextForSymbols(tickers, quoteMap);

    let layer3_iv30_hits = 0;
    let layer3_hv30_hits = 0;
    let layer3_ivr_hits = 0;

    let layer4_earnings_hits = 0;
    let layer4_ex_div_hits = 0;
    let layer4_reactions_hits = 0;
    let layer5_flow_hits = 0;
    let layer6_technical_hits = 0;

    const cards = tickers.map((raw) => {
      const symbol = raw.trim().toUpperCase();
      const q = quoteMap.get(symbol);
      const v = volMap.get(symbol);
      const cat = catalystMap.get(symbol);
      const flow = flowMap.get(symbol) ?? null;
      const technical = technicalMap.get(symbol) ?? EMPTY_SCANNER_TECHNICAL_LAYER6_WIRE;
      const layer7 = computeScannerLayer7Scores({
        volume: q?.volume ?? null,
        avg_volume_20d: q?.avgVolume20d ?? null,
        price: q?.price ?? null,
        iv30: v?.iv30 ?? null,
        ivr: v?.ivr ?? null,
        iv_vs_hv: v?.ivVsHv ?? null,
        days_to_earnings: cat?.days_to_earnings ?? null,
        reactions_last_4q: cat?.reactions_last_4q ?? null,
        flow,
        technical,
      });
      const matched_preset = matchScannerTradingPreset({
        ...layer7,
        daysToEarnings: cat?.days_to_earnings ?? null,
        technical,
      });
      if (flow != null) layer5_flow_hits++;
      if (technicalLayer6HasAnyData(technical)) layer6_technical_hits++;
      if (v?.iv30 != null) layer3_iv30_hits++;
      if (v?.hv30 != null) layer3_hv30_hits++;
      if (v?.ivr != null) layer3_ivr_hits++;

      if (cat?.next_earnings_date != null && cat.days_to_earnings != null) layer4_earnings_hits++;
      if (cat?.next_ex_dividend_date != null) layer4_ex_div_hits++;
      if (cat?.reactions_last_4q != null) layer4_reactions_hits++;

      return {
        symbol,
        name: q?.name ?? null,
        sector: q?.sector ?? null,
        price: q?.price ?? null,
        change_abs: q?.changeAbs ?? null,
        change_pct: q?.changePct ?? null,
        volume: q?.volume ?? null,
        avg_volume_20d: q?.avgVolume20d ?? null,
        day_range: q?.dayRange ?? null,
        iv30: v?.iv30 ?? null,
        ivr: v?.ivr ?? null,
        hv30: v?.hv30 ?? null,
        iv_vs_hv: v?.ivVsHv ?? null,
        next_earnings_date: cat?.next_earnings_date ?? null,
        earnings_timing_hint: cat?.earnings_timing_hint ?? null,
        days_to_earnings: cat?.days_to_earnings ?? null,
        next_ex_dividend_date: cat?.next_ex_dividend_date ?? null,
        ex_dividend_amount: cat?.ex_dividend_amount ?? null,
        days_to_ex_dividend: cat?.days_to_ex_dividend ?? null,
        reactions_last_4q: cat?.reactions_last_4q ?? null,
        flow: flow ?? null,
        technical,
        score: layer7.compositeScore,
        score_components: {
          liquidity: layer7.liquidityScore,
          vol_context: layer7.volatilityScore,
          catalyst: layer7.catalystScore,
          flow: layer7.flowScore,
          technical: layer7.technicalScore,
        },
        matched_preset,
      };
    });

    const scan_at = new Date().toISOString();
    const payload = {
      tickers,
      universe: universeKey,
      scan_at,
      count: tickers.length,
      cards,
      schwab_access_token_present,
      layer2_quote_hits: quoteMap.size,
      layer3_iv30_hits,
      layer3_hv30_hits,
      layer3_ivr_hits,
      layer4_earnings_hits,
      layer4_ex_div_hits,
      layer4_reactions_hits,
      layer5_flow_hits,
      layer5_flow_window_ms: layer5_flow_diag.window_ms,
      layer5_flow_cutoff_iso: layer5_flow_diag.cutoff_iso,
      layer5_flow_rows_in_window: layer5_flow_diag.rows_in_window,
      layer5_flow_max_trade_ts_in_window: layer5_flow_diag.max_trade_ts_in_window,
      layer6_technical_hits,
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
