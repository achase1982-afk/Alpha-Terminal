import { useMemo, useState, useEffect } from "react";
import { useGetPriceHistory } from "@workspace/api-client-react";
import type { PriceHistoryResponse } from "@workspace/api-client-react";
import { useTerminalStore } from "@/lib/store";
import { isSpxSymbol } from "@workspace/order-ticket-math";
import { isUsEquitiesMarketHoursEt } from "@/lib/usMarketHours";
import {
  computeLowZoneTop,
  computeRthSessionLowFromMinuteCandles,
  isAfter1PmEt,
  formatLowZoneLevel,
  SPX_LOW_ZONE_K_DEFAULT,
} from "@/lib/active-trader/spxLowZone";

export type SpxLowZoneState = {
  sessionLow: number | null;
  lowZoneTop: number | null;
  sessionLowLabel: string;
  lowZoneLabel: string;
  emphasisFull: boolean;
  loading: boolean;
};

const FIXTURE_SESSION_LOW = 7288;

export function useSpxLowZone(symbol: string, opts?: { skipNetwork?: boolean }): SpxLowZoneState {
  const accessToken = useTerminalStore((s) => s.accessToken);
  const spx = isSpxSymbol(symbol);
  const skipNetwork = !!opts?.skipNetwork;

  const enabled = spx && !!accessToken && !skipNetwork;
  const { data, isLoading } = useGetPriceHistory<PriceHistoryResponse>(
    {
      symbol: symbol.replace(/^\$/, ""),
      periodType: "day",
      period: 1,
      frequencyType: "minute",
      frequency: 1,
    },
    {
      query: {
        enabled,
        refetchInterval: isUsEquitiesMarketHoursEt() ? 45_000 : 120_000,
        staleTime: 30_000,
      },
    },
  );

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    const tick = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(tick);
  }, [data?.candles?.length]);

  return useMemo((): SpxLowZoneState => {
    const emphasisFull = isAfter1PmEt(now);
    if (!spx) {
      return {
        sessionLow: null,
        lowZoneTop: null,
        sessionLowLabel: "—",
        lowZoneLabel: "—",
        emphasisFull,
        loading: false,
      };
    }

    if (skipNetwork) {
      const low = FIXTURE_SESSION_LOW;
      const top = computeLowZoneTop(low, SPX_LOW_ZONE_K_DEFAULT)!;
      return {
        sessionLow: low,
        lowZoneTop: top,
        sessionLowLabel: formatLowZoneLevel(low),
        lowZoneLabel: formatLowZoneLevel(top),
        emphasisFull,
        loading: false,
      };
    }

    const candles = (data?.candles ?? []).map((c) => ({
      datetime: c.datetime,
      low: c.low,
    }));
    const sessionLow = computeRthSessionLowFromMinuteCandles(candles, now);
    const lowZoneTop =
      sessionLow != null ? computeLowZoneTop(sessionLow, SPX_LOW_ZONE_K_DEFAULT) : null;

    return {
      sessionLow,
      lowZoneTop,
      sessionLowLabel: sessionLow != null ? formatLowZoneLevel(sessionLow) : "—",
      lowZoneLabel: lowZoneTop != null ? formatLowZoneLevel(lowZoneTop) : "—",
      emphasisFull,
      loading: enabled && isLoading && sessionLow == null,
    };
  }, [spx, skipNetwork, data?.candles, now, enabled, isLoading]);
}