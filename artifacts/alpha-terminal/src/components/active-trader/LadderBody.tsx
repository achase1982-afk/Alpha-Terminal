import { memo, useMemo, type ReactNode } from "react";
import type { OptionsContract } from "@/components/OptionsTab";
import {
  STRIKE_W, BORDER_ROW, BORDER, UP, DOWN, GRAY, WHITE, DIM,
  BG, MONO, FW_LIGHT, FW_PREMIUM, GAMMA_SCENARIO, ITM_OCEAN,
} from "@/components/options/optionsTheme";
import { useOptionTick } from "@/lib/options-stream-store";
import { flowBadgeFromCounts, type FlowLaneCounts } from "@/lib/active-trader/flowClassifier";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import {
  AT_LADDER_GRID,
  AT_LADDER_PANEL_BG,
  AT_LADDER_ROW_H,
} from "@/lib/active-trader/atLadderLayout";
import type { AtLadderMode, AtVerticalWidth } from "@/lib/active-trader/activeTraderPrefs";
import { aggregateSpreadNBBO, verticalStrikes } from "@/lib/active-trader/aggregateSpreadNBBO";
import { aggregateVerticalFlow } from "@/lib/active-trader/atVerticalFlow";

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
  laneFilters: Record<"call_buy" | "call_sell" | "put_buy" | "put_sell", boolean>;
  selectedStrike: number | null;
  onQuoteTap: (contract: OptionsContract, type: "CALL" | "PUT", side: "BUY" | "SELL") => void;
  onAddLeg: (contract: OptionsContract, type: "CALL" | "PUT") => void;
  positionQtyByKey: Map<string, number>;
  workingOrderChips?: Map<string, string>;
  flowByKey: Record<string, FlowLaneCounts>;
  symbolLabel: string;
  keepawayPutLine?: number | null;
  keepawayCallLine?: number | null;
  ladderMode: AtLadderMode;
  verticalWidth: AtVerticalWidth;
  rowByStrike: Map<number, LadderRowModel>;
  rowHeight?: number;
  onVerticalTap: (payload: {
    anchorStrike: number;
    farStrike: number;
    type: "CALL" | "PUT";
    side: "BUY" | "SELL";
    nearContract: OptionsContract;
  }) => void;
}

export type AtTradeContext =
  | { mode: "single"; contract: OptionsContract; type: "CALL" | "PUT" }
  | {
      mode: "vertical";
      type: "CALL" | "PUT";
      anchorStrike: number;
      farStrike: number;
      width: number;
      nearContract: OptionsContract;
    };

function fmtPx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function FlowBarCell({
  flow,
  laneFilters,
  side,
  maxFlow,
}: {
  flow: FlowLaneCounts;
  laneFilters: LadderBodyProps["laneFilters"];
  side: "put" | "call";
  maxFlow: number;
}) {
  const vol =
    (side === "put"
      ? (laneFilters.put_buy ? flow.buy : 0) + (laneFilters.put_sell ? flow.sell : 0)
      : (laneFilters.call_buy ? flow.buy : 0) + (laneFilters.call_sell ? flow.sell : 0)) || flow.buy + flow.sell;
  const badge = flowBadgeFromCounts(flow);
  const color = side === "put" ? DOWN : UP;
  const align = side === "put" ? "left" : "right";
  const pct = maxFlow > 0 ? Math.min(100, Math.max(vol > 0 ? 12 : 0, Math.round((vol / maxFlow) * 100))) : 0;
  const volLabel = vol >= 1000 ? `${(vol / 1000).toFixed(1)}k` : vol >= 100 ? String(vol) : "";
  const tip = `Flow ${vol} · B:${flow.buy} S:${flow.sell}${badge ? ` · ${badge}` : ""}`;
  return (
    <div
      className="flex items-center h-full w-full min-w-0 gap-0.5 px-0.5"
      title={tip}
      style={{ flexDirection: align === "right" ? "row-reverse" : "row" }}
    >
      <div className="flex-1 min-w-[14px] h-[6px] rounded-sm overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
        {vol > 0 && (
          <div
            className="h-full rounded-sm"
            style={{
              width: `${pct}%`,
              marginLeft: align === "right" ? "auto" : 0,
              background: `linear-gradient(${align === "right" ? "90deg" : "270deg"}, ${color}, ${color}44)`,
            }}
          />
        )}
      </div>
      {volLabel ? (
        <span className="shrink-0 tabular-nums whitespace-nowrap" style={{ fontSize: 7, color: GRAY, lineHeight: 1 }}>
          {volLabel}
        </span>
      ) : null}
    </div>
  );
}

