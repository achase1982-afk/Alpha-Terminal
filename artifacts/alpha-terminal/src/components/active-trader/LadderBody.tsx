import { memo, useMemo } from "react";
import type { OptionsContract } from "@/components/OptionsTab";
import {
  ROW_H, STRIKE_W, BORDER_ROW, BORDER, UP, DOWN, DIM, WHITE, GRAY, MUTED,
  BG, MONO, FW_LIGHT, FW_PREMIUM, GAMMA_SCENARIO,
} from "@/components/options/optionsTheme";
import { useOptionTick } from "@/lib/options-stream-store";
import {
  flowBadgeFromCounts, type FlowLaneCounts,
} from "@/lib/active-trader/flowClassifier";
import { formatCompactQty } from "@/lib/optionsSchwabKey";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";

export interface LadderRowModel {
  strike: number;
  call: OptionsContract | null;
  put: OptionsContract | null;
}

interface LadderBodyProps {
  rows: LadderRowModel[];
  accentHex: string;
  underlyingPrice: number | null;
  zones: ZoneModel;
  maxFlow: number;
  laneFilters: Record<"call_buy" | "call_sell" | "put_buy" | "put_sell", boolean>;
  windowMs: number;
  tradeStripStrike: number | null;
  onCellTap: (contract: OptionsContract, type: "CALL" | "PUT") => void;
  onTradeStripSell: (contract: OptionsContract, type: "CALL" | "PUT") => void;
  onTradeStripBuy: (contract: OptionsContract, type: "CALL" | "PUT") => void;
  onAddLeg: (contract: OptionsContract, type: "CALL" | "PUT") => void;
  positionQtyByKey: Map<string, number>;
  flowByKey: Record<string, FlowLaneCounts>;
  tradeContext: { contract: OptionsContract; type: "CALL" | "PUT" } | null;
  symbolLabel: string;
}

function classifiedVol(c: FlowLaneCounts): number {
  return c.buy + c.sell + c.even;
}

function FlowBar({ value, max, color, align }: { value: number; max: number; color: string; align: "left" | "right" }) {
  if (value <= 0 || max <= 0) return <div className="w-full" />;
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "transparent" }}>
      <div
        className="h-full rounded-full"
        style={{
          width: `${pct}%`,
          marginLeft: align === "right" ? "auto" : 0,
          marginRight: align === "left" ? "auto" : 0,
          background: `linear-gradient(${align === "right" ? "90deg" : "270deg"}, ${color}80, ${color}30)`,
        }}
      />
    </div>
  );
}

function Badge({ b }: { b: "B" | "S" | "=" | null }) {
  if (!b) return null;
  const color = b === "B" ? UP : b === "S" ? DOWN : GRAY;
  return (
    <span
      className="inline-flex items-center justify-center rounded"
      style={{ width: 14, height: 14, fontSize: 9, color, background: `${color}26`, fontFamily: MONO }}
    >
      {b}
    </span>
  );
}

type LadderRowViewProps = {
  row: LadderRowModel;
  accentHex: string;
  zones: ZoneModel;
  maxFlow: number;
  laneFilters: Record<"call_buy" | "call_sell" | "put_buy" | "put_sell", boolean>;
  showTradeStrip: boolean;
  onCellTap: LadderBodyProps["onCellTap"];
  onTradeStripSell: LadderBodyProps["onTradeStripSell"];
  onTradeStripBuy: LadderBodyProps["onTradeStripBuy"];
  onAddLeg: LadderBodyProps["onAddLeg"];
  positionQtyByKey: Map<string, number>;
  flowByKey: Record<string, FlowLaneCounts>;
  tradeContext: { contract: OptionsContract; type: "CALL" | "PUT" } | null;
  underlyingPrice: number | null;
  symbolLabel: string;
  showFlipPill: boolean;
};

