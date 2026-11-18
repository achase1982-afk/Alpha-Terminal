import { memo, useMemo, type ReactNode } from "react";
import type { OptionsContract } from "@/components/OptionsTab";
import {
  STRIKE_W, BORDER_ROW, BORDER, UP, DOWN, GRAY, WHITE, DIM,
  BG, MONO, FW_LIGHT, FW_PREMIUM, GAMMA_SCENARIO, ITM_OCEAN,
} from "@/components/options/optionsTheme";
import { useOptionTick } from "@/lib/options-stream-store";
import type { FlowLaneCounts } from "@/lib/active-trader/flowClassifier";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { ladderStrikeZoneTag } from "@/lib/active-trader/atGlanceWallDisplay";
import {
  AT_LADDER_GRID,
  AT_LADDER_PANEL_BG,
  AT_LADDER_ROW_H,
} from "@/lib/active-trader/atLadderLayout";
import type { AtLadderMode, AtVerticalWidth } from "@/lib/active-trader/activeTraderPrefs";
import { aggregateSpreadNBBO, verticalStrikes } from "@/lib/active-trader/aggregateSpreadNBBO";
import { aggregateVerticalFlow } from "@/lib/active-trader/atVerticalFlow";
import { atLadderLegKey } from "@/lib/active-trader/atLadderLegKeys";
import { atLadderExecutableQuote } from "@/lib/active-trader/atLadderExecutableQuote";

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
  activityByKey: Record<string, number>;
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
  selectedQuoteCells?: ReadonlySet<string>;
  chainQuoteTs?: number;
  expiryLabel: string;
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
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  return n.toFixed(2);
}

function FlowLaneCell({
  activity,
  side,
  maxActivity,
  stale,
}: {
  activity: number;
  side: "put" | "call";
  maxActivity: number;
  stale?: boolean;
}) {
  const ratio = maxActivity > 0 ? Math.min(1, activity / maxActivity) : 0;
  const alpha = activity > 0 ? 0.14 + ratio * 0.72 : stale ? 0.05 : 0.02;
  const rgb = side === "put" ? "242, 54, 69" : "0, 209, 102";
  const tip = activity > 0 ? `Est. contracts · ${activity}` : stale ? "No recent trades" : "Quiet";
  return (
    <div
      className="h-full w-full min-w-0"
      title={tip}
      data-at-flow-lane={side}
      style={{
        background:
          activity > 0
            ? `linear-gradient(180deg, rgba(${rgb}, ${alpha}) 0%, rgba(${rgb}, 0.06) 100%)`
            : stale
              ? "repeating-linear-gradient(135deg, rgba(255,255,255,0.03) 0 2px, transparent 2px 6px)"
              : AT_LADDER_PANEL_BG,
      }}
    />
  );
}

function quoteAriaLabel(input: {
  strike: number;
  type: "CALL" | "PUT";
  side: "BUY" | "SELL";
  tint: "bid" | "ask";
  price: number | null;
  expiryLabel: string;
}): string {
  const px = input.price != null && Number.isFinite(input.price) ? input.price.toFixed(2) : "unavailable";
  return `${input.side} ${input.type} strike ${input.strike} expiry ${input.expiryLabel} at ${input.tint} ${px}`;
}

function QuoteCell({
  price,
  tint,
  strike,
  leg,
  type,
  side,
  expiryLabel,
  onQuoteTap,
  onClick,
  dataAttr,
  legSelected,
}: {
  price: number | null;
  tint: "bid" | "ask";
  strike: number;
  leg: OptionsContract | null;
  type: "CALL" | "PUT";
  side: "BUY" | "SELL";
  expiryLabel: string;
  onQuoteTap: LadderBodyProps["onQuoteTap"];
  onClick?: () => void;
  dataAttr?: string;
  legSelected?: boolean;
}) {
  const selectColor = side === "BUY" ? UP : DOWN;
  return (
    <button
      type="button"
      aria-label={quoteAriaLabel({ strike, type, side, tint, price, expiryLabel })}
      data-at-quote={dataAttr}
      data-at-quote-side={side}
      className="relative w-full h-full flex flex-col items-end justify-center px-1 active:opacity-80"
      style={{
        fontSize: 14,
        fontWeight: 500,
        fontVariantNumeric: "tabular-nums",
        color: WHITE,
        background: AT_LADDER_PANEL_BG,
        border: legSelected ? `2px solid ${selectColor}` : `1px solid ${BORDER_ROW}`,
      }}
      onClick={() => {
        if (onClick) onClick();
        else if (leg) onQuoteTap(leg, type, side);
      }}
    >
      {legSelected ? (
        <span
          className="absolute top-0 left-0 px-0.5 leading-none"
          style={{ fontSize: 7, fontWeight: 700, color: selectColor, letterSpacing: "0.04em" }}
        >
          {side}
        </span>
      ) : null}
      <span>{fmtPx(price)}</span>
    </button>
  );
}

