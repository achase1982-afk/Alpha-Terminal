import { useMemo } from "react";
import { useOptionsStreamStore } from "@/lib/options-stream-store";
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

/**
 * Live key levels: OI/gamma from chain rows, overlaid with streamer ticks when present.
 * Underlying spot updates re-run `computeZoneModel` (walls / flip / net GEX).
 */
export function useAtLiveZones(
  chainRows: AtChainRowForZones[] | undefined,
  underlyingPrice: number | null,
  fixtureZones: ZoneModel | undefined,
): ZoneModel {
  const ticks = useOptionsStreamStore((s) => s.ticks);

  return useMemo(() => {
    if (fixtureZones) return fixtureZones;
    if (!chainRows?.length) return computeZoneModel([], underlyingPrice);
    const rows: ChainRowForZones[] = chainRows.map((r) => {
      const cTick = r.call?.streamKey ? ticks[r.call.streamKey] : undefined;
      const pTick = r.put?.streamKey ? ticks[r.put.streamKey] : undefined;
      return {
        strike: r.strike,
        callOi: cTick?.openInterest ?? r.call?.openInterest ?? 0,
        putOi: pTick?.openInterest ?? r.put?.openInterest ?? 0,
        callGamma: cTick?.gamma ?? r.call?.gamma ?? null,
        putGamma: pTick?.gamma ?? r.put?.gamma ?? null,
      };
    });
    return computeZoneModel(rows, underlyingPrice);
  }, [chainRows, underlyingPrice, ticks, fixtureZones]);
}