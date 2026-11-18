import { useMemo, useState, useEffect } from "react";
import { useQuote } from "@/hooks/useQuote";
import { isSpxSymbol } from "@workspace/order-ticket-math";
import type { DayLowDisplay } from "@/lib/active-trader/atDayLow";
import type { DayHighDisplay } from "@/lib/active-trader/atDayHigh";
import { resolveSessionLowHighFromQuote } from "@/lib/active-trader/atSessionRangeRollup";
import { formatSessionFeedLevel } from "@/lib/active-trader/spxRefZone";
import { isAfter1PmEt, lowZoneTopLabel, resolveLowZoneSlotDisplay, type LowZoneSlotDisplay } from "@/lib/active-trader/atLowZoneSlot";
import {
  highZoneBottomLabel,
  resolveHighZoneSlotDisplay,
  type HighZoneSlotDisplay,
} from "@/lib/active-trader/atHighZoneSlot";

/** Quinn fixtures: high 7368 → high zone bottom at k=0.4%. */
export const FIXTURE_SESSION_LOW = 7288;
export const FIXTURE_SESSION_HIGH = 7368;
export const FIXTURE_LOW_ZONE_TOP = 7317;
export const FIXTURE_HIGH_ZONE_BOTTOM = 7338.5;

export type AtGlanceSessionLevels = {
  showRow: boolean;
  dayLow: DayLowDisplay;
  dayHigh: DayHighDisplay;
  dayLowValue: string;
  dayHighValue: string;
  lowZone: LowZoneSlotDisplay;
  highZone: HighZoneSlotDisplay;
  lowZoneLabel: string;
  highZoneLabel: string;
  zoneEmphasisFull: boolean;
};

export function useAtGlanceSessionLevels(
  symbol: string,
  opts?: { skipNetwork?: boolean; showZoneSlots?: boolean },
): AtGlanceSessionLevels {
  const { data: quote } = useQuote(symbol);
  const spx = isSpxSymbol(symbol);
  const skipNetwork = !!opts?.skipNetwork;
  const showZones = opts?.showZoneSlots !== false;
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
        dayHigh: { kind: "unavailable", value: null },
        dayLowValue: "\u2014",
        dayHighValue: "\u2014",
        lowZone: { status: "hidden" },
        highZone: { status: "hidden" },
        lowZoneLabel: "",
        highZoneLabel: "",
        zoneEmphasisFull,
      };
    }

    let dayLow: DayLowDisplay;
    let dayHigh: DayHighDisplay;

    if (skipNetwork) {
      dayLow = { kind: "current", value: FIXTURE_SESSION_LOW };
      dayHigh = { kind: "current", value: FIXTURE_SESSION_HIGH };
    } else {
      const rolled = resolveSessionLowHighFromQuote(symbol, quote, now);
      dayLow = rolled.dayLow;
      dayHigh = rolled.dayHigh;
    }

    const lowZone = resolveLowZoneSlotDisplay(dayLow.value, { showSlot: showZones });
    const highZone = resolveHighZoneSlotDisplay(dayHigh.value, { showSlot: showZones });

    return {
      showRow: true,
      dayLow,
      dayHigh,
      dayLowValue:
        dayLow.value != null ? formatSessionFeedLevel(dayLow.value) : "\u2014",
      dayHighValue:
        dayHigh.value != null ? formatSessionFeedLevel(dayHigh.value) : "\u2014",
      lowZone,
      highZone,
      lowZoneLabel: lowZoneTopLabel(lowZone),
      highZoneLabel: highZoneBottomLabel(highZone),
      zoneEmphasisFull,
    };
  }, [spx, skipNetwork, quote, quote?.last, quote?.low, quote?.high, showZones, now, symbol]);
}