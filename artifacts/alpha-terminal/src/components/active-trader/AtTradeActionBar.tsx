import { memo } from "react";
import type { OptionsContract } from "@/components/OptionsTab";
import { BORDER_ROW, DIM, DOWN, GRAY, MONO, UP, WHITE, FW_PREMIUM } from "@/components/options/optionsTheme";
import type { AtTradeContext } from "./LadderBody";
import { aggregateSpreadNBBO, verticalStrikes } from "@/lib/active-trader/aggregateSpreadNBBO";
import { useOptionTick } from "@/lib/options-stream-store";
import type { AtLadderMode, AtVerticalWidth } from "@/lib/active-trader/activeTraderPrefs";
import type { LadderRowModel } from "./LadderBody";

function fmtPx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "\u2014";
  return n.toFixed(2);
}

interface AtTradeActionBarProps {
  accentHex: string;
  tradeContext: AtTradeContext;
  ladderMode: AtLadderMode;
  verticalWidth: AtVerticalWidth;
  rowByStrike: Map<number, LadderRowModel>;
  positionQtyByKey: Map<string, number>;
  onSell: (contract: OptionsContract, type: "CALL" | "PUT") => void;
  onBuy: (contract: OptionsContract, type: "CALL" | "PUT") => void;
  onAddLeg: (contract: OptionsContract, type: "CALL" | "PUT") => void;
}

export const AtTradeActionBar = memo(function AtTradeActionBar({
  accentHex,
  tradeContext,
  ladderMode,
  verticalWidth,
  rowByStrike,
  positionQtyByKey,
  onSell,
  onBuy,
  onAddLeg,
}: AtTradeActionBarProps) {
  const anchorStrike =
    tradeContext.mode === "single" ? tradeContext.contract.strike : tradeContext.anchorStrike;
  const row = rowByStrike.get(anchorStrike);
  const putTick = useOptionTick(row?.put?.streamKey);
  const callTick = useOptionTick(row?.call?.streamKey);
  const putFarStrike = verticalStrikes(anchorStrike, verticalWidth, "PUT").far;
  const callFarStrike = verticalStrikes(anchorStrike, verticalWidth, "CALL").far;
  const putFarTick = useOptionTick(rowByStrike.get(putFarStrike)?.put?.streamKey);
  const callFarTick = useOptionTick(rowByStrike.get(callFarStrike)?.call?.streamKey);
  const putSpread = aggregateSpreadNBBO(
    { bid: putTick?.bid ?? null, ask: putTick?.ask ?? null },
    { bid: putFarTick?.bid ?? null, ask: putFarTick?.ask ?? null },
  );
  const callSpread = aggregateSpreadNBBO(
    { bid: callTick?.bid ?? null, ask: callTick?.ask ?? null },
    { bid: callFarTick?.bid ?? null, ask: callFarTick?.ask ?? null },
  );

  const isVert = tradeContext.mode === "vertical";
  const spread = tradeContext.type === "PUT" ? putSpread : callSpread;
  const tick = tradeContext.type === "PUT" ? putTick : callTick;
  const bid = isVert ? fmtPx(spread.bid) : fmtPx(tick?.bid);
  const ask = isVert ? fmtPx(spread.ask) : fmtPx(tick?.ask);
  const legColor = tradeContext.type === "CALL" ? UP : DOWN;
  const contract =
    tradeContext.mode === "single" ? tradeContext.contract : tradeContext.nearContract;
  const key = contract.streamKey ?? "";
  const pos = key ? positionQtyByKey.get(key) : undefined;
  const posStr =
    pos != null && pos !== 0 ? ` · pos ${pos > 0 ? "+" : "\u2212"}${Math.abs(pos)}` : "";
  const title =
    isVert && tradeContext.mode === "vertical"
      ? `${tradeContext.anchorStrike}/${tradeContext.farStrike} ${tradeContext.type} VERTICAL`
      : `${anchorStrike} ${tradeContext.type}`;
  const detail = isVert
    ? ` · SELL ${bid} credit / BUY ${ask} debit`
    : ` · SELL ${bid} at bid / BUY ${ask} at ask`;

  return (
    <div
      data-at-trade-action-bar
      className="shrink-0 z-[45] px-2 py-1.5"
      style={{
        background: "#0a0a0a",
        borderTop: `1px solid ${accentHex}40`,
        boxShadow: "0 -4px 12px rgba(0,0,0,0.65)",
        fontFamily: MONO,
        paddingBottom: "max(6px, env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div
        className="leading-snug mb-1.5 truncate"
        style={{ fontSize: 10, color: GRAY, fontVariantNumeric: "tabular-nums" }}
        data-at-trade-strip
      >
        <span style={{ color: legColor, fontWeight: FW_PREMIUM }}>{title}</span>
        <span style={{ color: DIM }}>{detail}</span>
        {posStr ? <span style={{ color: pos! > 0 ? UP : DOWN }}>{posStr}</span> : null}
      </div>
      <div className="grid grid-cols-3 items-center gap-1" style={{ fontSize: 13, fontWeight: 500 }}>
        <button type="button" style={{ color: DOWN, textAlign: "left" }} onClick={() => onSell(contract, tradeContext.type)}>
          SELL {bid}
        </button>
        <button
          type="button"
          style={{ color: GRAY, textAlign: "center" }}
          onClick={() => onAddLeg(contract, tradeContext.type)}
        >
          + Leg
        </button>
        <button type="button" style={{ color: UP, textAlign: "right" }} onClick={() => onBuy(contract, tradeContext.type)}>
          BUY {ask}
        </button>
      </div>
    </div>
  );
});