function QuoteCell({
  price,
  tint,
  strike,
  leg,
  type,
  side,
  onQuoteTap,
  onClick,
  dataAttr,
  sizeLabel,
}: {
  price: number | null;
  tint: "bid" | "ask";
  strike: number;
  leg: OptionsContract | null;
  type: "CALL" | "PUT";
  side: "BUY" | "SELL";
  onQuoteTap: LadderBodyProps["onQuoteTap"];
  onClick?: () => void;
  dataAttr?: string;
  sizeLabel?: string | null;
}) {
  const bg = tint === "bid" ? `${DOWN}30` : `${UP}30`;
  return (
    <button
      type="button"
      data-at-quote={dataAttr}
      className="w-full h-full flex flex-col items-end justify-center px-1 active:opacity-80"
      style={{
        fontSize: 12,
        fontWeight: 500,
        fontVariantNumeric: "tabular-nums",
        color: WHITE,
        background: bg,
        border: `1px solid ${BORDER_ROW}`,
        borderRight: tint === "bid" ? `1px solid ${DOWN}55` : `1px solid ${UP}55`,
      }}
      onClick={() => {
        if (onClick) onClick();
        else if (leg) onQuoteTap(leg, type, side);
      }}
    >
      <span>{fmtPx(price)}</span>
      {sizeLabel ? (
        <span style={{ fontSize: 8, color: DIM, lineHeight: 1 }}>{sizeLabel}</span>
      ) : null}
    </button>
  );
}

type LadderRowViewProps = {
  row: LadderRowModel;
  accentHex: string;
  zones: ZoneModel;
  maxFlow: number;
  laneFilters: LadderBodyProps["laneFilters"];
  isSelected: boolean;
  onQuoteTap: LadderBodyProps["onQuoteTap"];
  onAddLeg: LadderBodyProps["onAddLeg"];
  positionQtyByKey: Map<string, number>;
  workingOrderChips?: Map<string, string>;
  flowByKey: Record<string, FlowLaneCounts>;
  underlyingPrice: number | null;
  symbolLabel: string;
  spotBetweenRows: boolean;
  spotFrac: number;
  flipBetweenRows: boolean;
  ladderMode: AtLadderMode;
  verticalWidth: AtVerticalWidth;
  rowByStrike: Map<number, LadderRowModel>;
  rowHeight: number;
  onVerticalTap: LadderBodyProps["onVerticalTap"];
  keepawayPutLine?: number | null;
  keepawayCallLine?: number | null;
};

