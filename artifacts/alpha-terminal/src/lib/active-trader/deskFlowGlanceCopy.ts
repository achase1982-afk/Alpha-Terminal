import type { DeskFlowAggregate, DeskIndexFlowTotals, DeskTapeTotals } from "./deskFlowAggregator";
import { fmtGlanceMoneyMagnitude } from "./deskFlowMoneyFormat";

function sellDisp(n: number): string {
  const v = n <= 0 ? n : -Math.abs(n);
  return fmtGlanceMoneyMagnitude(v);
}

function indexPair(buy: number, sell: number, putBuy: number, putSell: number, compact: boolean): string {
  if (compact) {
    return `C ${fmtGlanceMoneyMagnitude(buy)}/${sellDisp(sell)} · P ${fmtGlanceMoneyMagnitude(putBuy)}/${sellDisp(putSell)}`;
  }
  return `CALLS ${fmtGlanceMoneyMagnitude(buy)}/${sellDisp(sell)} · PUTS ${fmtGlanceMoneyMagnitude(putBuy)}/${sellDisp(putSell)}`;
}

function indexSlice(i: DeskIndexFlowTotals, window: "1m" | "5m" | "hr", compact = false): string {
  if (window === "1m") {
    return indexPair(i.callBuy1m, i.callSell1m, i.putBuy1m, i.putSell1m, compact);
  }
  if (window === "5m") {
    return indexPair(i.callBuy5m, i.callSell5m, i.putBuy5m, i.putSell5m, compact);
  }
  return indexPair(i.callBuyHr, i.callSellHr, i.putBuyHr, i.putSellHr, compact);
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
    const line1m = indexSlice(i, "1m", true);
    const line5m = indexSlice(i, "5m", true);
    const lineHr = indexSlice(i, "hr", true);
    return { line1m, line5m, lineHr, noPrints: false, unsupported: false };
  }

  if ((agg.mode === "stock" || agg.mode === "futures") && agg.tape) {
    const t = agg.tape;
    const line1m = tapeSlice(t, "1m");
    const line5m = tapeSlice(t, "5m");
    const lineHr = tapeSlice(t, "hr");
    return { line1m, line5m, lineHr, noPrints: false, unsupported: false };
  }

  return { line1m: null, line5m: null, lineHr: null, noPrints: true, unsupported: false };
}