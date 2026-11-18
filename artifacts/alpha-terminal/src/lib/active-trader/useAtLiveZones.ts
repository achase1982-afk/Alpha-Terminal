import { useEffect, useMemo, useState } from "react";
import { useOptionsStreamStore } from "@/lib/options-stream-store";
import { sanitizeOptionGreek } from "@workspace/order-ticket-math";
import { resolveAtGlanceMode } from "@/lib/active-trader/atGlanceMode";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  computeZoneModel,
  chainHasOpenInterest,
  type ChainRowForZones,
  type ZoneModel,
} from "./zonesModel";
import { sanitizeGlanceWallStrike, type AtWallProvenance } from "./atGlanceWallStrike";

export interface AtChainRowForZones {
  strike: number;
  call?: {
    streamKey?: string;
    openInterest?: number;
    gamma?: number | null;
  } | null;
  put?: {
    streamKey?: string;
    openInterest?: number;
    gamma?: number | null;
  } | null;
}

const GAMMA_GLANCE_TICKERS = new Set(["SPX", "SPY", "QQQ", "NVDA"]);

type GammaGlanceResponse = {
  zones?: ZoneModel;
  unavailable?: boolean;
  sessionClosed?: boolean;
  glanceCaption?: string;
};

export type AtLiveZonesState = {
  zones: ZoneModel;
  sessionClosed: boolean;
};

/**
 * Key levels: prefer UW `live_gamma_0dte` via `/api/market/at-gamma-glance`;
 * fall back to chain OI/gamma when UW snapshot is unavailable.
 */
export function useAtLiveZones(
  symbol: string,
  chainRows: AtChainRowForZones[] | undefined,
  underlyingPrice: number | null,
  fixtureZones: ZoneModel | undefined,
  skipNetwork?: boolean,
): AtLiveZonesState {
  const ticks = useOptionsStreamStore((s) => s.ticks);
  const mode = resolveAtGlanceMode(symbol);
  const ticker = symbol.replace(/^\$/, "").toUpperCase();
  const [uwGlance, setUwGlance] = useState<GammaGlanceResponse | null>(null);

  useEffect(() => {
    if (fixtureZones || skipNetwork || mode === "futures" || !GAMMA_GLANCE_TICKERS.has(ticker)) {
      setUwGlance(null);
      return;
    }
    let cancelled = false;
    const q = encodeURIComponent(symbol);
    const load = async () => {
      try {
        const url = `/api/market/at-gamma-glance?symbol=${q}`;
        let res = await fetchWithAuth(url, { clerkTokenTimeoutMs: 1_500 });
        if (!res.ok) res = await fetch(url);
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as GammaGlanceResponse;
        if (cancelled || !j || j.unavailable) return;
        setUwGlance(j);
      } catch {
        /* retry on poll */
      }
    };
    void load();
    const poll = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [symbol, ticker, mode, skipNetwork, fixtureZones]);

  const zones = useMemo(() => {
    if (fixtureZones) return fixtureZones;
    const uwZones = uwGlance?.zones;
    const uwLive =
      uwZones &&
      !uwGlance?.unavailable &&
      (uwZones.netGexUsdPer1Pct != null || uwZones.callWall != null || uwZones.putWall != null);
    if (uwLive) {
      return {
        ...uwZones,
        callWall: uwZones.callWall,
        putWall: uwZones.putWall,
        flip: uwZones.flip,
        netGexUsdPer1Pct: uwZones.netGexUsdPer1Pct ?? null,
        env: uwZones.env ?? null,
        asOfLabel: uwZones.asOfLabel ?? "\u2014",
        wallsRollLabel: uwZones.wallsRollLabel ?? null,
        gammaPinStrike: uwZones.gammaPinStrike ?? null,
        glanceCaption: uwGlance?.glanceCaption ?? uwZones.glanceCaption,
      };
    }
    if (!chainRows?.length) return computeZoneModel([], underlyingPrice);
    const rows: ChainRowForZones[] = chainRows.map((r) => {
      const cTick = r.call?.streamKey ? ticks[r.call.streamKey] : undefined;
      const pTick = r.put?.streamKey ? ticks[r.put.streamKey] : undefined;
      const callGamma =
        sanitizeOptionGreek("gamma", cTick?.gamma ?? undefined) ??
        sanitizeOptionGreek("gamma", r.call?.gamma ?? undefined);
      const putGamma =
        sanitizeOptionGreek("gamma", pTick?.gamma ?? undefined) ??
        sanitizeOptionGreek("gamma", r.put?.gamma ?? undefined);
      return {
        strike: r.strike,
        callOi: cTick?.openInterest ?? r.call?.openInterest ?? 0,
        putOi: pTick?.openInterest ?? r.put?.openInterest ?? 0,
        callGamma: callGamma ?? null,
        putGamma: putGamma ?? null,
      };
    });
    const fallback = computeZoneModel(rows, underlyingPrice);
    const sanitized = {
      ...fallback,
      callWall: sanitizeGlanceWallStrike(fallback.callWall, underlyingPrice, "chain", rows),
      putWall: sanitizeGlanceWallStrike(fallback.putWall, underlyingPrice, "chain", rows),
    };
    const caption = uwGlance?.glanceCaption ?? uwZones?.glanceCaption;
    if (caption || uwZones?.asOfLabel) {
      return {
        ...sanitized,
        glanceCaption: caption ?? sanitized.glanceCaption,
        asOfLabel: uwZones?.asOfLabel ?? sanitized.asOfLabel,
      };
    }
    return sanitized;
  }, [chainRows, underlyingPrice, ticks, fixtureZones, uwGlance]);

  return {
    zones,
    sessionClosed: uwGlance?.sessionClosed ?? false,
  };
}