type LadderRowViewProps = {
  row: LadderRowModel;
  accentHex: string;
  zones: ZoneModel;
  maxActivity: number;
  laneFilters: LadderBodyProps["laneFilters"];
  isSelected: boolean;
  onQuoteTap: LadderBodyProps["onQuoteTap"];
  onAddLeg: LadderBodyProps["onAddLeg"];
  positionQtyByKey: Map<string, number>;
  workingOrderChips?: Map<string, string>;
  flowByKey: Record<string, FlowLaneCounts>;
  activityByKey: Record<string, number>;
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
  selectedLegKeys?: ReadonlySet<string>;
  selectedQuoteCells?: ReadonlySet<string>;
  chainQuoteTs?: number;
  expiryLabel: string;
};

const LadderRowView = memo(function LadderRowView({
  row,
  accentHex,
  zones,
  maxActivity,
  laneFilters,
  isSelected,
  onQuoteTap,
  onAddLeg,
  positionQtyByKey,
  workingOrderChips,
  flowByKey,
  activityByKey,
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
  selectedQuoteCells,
  chainQuoteTs = 0,
  expiryLabel,
}: LadderRowViewProps) {
  const callTick = useOptionTick(row.call?.streamKey);
  const putTick = useOptionTick(row.put?.streamKey);
  const putFarStrike = verticalStrikes(row.strike, verticalWidth, "PUT").far;
  const callFarStrike = verticalStrikes(row.strike, verticalWidth, "CALL").far;
  const putFarRow = rowByStrike.get(putFarStrike);
  const callFarRow = rowByStrike.get(callFarStrike);
  const putFarTick = useOptionTick(putFarRow?.put?.streamKey);
  const callFarTick = useOptionTick(callFarRow?.call?.streamKey);

  const putSpread = useMemo(() => {
    const near = atLadderExecutableQuote(row.put, putTick, chainQuoteTs);
    const far = atLadderExecutableQuote(putFarRow?.put ?? null, putFarTick, chainQuoteTs);
    return aggregateSpreadNBBO(
      { bid: near.bid, ask: near.ask },
      { bid: far.bid, ask: far.ask },
    );
  }, [row.put, putTick, putFarRow?.put, putFarTick, chainQuoteTs]);
  const callSpread = useMemo(() => {
    const near = atLadderExecutableQuote(row.call, callTick, chainQuoteTs);
    const far = atLadderExecutableQuote(callFarRow?.call ?? null, callFarTick, chainQuoteTs);
    return aggregateSpreadNBBO(
      { bid: near.bid, ask: near.ask },
      { bid: far.bid, ask: far.ask },
    );
  }, [row.call, callTick, callFarRow?.call, callFarTick, chainQuoteTs]);

  const putLegFlow = row.put?.streamKey ? flowByKey[row.put.streamKey] ?? { buy: 0, sell: 0, even: 0, unknown: 0 } : { buy: 0, sell: 0, even: 0, unknown: 0 };
  const callLegFlow = row.call?.streamKey ? flowByKey[row.call.streamKey] ?? { buy: 0, sell: 0, even: 0, unknown: 0 } : { buy: 0, sell: 0, even: 0, unknown: 0 };
  const putVF = aggregateVerticalFlow(row.put?.streamKey, putFarRow?.put?.streamKey, flowByKey);
  const callVF = aggregateVerticalFlow(row.call?.streamKey, callFarRow?.call?.streamKey, flowByKey);
  const putFlow = ladderMode === "vertical" ? putVF.counts : putLegFlow;
  const callFlow = ladderMode === "vertical" ? callVF.counts : callLegFlow;

  const spotRow =
    underlyingPrice != null && Math.abs(row.strike - underlyingPrice) < Math.max(underlyingPrice * 0.0005, 0.05);
  const zoneTag = ladderStrikeZoneTag(zones, row.strike);

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
  const keepawayForbidden = putKeepaway || callKeepaway;

  const callNearAct = row.call?.streamKey ? activityByKey[row.call.streamKey] ?? 0 : 0;
  const callFarAct = callFarRow?.call?.streamKey ? activityByKey[callFarRow.call.streamKey] ?? 0 : 0;
  const callActivity = ladderMode === "vertical" ? callNearAct + callFarAct : callNearAct;
  const putNearAct = row.put?.streamKey ? activityByKey[row.put.streamKey] ?? 0 : 0;
  const putFarAct = putFarRow?.put?.streamKey ? activityByKey[putFarRow.put.streamKey] ?? 0 : 0;
  const putActivity = ladderMode === "vertical" ? putNearAct + putFarAct : putNearAct;
  const callStale = row.call != null && callTick == null && chainQuoteTs > 0;
  const putStale = row.put != null && putTick == null && chainQuoteTs > 0;

  const rowStyle: React.CSSProperties = {
    gridTemplateColumns: AT_LADDER_GRID,
    height: rowHeight,
    borderBottom: `1px solid ${BORDER_ROW}`,
    fontFamily: MONO,
    position: "relative",
    background: spotRow
      ? `linear-gradient(180deg, ${accentHex}18 0%, ${accentHex}08 100%)`
      : keepawayForbidden
        ? "rgba(255,255,255,0.045)"
        : isSelected
          ? "rgba(251,191,36,0.12)"
          : AT_LADDER_PANEL_BG,
    boxShadow:
      zoneTag === "CALL WALL"
        ? `inset 4px 0 0 ${UP}`
        : zoneTag === "PUT WALL"
          ? `inset 4px 0 0 ${DOWN}`
          : isSelected
            ? `inset 0 0 0 1px ${accentHex}55`
            : undefined,
    borderTop: spotRow ? `1px solid ${accentHex}55` : undefined,
  };

  const putKey = row.put ? atLadderLegKey(row.put, "PUT") : null;
  const callKey = row.call ? atLadderLegKey(row.call, "CALL") : null;
  const putSingle = atLadderExecutableQuote(row.put, putTick, chainQuoteTs);
  const callSingle = atLadderExecutableQuote(row.call, callTick, chainQuoteTs);
  const putBidPx = ladderMode === "vertical" ? putSpread.bid : putSingle.bid;
  const putAskPx = ladderMode === "vertical" ? putSpread.ask : putSingle.ask;
  const callBidPx = ladderMode === "vertical" ? callSpread.bid : callSingle.bid;
  const callAskPx = ladderMode === "vertical" ? callSpread.ask : callSingle.ask;

  return (
    <>
      {flipBetweenRows && zones.flip != null && (
        <div
          data-at-flip-gap
          className="relative w-full grid"
          style={{ gridTemplateColumns: AT_LADDER_GRID, height: 12 }}
        >
          <div
            className="pointer-events-none"
            style={{ gridColumn: "1 / -1", gridRow: 1, height: 12, position: "relative" }}
          >
            <div
              className="absolute left-0 right-0"
              style={{ top: 5, borderTop: `1px dotted ${GAMMA_SCENARIO}` }}
            />
          </div>
          <FlipPill flip={zones.flip} />
        </div>
      )}
      <div className="grid items-stretch w-full" style={rowStyle}>
        <FlowLaneCell activity={callActivity} side="call" maxActivity={maxActivity} stale={callStale} />
        <QuoteCell
          price={callBidPx}
          tint="bid"
          strike={row.strike}
          leg={row.call}
          type="CALL"
          side="SELL"
          expiryLabel={expiryLabel}
          onQuoteTap={onQuoteTap}
          dataAttr={`call-bid-${row.strike}`}
          legSelected={!!(callKey && selectedQuoteCells?.has(`${callKey}|bid`))}
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
          expiryLabel={expiryLabel}
          onQuoteTap={onQuoteTap}
          dataAttr={`call-ask-${row.strike}`}
          legSelected={!!(callKey && selectedQuoteCells?.has(`${callKey}|ask`))}
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
        <div
          className="relative flex flex-col items-center justify-center h-full"
          style={{
            width: STRIKE_W,
            background: spotRow ? "#fbbf24" : AT_LADDER_PANEL_BG,
            color: spotRow ? "#0a0a0a" : WHITE,
            fontSize: 14,
            fontWeight: spotRow ? 600 : 500,
            border: spotRow ? "1px solid #fbbf24" : `1px solid ${BORDER_ROW}`,
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
          {zoneTag ? (
            <span data-at-strike-zone-tag style={{ fontSize: 7, opacity: 0.65 }}>
              {zoneTag}
            </span>
          ) : null}
          {spotRow && !zoneTag && <span style={{ fontSize: 7, opacity: 0.65 }}>{symbolLabel}</span>}
        </div>
        <QuoteCell
          price={putBidPx}
          tint="bid"
          strike={row.strike}
          leg={row.put}
          type="PUT"
          side="SELL"
          expiryLabel={expiryLabel}
          onQuoteTap={onQuoteTap}
          dataAttr={`put-bid-${row.strike}`}
          legSelected={!!(putKey && selectedQuoteCells?.has(`${putKey}|bid`))}
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
          expiryLabel={expiryLabel}
          onQuoteTap={onQuoteTap}
          dataAttr={`put-ask-${row.strike}`}
          legSelected={!!(putKey && selectedQuoteCells?.has(`${putKey}|ask`))}
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
        <FlowLaneCell activity={putActivity} side="put" maxActivity={maxActivity} stale={putStale} />
      </div>
    </>
  );
});

function FlipPill({ flip }: { flip: number }) {
  return (
    <span
      className="flex items-center justify-end pointer-events-none overflow-hidden"
      style={{
        gridColumn: "6 / 8",
        gridRow: 1,
        height: 12,
        maxHeight: 12,
        lineHeight: "12px",
        paddingRight: 2,
        alignSelf: "center",
      }}
    >
      <span
        className="rounded-full whitespace-nowrap"
        style={{
          fontSize: 8,
          lineHeight: "10px",
          height: 10,
          maxHeight: 10,
          padding: "0 3px",
          boxSizing: "border-box",
          display: "inline-flex",
          alignItems: "center",
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
  const maxActivity = useMemo(() => {
    let m = 1;
    for (const row of props.rows) {
      for (const c of [row.call, row.put]) {
        if (!c?.streamKey) continue;
        const act = props.activityByKey[c.streamKey] ?? 0;
        if (act > 0) m = Math.max(m, act);
      }
    }
    return m;
  }, [props.rows, props.activityByKey]);

  return (
    <div style={{ background: AT_LADDER_PANEL_BG }}>
      {props.rows.map((row, i) => {
        const prev = props.rows[i - 1];
        const spotBetween =
          props.underlyingPrice != null &&
          prev != null &&
          prev.strike > props.underlyingPrice &&
          row.strike <= props.underlyingPrice;
        const spotFrac =
          spotBetween && props.underlyingPrice != null
            ? (prev.strike - props.underlyingPrice) / (prev.strike - row.strike)
            : 0;
        const flipBetween =
          props.zones.flip != null &&
          prev != null &&
          prev.strike > props.zones.flip &&
          row.strike <= props.zones.flip;
        return (
          <LadderRowView
            key={row.strike}
            row={row}
            accentHex={props.accentHex}
            zones={props.zones}
            maxActivity={maxActivity}
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
            activityByKey={props.activityByKey}
            selectedQuoteCells={props.selectedQuoteCells}
            chainQuoteTs={props.chainQuoteTs}
            expiryLabel={props.expiryLabel}
          />
        );
      })}
    </div>
  );
});