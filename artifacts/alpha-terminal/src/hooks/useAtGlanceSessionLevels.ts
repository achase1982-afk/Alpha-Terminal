import { useMemo } from "react";
import { useQuote } from "@/hooks/useQuote";
import { isSpxSymbol } from "@workspace/order-ticket-math";
import {
  dayLowLabelText,
  resolveDayLowFromStreamQuote,
  type DayLowDisplay,
} from "@/lib/active-trader/atDayLow";
import {
  dayHighLabelText,
  resolveDayHighFromStreamQuote,
  type DayHighDisplay,
} from "@/lib/active-trader/atDayHigh";
import { lowZoneSlotLabel, resolveLowZoneSlotDisplay, type LowZoneSlotDisplay } from "@/lib/active-trader/atLowZoneSlot";
import {
  highZoneSlotLabel,
  resolveHighZoneSlotDisplay,
  type HighZoneSlotDisplay,
} from "@/lib/active-trader/atHighZoneSlot";

/** Mirrors Quinn fixtures: high 7400.37 → high zone 7365.5 at K=35. */
export const FIXTURE_SESSION_LOW = 7288;
export const FIXTURE_SESSION_HIGH = 7400.37;
export const FIXTURE_LOW_ZONE_TOP = 7323;
export const FIXTURE_HIGH_ZONE_BOTTOM = 7365.5;

export type AtGlanceSessionLevels = {
  showRow: boolean;
  dayLow: DayLowDisplay;
  dayHigh: DayHighDisplay;
  dayLowText: string;
  dayHighText: string;
  lowZone: LowZoneSlotDisplay;
  highZone: HighZoneSlotDisplay;
  lowZoneText: string;
  highZoneText: string;
};

export function useAtGlanceSessionLevels(
  symbol: string,
  opts?: { skipNetwork?: boolean; showZoneSlots?: boolean },
): AtGlanceSessionLevels {
  const { data: quote } = useQuote(symbol);
  const spx = isSpxSymbol(symbol);
  const skipNetwork = !!opts?.skipNetwork;
  const showZones = opts?.showZoneSlots !== false;

  return useMemo((): AtGlanceSessionLevels => {
    if (!spx) {
      return {
        showRow: false,
        dayLow: { kind: "unavailable", value: null },
        dayHigh: { kind: "unavailable", value: null },
        dayLowText: "Day low —",
        dayHighText: "Day high —",
        lowZone: { status: "hidden" },
        highZone: { status: "hidden" },
        lowZoneText: "",
        highZoneText: "",
      };
    }

    let dayLow: DayLowDisplay;
    let dayHigh: DayHighDisplay;

    if (skipNetwork) {
      dayLow = { kind: "current", value: FIXTURE_SESSION_LOW };
      dayHigh = { kind: "current", value: FIXTURE_SESSION_HIGH };
    } else {
      dayLow = resolveDayLowFromStreamQuote(quote);
      dayHigh = resolveDayHighFromStreamQuote(quote);
    }

    const lowZone = resolveLowZoneSlotDisplay(dayLow.value, { showSlot: showZones });
    const highZone = resolveHighZoneSlotDisplay(dayHigh.value, { showSlot: showZones });

    return {
      showRow: true,
      dayLow,
      dayHigh,
      dayLowText: dayLowLabelText(dayLow),
      dayHighText: dayHighLabelText(dayHigh),
      lowZone,
      highZone,
      lowZoneText: lowZoneSlotLabel(lowZone),
      highZoneText: highZoneSlotLabel(highZone),
    };
  }, [spx, skipNetwork, quote, showZones]);
}