const LadderRowView = memo(function LadderRowView({
  row,
  accentHex,
  zones,
  maxFlow,
  laneFilters,
  isSelected,
  onQuoteTap,
  onAddLeg,
  positionQtyByKey,
  workingOrderChips,
  flowByKey,
  underlyingPrice,
  symbolLabel,
  spotBetweenRows,
  spotFrac,
  flipBetweenRows,
  ladderMode,
  verticalWidth,
  rowByStrike,
  rowHeight,
  onVerticalTap,
  keepawayPutLine,
  keepawayCallLine,
}: LadderRowViewProps) {
  const callTick = useOptionTick(row.call?.streamKey);
  const putTick = useOptionTick(row.put?.streamKey);
  const putFarStrike = verticalStrikes(row.strike, verticalWidth, "PUT").far;
  const callFarStrike = verticalStrikes(row.strike, verticalWidth, "CALL").far;
  const putFarRow = rowByStrike.get(putFarStrike);
  const callFarRow = rowByStrike.get(callFarStrike);
  const putFarTick = useOptionTick(putFarRow?.put?.streamKey);
  const callFarTick = useOptionTick(callFarRow?.call?.streamKey);

  const putSpread = useMemo(
    () =>
      aggregateSpreadNBBO(
        { bid: putTick?.bid ?? null, ask: putTick?.ask ?? null },
        { bid: putFarTick?.bid ?? null, ask: putFarTick?.ask ?? null },
      ),
    [putTick, putFarTick],
  );
  const callSpread = useMemo(
    () =>
      aggregateSpreadNBBO(
        { bid: callTick?.bid ?? null, ask: callTick?.ask ?? null },
        { bid: callFarTick?.bid ?? null, ask: callFarTick?.ask ?? null },
      ),
    [callTick, callFarTick],
  );

  const putLegFlow = row.put?.streamKey ? flowByKey[row.put.streamKey] ?? { buy: 0, sell: 0, even: 0, unknown: 0 } : { buy: 0, sell: 0, even: 0, unknown: 0 };
  const callLegFlow = row.call?.streamKey ? flowByKey[row.call.streamKey] ?? { buy: 0, sell: 0, even: 0, unknown: 0 } : { buy: 0, sell: 0, even: 0, unknown: 0 };
  const putVF = aggregateVerticalFlow(row.put?.streamKey, putFarRow?.put?.streamKey, flowByKey);
  const callVF = aggregateVerticalFlow(row.call?.streamKey, callFarRow?.call?.streamKey, flowByKey);
  const putFlow = ladderMode === "vertical" ? putVF.counts : putLegFlow;
  const callFlow = ladderMode === "vertical" ? callVF.counts : callLegFlow;

  const spotRow =
    underlyingPrice != null && Math.abs(row.strike - underlyingPrice) < Math.max(underlyingPrice * 0.0005, 0.05);
  const isCallWall = zones.callWall != null && Math.abs(row.strike - zones.callWall) < 0.001;
  const isPutWall = zones.putWall != null && Math.abs(row.strike - zones.putWall) < 0.001;

  const strikePositionQty = (() => {
    const keys = [row.call?.streamKey, row.put?.streamKey].filter(Boolean) as string[];
    for (const key of keys) {
      const q = positionQtyByKey.get(key);
      if (q != null && q !== 0) return q;
    }
    return null;
  })();

  const renderBadges = (key: string | undefined) => {
    if (!key) return null;
    const chips: ReactNode[] = [];
    const work = workingOrderChips?.get(key);
    if (work) {
      chips.push(
        <span key="ord" className="px-0.5 rounded border" style={{ fontSize: 7, color: GRAY, borderColor: BORDER }}>
          {work}
        </span>,
      );
    }
    return chips.length ? <div className="absolute top-0.5 right-0.5 flex gap-px">{chips}</div> : null;
  };

  const putKeepaway = keepawayPutLine != null && row.strike < keepawayPutLine;
  const callKeepaway = keepawayCallLine != null && row.strike > keepawayCallLine;

  const rowStyle: React.CSSProperties = {
    gridTemplateColumns: AT_LADDER_GRID,
    height: rowHeight,
    borderBottom: `1px solid ${BORDER_ROW}`,
    fontFamily: MONO,
    position: "relative",
    background: spotRow ? `${accentHex}22` : isSelected ? "rgba(251,191,36,0.12)" : AT_LADDER_PANEL_BG,
    boxShadow: isCallWall
      ? `inset 4px 0 0 ${UP}`
      : isPutWall
        ? `inset 4px 0 0 ${DOWN}`
        : putKeepaway
          ? "inset 3px 0 0 rgba(242,54,69,0.35)"
          : callKeepaway
            ? "inset -3px 0 0 rgba(251,191,36,0.35)"
            : isSelected
              ? `inset 0 0 0 1px ${accentHex}55`
              : undefined,
  };

  const putBidPx = ladderMode === "vertical" ? putSpread.bid : putTick?.bid ?? null;
  const putAskPx = ladderMode === "vertical" ? putSpread.ask : putTick?.ask ?? null;
  const callBidPx = ladderMode === "vertical" ? callSpread.bid : callTick?.bid ?? null;
  const callAskPx = ladderMode === "vertical" ? callSpread.ask : callTick?.ask ?? null;

  return (
    <>
      {spotBetweenRows && underlyingPrice != null && (
        <div
          data-at-spot-gap
          className="relative w-full grid"
          style={{ gridTemplateColumns: AT_LADDER_GRID, height: 10 }}
        >
          <div
            className="col-span-full relative"
            style={{ gridColumn: "1 / -1", height: 10 }}
          >
            <div
              className="absolute left-0 right-0"
              style={{
                top: Math.min(8, Math.max(0, spotFrac * 8)),
                borderTop: `1px dashed ${accentHex}99`,
              }}
            />
          </div>
          <div
            className="flex items-center justify-center col-start-4 z-[1]"
            style={{ marginTop: Math.min(4, Math.max(-4, spotFrac * 8 - 4)) }}
          >
            <span style={{ fontSize: 7, color: accentHex, background: BG, padding: "0 4px" }}>
              {symbolLabel} {underlyingPrice.toFixed(underlyingPrice % 1 === 0 ? 0 : 2)}
            </span>
          </div>
        </div>
      )}
      {flipBetweenRows && zones.flip != null && (
        <div
          className="relative w-full grid items-start"
          style={{ gridTemplateColumns: AT_LADDER_GRID, height: 6, marginTop: -1 }}
        >
          <div style={{ gridColumn: "1 / 7", borderTop: `1px dotted ${GAMMA_SCENARIO}`, marginTop: 3 }} />
          <FlipPill flip={zones.flip} />
        </div>
      )}
      <div className="grid items-stretch w-full" style={rowStyle}>
        <FlowBarCell flow={putFlow} laneFilters={laneFilters} side="put" maxFlow={maxFlow} />
        <QuoteCell
          price={putBidPx}
          tint="bid"
          strike={row.strike}
          leg={row.put}
          type="PUT"
          side="SELL"
          onQuoteTap={onQuoteTap}
          sizeLabel={ladderMode === "single" && putTick?.bidSize != null ? `×${Math.round(putTick.bidSize)}` : null}
          dataAttr={`put-bid-${row.strike}`}
          onClick={
            ladderMode === "vertical" && row.put
              ? () =>
                  onVerticalTap({
                    anchorStrike: row.strike,
                    farStrike: putFarStrike,
                    type: "PUT",
                    side: "SELL",
                    nearContract: row.put!,
                  })
              : undefined
          }
        />
        <QuoteCell
          price={putAskPx}
          tint="ask"
          strike={row.strike}
          leg={row.put}
          type="PUT"
          side="BUY"
          onQuoteTap={onQuoteTap}
          sizeLabel={ladderMode === "single" && putTick?.askSize != null ? `×${Math.round(putTick.askSize)}` : null}
          dataAttr={`put-ask-${row.strike}`}
          onClick={
            ladderMode === "vertical" && row.put
              ? () =>
                  onVerticalTap({
                    anchorStrike: row.strike,
                    farStrike: putFarStrike,
                    type: "PUT",
                    side: "BUY",
                    nearContract: row.put!,
                  })
              : undefined
          }
        />
        <div
          className="relative flex flex-col items-center justify-center h-full"
          style={{
            width: STRIKE_W,
            background: accentHex,
            color: "#080808",
            fontSize: 13,
            fontWeight: 600,
            border: `1px solid ${accentHex}`,
            fontVariantNumeric: "tabular-nums",
          }}
          data-at-strike={row.strike}
        >
          {renderBadges(row.call?.streamKey ?? row.put?.streamKey)}
          <span className="leading-tight">{row.strike % 1 === 0 ? row.strike : row.strike.toFixed(1)}</span>
          {strikePositionQty != null && (
            <span
              data-at-position-badge
              className="leading-none"
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 6px",
                borderRadius: 999,
                color: "#0a0a0a",
                background: strikePositionQty > 0 ? UP : DOWN,
                marginTop: 1,
              }}
            >
              {strikePositionQty > 0 ? "+" : "−"}
              {Math.abs(strikePositionQty)}
            </span>
          )}
          {isCallWall && <span style={{ fontSize: 7, opacity: 0.65 }}>CALL WALL</span>}
          {isPutWall && <span style={{ fontSize: 7, opacity: 0.65 }}>PUT WALL</span>}
          {spotRow && !isCallWall && !isPutWall && <span style={{ fontSize: 7, opacity: 0.65 }}>{symbolLabel}</span>}
        </div>
        <QuoteCell
          price={callBidPx}
          tint="bid"
          strike={row.strike}
          leg={row.call}
          type="CALL"
          side="SELL"
          onQuoteTap={onQuoteTap}
          sizeLabel={ladderMode === "single" && callTick?.bidSize != null ? `×${Math.round(callTick.bidSize)}` : null}
          dataAttr={`call-bid-${row.strike}`}
          onClick={
            ladderMode === "vertical" && row.call
              ? () =>
                  onVerticalTap({
                    anchorStrike: row.strike,
                    farStrike: callFarStrike,
                    type: "CALL",
                    side: "SELL",
                    nearContract: row.call!,
                  })
              : undefined
          }
        />
        <QuoteCell
          price={callAskPx}
          tint="ask"
          strike={row.strike}
          leg={row.call}
          type="CALL"
          side="BUY"
          onQuoteTap={onQuoteTap}
          sizeLabel={ladderMode === "single" && callTick?.askSize != null ? `×${Math.round(callTick.askSize)}` : null}
          dataAttr={`call-ask-${row.strike}`}
          onClick={
            ladderMode === "vertical" && row.call
              ? () =>
                  onVerticalTap({
                    anchorStrike: row.strike,
                    farStrike: callFarStrike,
                    type: "CALL",
                    side: "BUY",
                    nearContract: row.call!,
                  })
              : undefined
          }
        />
        <FlowBarCell flow={callFlow} laneFilters={laneFilters} side="call" maxFlow={maxFlow} />
      </div>
    </>
  );
});