const LadderRowView = memo(function LadderRowView({
  row,
  accentHex,
  zones,
  maxFlow,
  laneFilters,
  showTradeStrip,
  onCellTap,
  onTradeStripSell,
  onTradeStripBuy,
  onAddLeg,
  positionQtyByKey,
  flowByKey,
  tradeContext,
  underlyingPrice,
  symbolLabel,
  showFlipPill,
}: LadderRowViewProps) {
  const callTick = useOptionTick(row.call?.streamKey);
  const putTick = useOptionTick(row.put?.streamKey);
  const callFlow = row.call?.streamKey ? flowByKey[row.call.streamKey] ?? { buy: 0, sell: 0, even: 0, unknown: 0 } : { buy: 0, sell: 0, even: 0, unknown: 0 };
  const putFlow = row.put?.streamKey ? flowByKey[row.put.streamKey] ?? { buy: 0, sell: 0, even: 0, unknown: 0 } : { buy: 0, sell: 0, even: 0, unknown: 0 };

  const putFlowNet =
    (laneFilters.put_buy ? putFlow.buy : 0) + (laneFilters.put_sell ? putFlow.sell : 0);
  const callFlowNet =
    (laneFilters.call_buy ? callFlow.buy : 0) + (laneFilters.call_sell ? callFlow.sell : 0);

  const putBadge = flowBadgeFromCounts(putFlow);
  const callBadge = flowBadgeFromCounts(callFlow);

  const spotRow =
    underlyingPrice != null && Math.abs(row.strike - underlyingPrice) < Math.max(underlyingPrice * 0.0005, 0.05);
  const flipBeforeRow =
    zones.flip != null &&
    underlyingPrice != null &&
    row.strike < zones.flip &&
    row.strike + 5 >= zones.flip;
  const isCallWall = zones.callWall != null && Math.abs(row.strike - zones.callWall) < 0.001;
  const isPutWall = zones.putWall != null && Math.abs(row.strike - zones.putWall) < 0.001;

  const renderPosition = (key: string | undefined) => {
    if (!key) return null;
    const q = positionQtyByKey.get(key);
    if (q == null || q === 0) return null;
    const sign = q > 0 ? "+" : "\u2212";
    return (
      <span style={{ fontSize: 9, color: q > 0 ? accentHex : DOWN }}>
        {sign}{Math.abs(q)}
      </span>
    );
  };

  return (
    <>
      {flipBeforeRow && (
        <div className="relative w-full flex items-center" style={{ height: 8 }}>
          <div className="absolute inset-x-0 top-1/2" style={{ borderTop: `1px dashed ${GAMMA_SCENARIO}` }} />
          {showFlipPill && zones.flip != null && (
            <span
              className="absolute right-1 px-1.5 py-0.5 rounded-full"
              style={{ fontSize: 9, color: GAMMA_SCENARIO, border: `1px solid ${GAMMA_SCENARIO}`, background: BG, fontFamily: MONO }}
            >
              Flip {zones.flip.toFixed(0)}
            </span>
          )}
        </div>
      )}
      <div
        className="grid items-center w-full"
        style={{
          gridTemplateColumns: "1fr 1.1fr 44px 1.1fr 1fr",
          height: ROW_H,
          borderBottom: `1px solid ${BORDER_ROW}`,
          fontFamily: MONO,
        }}
      >
        <FlowBar value={putFlowNet} max={maxFlow} color={DOWN} align="left" />
        <button
          type="button"
          className="flex items-center justify-center gap-1 px-1 h-full"
          style={{ fontSize: 12, color: WHITE, fontWeight: FW_LIGHT, background: "transparent" }}
          onClick={() => row.put && onCellTap(row.put, "PUT")}
        >
          <Badge b={putBadge} />
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatCompactQty(classifiedVol(putFlow) || putTick?.volume)}
          </span>
          {renderPosition(row.put?.streamKey)}
        </button>
        <div
          className="flex flex-col items-center justify-center h-full px-0.5"
          style={{
            width: STRIKE_W,
            background: spotRow ? DIM : accentHex,
            color: spotRow ? WHITE : "black",
            fontSize: 12,
            fontWeight: FW_PREMIUM,
          }}
        >
          <span>{row.strike}</span>
          {spotRow && <span style={{ fontSize: 8, opacity: 0.7 }}>{symbolLabel}</span>}
          {isCallWall && !spotRow && <span style={{ fontSize: 7, color: "black", opacity: 0.55 }}>CALL WALL</span>}
          {isPutWall && !spotRow && <span style={{ fontSize: 7, color: "black", opacity: 0.55 }}>PUT WALL</span>}
        </div>
        <button
          type="button"
          className="flex items-center justify-center gap-1 px-1 h-full"
          style={{ fontSize: 12, color: WHITE, fontWeight: FW_LIGHT, background: "transparent" }}
          onClick={() => row.call && onCellTap(row.call, "CALL")}
        >
          <Badge b={callBadge} />
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatCompactQty(classifiedVol(callFlow) || callTick?.volume)}
          </span>
          {renderPosition(row.call?.streamKey)}
        </button>
        <FlowBar value={callFlowNet} max={maxFlow} color={UP} align="right" />
      </div>
      {showTradeStrip && tradeContext && (
        <div
          className="grid grid-cols-3 items-center px-2"
          style={{
            height: ROW_H,
            borderBottom: `1px solid ${BORDER_ROW}`,
            background: "linear-gradient(180deg, rgba(10,10,10,1), rgba(0,0,0,1))",
            borderTop: `1px solid ${accentHex}30`,
            fontFamily: MONO,
            fontSize: 12,
          }}
        >
          <button
            type="button"
            style={{ color: DOWN }}
            onClick={() => onTradeStripSell(tradeContext.contract, tradeContext.type)}
          >
            SELL {(tradeContext.type === "PUT" ? putTick : callTick)?.bid?.toFixed(2) ?? "\u2014"}
          </button>
          <button type="button" style={{ color: GRAY }} onClick={() => onAddLeg(tradeContext.contract, tradeContext.type)}>+ Leg</button>
          <button
            type="button"
            className="text-right"
            style={{ color: UP }}
            onClick={() => onTradeStripBuy(tradeContext.contract, tradeContext.type)}
          >
            BUY {(tradeContext.type === "PUT" ? putTick : callTick)?.ask?.toFixed(2) ?? "\u2014"}
          </button>
        </div>
      )}
    </>
  );
});

