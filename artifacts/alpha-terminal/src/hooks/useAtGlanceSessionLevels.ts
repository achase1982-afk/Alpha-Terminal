import { useMemo, useState, useEffect } from "react";
import { useQuote } from "@/hooks/useQuote";
import { useTerminalStore } from "@/lib/store";
import { isSpxSymbol } from "@workspace/order-ticket-math";
import {
  dayLowLabelText,
  formatSessionLowDisplay,
  resolveDayLowFromStreamQuote,
  type DayLowDisplay,
} from "@/lib/active-trader/atDayLow";
import {
  formatLowZoneTopDisplay,
  isAfter1PmEt,
  resolveLowZoneSlotDisplay,
  type LowZoneSlotDisplay,
} from "@/lib/active-trader/atLowZoneSlot";

const FIXTURE_DAY_LOW = 7288.12;

export type AtGlanceSessionLevels = {
  showRow: boolean;
  dayLow: DayLowDisplay;
  dayLowText: string;
  lowZone: LowZoneSlotDisplay;
  lowZoneText: string;
  zoneEmphasisFull: boolean;
  quoteTsMs: number | null;
};

export function useAtGlanceSessionLevels(
  symbol: string,
  opts?: { skipNetwork?: boolean; showLowZoneSlot?: boolean },
): AtGlanceSessionLevels {
  const { data: quote } = useQuote(symbol);
  const symU = symbol.toUpperCase();
  const streamTs = useTerminalStore(
    (s) =>
      s.streamPrices[symU]?.ts ??
      s.streamPrices[symU.startsWith("$") ? symU.slice(1) : `$${symU}`]?.ts ??
      null,
  );
  const spx = isSpxSymbol(symbol);
  const skipNetwork = !!opts?.skipNetwork;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(tick);
  }, []);

  return useMemo((): AtGlanceSessionLevels => {
    const zoneEmphasisFull = isAfter1PmEt(now);
    if (!spx) {
      return {
        showRow: false,
        dayLow: { kind: "unavailable", value: null },
        dayLowText: "Day low —",
        lowZone: { status: "hidden" },
        lowZoneText: "",
        zoneEmphasisFull,
        quoteTsMs: null,
      };
    }

    let dayLow: DayLowDisplay;
    if (skipNetwork) {
      dayLow = { kind: "current", value: FIXTURE_DAY_LOW };
    } else {
      dayLow = resolveDayLowFromStreamQuote(quote, now);
    }

    const lowZone = resolveLowZoneSlotDisplay(dayLow.value, {
      showSlot: opts?.showLowZoneSlot !== false,
    });

    let lowZoneText = "";
    if (lowZone.status === "pending") lowZoneText = "Low zone: pending";
    else if (lowZone.status === "band") {
      lowZoneText = `Low zone ${formatSessionLowDisplay(lowZone.dayLow)}–${formatLowZoneTopDisplay(lowZone.top)}`;
    }

    return {
      showRow: true,
      dayLow,
      dayLowText: dayLowLabelText(dayLow),
      lowZone,
      lowZoneText,
      zoneEmphasisFull,
      quoteTsMs: streamTs,
    };
  }, [spx, skipNetwork, quote, streamTs, opts?.showLowZoneSlot, now]);
}