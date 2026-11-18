import type { DeskFlowAggregate } from "./deskFlowAggregator";
import { fmtGlanceMoneyMagnitude } from "./deskFlowMoneyFormat";

function sellDisp(n: number): string {
  const v = n <= 0 ? n : -Math.abs(n);
  return fmtGlanceMoneyMagnitude(v);
}

export function formatGlanceMoneyRow(agg: DeskFlowAggregate): { line: string | null; noPrints: boolean; unsupported: boolean } {
  if (agg.connection === "unsupported") {
    return { line: "Flow not available", noPrints: false, unsupported: true };
  }
  if (agg.connection === "offline" || agg.connection === "idle" || agg.connection === "no_prints") {
    return { line: null, noPrints: true, unsupported: false };
  }

  if (agg.mode === "index" && agg.index) {
    const i = agg.index;
    const line = `CALLS ${fmtGlanceMoneyMagnitude(i.callBuy1m)}/${sellDisp(i.callSell1m)} · PUTS ${fmtGlanceMoneyMagnitude(i.putBuy1m)}/${sellDisp(i.putSell1m)}`;
    return { line, noPrints: false, unsupported: false };
  }

  if ((agg.mode === "stock" || agg.mode === "futures") && agg.tape) {
    const t = agg.tape;
    const line = `LIFT ${fmtGlanceMoneyMagnitude(t.lift1m)} · HIT ${sellDisp(t.hit1m)}`;
    return { line, noPrints: false, unsupported: false };
  }

  return { line: null, noPrints: true, unsupported: false };
}