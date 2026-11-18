import { useMemo, useState, useEffect } from "react";
import { useQuote } from "@/hooks/useQuote";
import { useTerminalStore } from "@/lib/store";
import { isSpxSymbol } from "@workspace/order-ticket-math";
import {
  dayLowLabelText,
  resolveDayLowFromStreamQuote,
  type DayLowDisplay,
} from "@/lib/active-trader/atDayLow";
import { resolveLowZoneSlotDisplay, type LowZoneSlotDisplay } from "@/lib/active-trader/atLowZoneSlot";
import { formatAsOfEtLabelFromMs, isAfter1PmEt } from "@/lib/active-trader/spxLowZone";

const FIXTURE_DAY_LOW = 7288.12;
const FIXTURE_STREAM_TS = new Date("2026-11-18T15:47:00.000Z").getTime();

export type AtGlanceSessionLevels = {
  showRow: boolean;
  dayLow: DayLowDisplay;
  dayLowText: string;
  lowZone: LowZoneSlotDisplay;
  lowZoneText: string;
  asOfLabel: string | null;
  emphasisFull: boolean;
};

export function useAtGlanceSessionLevels(
  symbol: string,
  opts?: { skipNetwork?: boolean; showLowZoneSlot?: boolean },
): AtGlanceSessionLevels {
  const { data: quote } = useQuote(symbol);
  const symUpper = symbol.toUpperCase();
  const streamTs = useTerminalStore((s) => {
    const direct = s.streamPrices[symUpper]?.ts;
    if (direct != null) return direct;
    const bare = symUpper.startsWith("$") ? symUpper.slice(1) : symUpper;
    const alt = symUpper.startsWith("$") ? bare : `$${symUpper}`;
    return s.streamPrices[alt]?.ts ?? null;
  });

  const spx = isSpxSymbol(symbol);
  const skipNetwork = !!opts?.skipNetwork;

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    const tick = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(tick);
  }, [quote?.low, streamTs]);

  return useMemo((): AtGlanceSessionLevels => {
    const emphasisFull = isAfter1PmEt(now);
    if (!spx) {
      return {
        showRow: false,
        dayLow: { kind: "unavailable", value: null },
        dayLowText: "Day low —",
        lowZone: { status: "hidden" },
        lowZoneText: "",
        asOfLabel: null,
        emphasisFull,
      };
    }

    let dayLow: DayLowDisplay;
    let asOfLabel: string | null;

    if (skipNetwork) {
      dayLow = { kind: "current", value: FIXTURE_DAY_LOW };
      asOfLabel = formatAsOfEtLabelFromMs(FIXTURE_STREAM_TS);
    } else {
      dayLow = resolveDayLowFromStreamQuote(quote, now);
      asOfLabel = formatAsOfEtLabelFromMs(streamTs);
    }

    const lowZone = resolveLowZoneSlotDisplay(dayLow.value, {
      showSlot: opts?.showLowZoneSlot !== false,
    });

    let lowZoneText = "";
    if (lowZone.status === "pending") lowZoneText = "Low zone: pending";
    else if (lowZone.status === "ref") lowZoneText = `Low zone (ref) ${lowZone.topLabel}`;
    else if (lowZone.status === "range") {
      lowZoneText = `Low zone ${lowZone.low}–${lowZone.high}`;
    }

    return {
      showRow: true,
      dayLow,
      dayLowText: dayLowLabelText(dayLow),
      lowZone,
      lowZoneText,
      asOfLabel,
      emphasisFull,
    };
  }, [spx, skipNetwork, quote, streamTs, now, opts?.showLowZoneSlot]);
}