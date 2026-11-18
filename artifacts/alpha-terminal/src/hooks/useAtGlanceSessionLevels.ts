import { useMemo } from "react";
import { useQuote } from "@/hooks/useQuote";
import { isSpxSymbol } from "@workspace/order-ticket-math";
import {
  dayLowLabelText,
  resolveDayLowFromStreamQuote,
  type DayLowDisplay,
} from "@/lib/active-trader/atDayLow";
import { resolveLowZoneSlotDisplay, type LowZoneSlotDisplay } from "@/lib/active-trader/atLowZoneSlot";

const FIXTURE_DAY_LOW = 7288;

export type AtGlanceSessionLevels = {
  showRow: boolean;
  dayLow: DayLowDisplay;
  dayLowText: string;
  lowZone: LowZoneSlotDisplay;
  lowZoneText: string;
};

export function useAtGlanceSessionLevels(
  symbol: string,
  opts?: { skipNetwork?: boolean; showLowZoneSlot?: boolean },
): AtGlanceSessionLevels {
  const { data: quote } = useQuote(symbol);
  const spx = isSpxSymbol(symbol);
  const skipNetwork = !!opts?.skipNetwork;

  return useMemo((): AtGlanceSessionLevels => {
    if (!spx) {
      return {
        showRow: false,
        dayLow: { kind: "unavailable", value: null },
        dayLowText: "Day low —",
        lowZone: { status: "hidden" },
        lowZoneText: "",
      };
    }

    let dayLow: DayLowDisplay;
    if (skipNetwork) {
      dayLow = { kind: "current", value: FIXTURE_DAY_LOW };
    } else {
      dayLow = resolveDayLowFromStreamQuote(quote);
    }

    const lowZone = resolveLowZoneSlotDisplay(dayLow.value, {
      showSlot: opts?.showLowZoneSlot !== false,
    });

    let lowZoneText = "";
    if (lowZone.status === "pending") lowZoneText = "Low zone: pending";
    else if (lowZone.status === "range") {
      lowZoneText = `Low zone ${lowZone.low}–${lowZone.high}`;
    }

    return {
      showRow: true,
      dayLow,
      dayLowText: dayLowLabelText(dayLow),
      lowZone,
      lowZoneText,
    };
  }, [spx, skipNetwork, quote, opts?.showLowZoneSlot]);
}