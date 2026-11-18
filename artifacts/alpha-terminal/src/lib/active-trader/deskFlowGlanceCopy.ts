import type { DeskFlowAggregate, DeskIndexFlowTotals, DeskTapeTotals } from "./deskFlowAggregator";
import { fmtGlanceMoneyMagnitude } from "./deskFlowMoneyFormat";

function sellDisp(n: number): string {
  const v = n <= 0 ? n : -Math.abs(n);
  return fmtGlanceMoneyMagnitude(v);
}

function indexSlice(i: DeskIndexFlowTotals, window: "1m" | "5m" | "hr"): string {
  const pick = (buy: number, sell: number, putBuy: number, putSell: number) =>
    `CALLS ${fmtGlanceMoneyMagnitude(buy)}/${sellDisp(sell)} · PUTS ${fmtGlanceMoneyMagnitude(putBuy)}/${sellDisp(putSell)}`;
  if (window === "1m") {
    return pick(i.callBuy1m, i.callSell1m, i.putBuy1m, i.putSell1m);
  }
  if (window === "5m") {
    return pick(i.callBuy5m, i.callSell5m, i.putBuy5m, i.putSell5m);
  }
  return pick(i.callBuyHr, i.callSellHr, i.putBuyHr, i.putSellHr);
}

function tapeSlice(t: DeskTapeTotals, window: "1m" | "5m" | "hr"): string {
  if (window === "1m") {
    return `LIFT ${fmtGlanceMoneyMagnitude(t.lift1m)} · HIT ${sellDisp(t.hit1m)}`;
  }
  if (window === "5m") {
    return `LIFT ${fmtGlanceMoneyMagnitude(t.lift5m)} · HIT ${sellDisp(t.hit5m)}`;
  }
  return `LIFT ${fmtGlanceMoneyMagnitude(t.liftHr)} · HIT ${sellDisp(t.hitHr)}`;
}

export type GlanceMoneyCopy = {
  line1m: string | null;
  lineDetail: string | null;
  noPrints: boolean;
  unsupported: boolean;
};

export function formatGlanceMoneyRow(agg: DeskFlowAggregate): GlanceMoneyCopy {
  if (agg.connection === "unsupported") {
    return { line1m: "Flow not available", lineDetail: null, noPrints: false, unsupported: true };
  }
  if (agg.connection === "offline" || agg.connection === "idle" || agg.connection === "no_prints") {
    return { line1m: null, lineDetail: null, noPrints: true, unsupported: false };
  }

  if (agg.mode === "index" && agg.index) {
    const i = agg.index;
    const line1m = indexSlice(i, "1m");
    const lineDetail = `5m ${indexSlice(i, "5m")} · this hr ${indexSlice(i, "hr")}`;
    return { line1m, lineDetail, noPrints: false, unsupported: false };
  }

  if ((agg.mode === "stock" || agg.mode === "futures") && agg.tape) {
    const t = agg.tape;
    const line1m = tapeSlice(t, "1m");
    const lineDetail = `5m ${tapeSlice(t, "5m")} · this hr ${tapeSlice(t, "hr")}`;
    return { line1m, lineDetail, noPrints: false, unsupported: false };
  }

  return { line1m: null, lineDetail: null, noPrints: true, unsupported: false };
}