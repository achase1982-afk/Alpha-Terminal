import { useEffect, useState } from "react";
import { AT_GLANCE_FLOW_FIXTURE } from "@/lib/active-trader/atGlanceFeature";
import {
  buildNvdaTapeFixture,
  buildSpxFlowFixture,
  spxFlowDisplayTotals,
} from "@/lib/active-trader/deskFlowFixture";
import type { DeskFlowSnapshot, DeskStockTapeSnapshot } from "@/lib/active-trader/deskFlowTypes";
import { resolveAtGlanceMode } from "@/lib/active-trader/atGlanceMode";

export type AtGlanceFlowView =
  | { kind: "index"; snapshot: DeskFlowSnapshot; display: ReturnType<typeof spxFlowDisplayTotals> }
  | { kind: "stock"; tape: DeskStockTapeSnapshot; unavailable: boolean }
  | { kind: "futures"; unavailable: true }
  | { kind: "none" };

export function useDeskFlowStream(symbol: string, enabled: boolean): AtGlanceFlowView {
  const [view, setView] = useState<AtGlanceFlowView>({ kind: "none" });

  useEffect(() => {
    if (!enabled) {
      setView({ kind: "none" });
      return;
    }
    const mode = resolveAtGlanceMode(symbol);
    if (mode === "futures") {
      setView({ kind: "futures", unavailable: true });
      return;
    }
    if (AT_GLANCE_FLOW_FIXTURE || mode !== "index") {
      if (mode === "index") {
        const snapshot = buildSpxFlowFixture();
        setView({ kind: "index", snapshot, display: spxFlowDisplayTotals(snapshot) });
      } else {
        setView({
          kind: "stock",
          tape: buildNvdaTapeFixture(),
          unavailable: false,
        });
      }
      return;
    }

    const sym = symbol.replace(/^\$/, "").toUpperCase();
    const url = `/api/desk/v1/stream/flow?symbol=${encodeURIComponent(sym)}`;
  let cancelled = false;
    const es = new EventSource(url);
    es.onmessage = () => {
      /* PR #660 — wire uw_np_bar / flow_1s when live */
    };
    es.onerror = () => {
      if (!cancelled) {
        const snapshot = buildSpxFlowFixture();
        setView({ kind: "index", snapshot, display: spxFlowDisplayTotals(snapshot) });
        es.close();
      }
    };
    return () => {
      cancelled = true;
      es.close();
    };
  }, [symbol, enabled]);

  return view;
}