import { useEffect, useMemo, useState } from "react";
import { useOptionsStreamStore } from "@/lib/options-stream-store";
import { sanitizeOptionGreek } from "@workspace/order-ticket-math";
import { resolveAtGlanceMode } from "@/lib/active-trader/atGlanceMode";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  computeZoneModel,
  type ChainRowForZones,
  type ZoneModel,
} from "./zonesModel";

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

type GammaGlanceResponse = {
  zones?: ZoneModel;
  unavailable?: boolean;
};

/**
 * Key levels: prefer UW `live_gamma_0dte` via `/api/market/at-gamma-glance` on indexes;
 * fall back to chain OI/gamma when UW snapshot is unavailable.
 */
export function useAtLiveZones(
  symbol: string,
  chainRows: AtChainRowForZones[] | undefined,
  underlyingPrice: number | null,
  fixtureZones: ZoneModel | undefined,
  skipNetwork?: boolean,
): ZoneModel {
  const ticks = useOptionsStreamStore((s) => s.ticks);
  const mode = resolveAtGlanceMode(symbol);
  const [uwZones, setUwZones] = useState<ZoneModel | null>(null);

  useEffect(() => {
    if (fixtureZones || skipNetwork || mode !== "index") {
      setUwZones(null);
      return;
    }
    let cancelled = false;
    const q = encodeURIComponent(symbol);
    void fetchWithAuth(`/api/market/at-gamma-glance?symbol=${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: GammaGlanceResponse | null) => {
        if (cancelled || !j?.zones || j.unavailable) return;
        setUwZones(j.zones);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [symbol, mode, skipNetwork, fixtureZones]);

  return useMemo(() => {
    if (fixtureZones) return fixtureZones;
    if (
      uwZones &&
      (uwZones.netGexUsdPer1Pct != null || uwZones.callWall != null || uwZones.putWall != null)
    ) {
      return uwZones;
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
    if (uwZones?.glanceCaption) {
      return { ...fallback, glanceCaption: uwZones.glanceCaption, asOfLabel: uwZones.asOfLabel };
    }
    return fallback;
  }, [chainRows, underlyingPrice, ticks, fixtureZones, uwZones]);
}