function FlipPill({ flip }: { flip: number }) {
  return (
    <span className="flex items-start justify-end pr-0.5 col-start-7" style={{ marginTop: -5 }}>
      <span
        className="px-1 rounded-full whitespace-nowrap"
        style={{
          fontSize: 8,
          color: GAMMA_SCENARIO,
          border: `1px solid ${GAMMA_SCENARIO}`,
          background: BG,
          fontFamily: MONO,
        }}
      >
        Flip {flip.toFixed(0)}
      </span>
    </span>
  );
}

export const LadderBody = memo(function LadderBody(props: LadderBodyProps) {
  const rowHeight = props.rowHeight ?? AT_LADDER_ROW_H;
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
    <div style={{ background: AT_LADDER_PANEL_BG }}>
      {props.rows.map((row, i) => {
        const next = props.rows[i + 1];
        const spotBetween =
          props.underlyingPrice != null &&
          next != null &&
          row.strike >= props.underlyingPrice &&
          next.strike < props.underlyingPrice;
        const spotFrac =
          spotBetween && props.underlyingPrice != null
            ? (row.strike - props.underlyingPrice) / (row.strike - next!.strike)
            : 0;
        const flipBetween =
          props.zones.flip != null &&
          next != null &&
          row.strike > props.zones.flip &&
          next.strike <= props.zones.flip;
        return (
          <LadderRowView
            key={row.strike}
            row={row}
            accentHex={props.accentHex}
            zones={props.zones}
            maxFlow={maxFlow}
            laneFilters={props.laneFilters}
            isSelected={props.selectedStrike === row.strike}
            underlyingPrice={props.underlyingPrice}
            symbolLabel={props.symbolLabel}
            spotBetweenRows={spotBetween}
            spotFrac={spotFrac}
            flipBetweenRows={flipBetween}
            ladderMode={props.ladderMode}
            verticalWidth={props.verticalWidth}
            rowByStrike={props.rowByStrike}
            rowHeight={rowHeight}
            onVerticalTap={props.onVerticalTap}
            keepawayPutLine={props.keepawayPutLine}
            keepawayCallLine={props.keepawayCallLine}
            onQuoteTap={props.onQuoteTap}
            onAddLeg={props.onAddLeg}
            positionQtyByKey={props.positionQtyByKey}
            workingOrderChips={props.workingOrderChips}
            flowByKey={props.flowByKey}
          />
        );
      })}
    </div>
  );
});