export const LadderBody = memo(function LadderBody(props: LadderBodyProps) {
  const maxFlow = useMemo(() => {
    let m = 1;
    for (const row of props.rows) {
      for (const c of [row.call, row.put]) {
        if (!c?.streamKey) continue;
        const fc = props.flowByKey[c.streamKey];
        if (fc) m = Math.max(m, fc.buy + fc.sell);
      }
    }
    return m;
  }, [props.rows, props.flowByKey]);

  return (
    <div>
      {props.rows.map((row) => (
        <LadderRowView
          key={row.strike}
          row={row}
          accentHex={props.accentHex}
          zones={props.zones}
          maxFlow={maxFlow}
          laneFilters={props.laneFilters}
          showTradeStrip={props.tradeStripStrike === row.strike}
          underlyingPrice={props.underlyingPrice}
          symbolLabel={props.symbolLabel}
          showFlipPill
          onCellTap={props.onCellTap}
          onTradeStripSell={props.onTradeStripSell}
          onTradeStripBuy={props.onTradeStripBuy}
          onAddLeg={props.onAddLeg}
          positionQtyByKey={props.positionQtyByKey}
          flowByKey={props.flowByKey}
          tradeContext={
            props.tradeStripStrike === row.strike && props.tradeContext ? props.tradeContext : null
          }
        />
      ))}
    </div>
  );
});