import type { DeskFlowAggregate, DeskIndexFlowTotals, DeskTapeTotals } from "./deskFlowAggregator";
import { fmtGlanceFlowAmount, fmtGlanceMoneyMagnitude } from "./deskFlowMoneyFormat";

function indexPlain(callBuy: number, callSell: number, putBuy: number, putSell: number): string {
  return [
    `Calls bought ${fmtGlanceMoneyMagnitude(callBuy)} · sold ${fmtGlanceFlowAmount(callSell)}`,
    `Puts bought ${fmtGlanceMoneyMagnitude(putBuy)} · sold ${fmtGlanceFlowAmount(putSell)}`,
  ].join("\n");
}

function indexSlice(i: DeskIndexFlowTotals, window: "1m" | "5m" | "hr"): string {
  if (window === "1m") {
    return indexPlain(i.callBuy1m, i.callSell1m, i.putBuy1m, i.putSell1m);
  }
  if (window === "5m") {
    return indexPlain(i.callBuy5m, i.callSell5m, i.putBuy5m, i.putSell5m);
  }
  return indexPlain(i.callBuyHr, i.callSellHr, i.putBuyHr, i.putSellHr);
}

function tapePlain(lift: number, hit: number): string {
  return `Bought at ask ${fmtGlanceMoneyMagnitude(lift)} · Sold at bid ${fmtGlanceFlowAmount(hit)}`;
}

function tapeSlice(t: DeskTapeTotals, window: "1m" | "5m" | "hr"): string {
  if (window === "1m") {
    return tapePlain(t.lift1m, t.hit1m);
  }
  if (window === "5m") {
    return tapePlain(t.lift5m, t.hit5m);
  }
  return tapePlain(t.liftHr, t.hitHr);
}

export type GlanceMoneyCopy = {
  line1m: string | null;
  line5m: string | null;
  lineHr: string | null;
  noPrints: boolean;
  unsupported: boolean;
};

export function formatGlanceMoneyRow(agg: DeskFlowAggregate): GlanceMoneyCopy {
  if (agg.connection === "unsupported") {
    return { line1m: "Flow not available", line5m: null, lineHr: null, noPrints: false, unsupported: true };
  }
  if (agg.connection === "offline" || agg.connection === "idle" || agg.connection === "no_prints") {
    return { line1m: null, line5m: null, lineHr: null, noPrints: true, unsupported: false };
  }

  if (agg.mode === "index" && agg.index) {
    const i = agg.index;
    return {
      line1m: indexSlice(i, "1m"),
      line5m: indexSlice(i, "5m"),
      lineHr: indexSlice(i, "hr"),
      noPrints: false,
      unsupported: false,
    };
  }

  if ((agg.mode === "stock" || agg.mode === "futures") && agg.tape) {
    const t = agg.tape;
    return {
      line1m: tapeSlice(t, "1m"),
      line5m: tapeSlice(t, "5m"),
      lineHr: tapeSlice(t, "hr"),
      noPrints: false,
      unsupported: false,
    };
  }

  return { line1m: null, line5m: null, lineHr: null, noPrints: true, unsupported: false };
}