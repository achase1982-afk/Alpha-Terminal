import { memo, useMemo, type CSSProperties, type ReactNode } from "react";
import type { OptionsContract } from "@/components/OptionsTab";
import {
  STRIKE_W, BORDER_ROW, BORDER, UP, DOWN, GRAY, WHITE,
  BG, MONO, GAMMA_SCENARIO, GOLD, PUT_WALL,
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
import type { LadderHeatCellView } from "@/lib/active-trader/atLadderVolumeHeatEngine";
import type { AtLadderMode, AtVerticalWidth } from "@/lib/active-trader/activeTraderPrefs";
import { aggregateSpreadNBBO, verticalStrikes } from "@/lib/active-trader/aggregateSpreadNBBO";
import { atLadderLegKey } from "@/lib/active-trader/atLadderLegKeys";
import { atLadderDisplayQuote, atLadderExecutableQuote } from "@/lib/active-trader/atLadderExecutableQuote";

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
  heatByKey: Record<string, LadderHeatCellView>;
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

const EMPTY_HEAT: LadderHeatCellView = { availability: "unavailable", contracts30s: 0, intensity: 0 };

function fmtPx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  return n.toFixed(2);
}

function mergeLegHeat(
  mode: AtLadderMode,
  nearKey: string | undefined,
  farKey: string | undefined,
  heatByKey: Record<string, LadderHeatCellView>,
): LadderHeatCellView {
  if (!nearKey) return EMPTY_HEAT;
  const near = heatByKey[nearKey] ?? EMPTY_HEAT;
  if (mode !== "vertical" || !farKey) return near;
  const far = heatByKey[farKey] ?? EMPTY_HEAT;
  return {
    availability: near.availability,
    contracts30s: near.contracts30s + far.contracts30s,
    intensity: Math.max(near.intensity, far.intensity),
  };
}

function heatPairStyle(view: LadderHeatCellView, side: "call" | "put"): CSSProperties {
  const rgb = side === "call" ? "0, 209, 102" : "242, 54, 69";
  if (view.availability === "unavailable") {
    return { background: AT_LADDER_PANEL_BG };
  }
  if (view.availability === "stale") {
    return {
      background:
        "repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0 2px, transparent 2px 7px)",
    };
  }
  if (view.availability === "quiet") {
    return {
      background: AT_LADDER_PANEL_BG,
      boxShadow: `inset 0 0 0 1px rgba(${rgb}, 0.06)`,
    };
  }
  const alpha = 0.1 + view.intensity * 0.82;
  return {
    background: `linear-gradient(90deg, rgba(${rgb}, ${alpha}) 0%, rgba(${rgb}, ${alpha * 0.45}) 55%, rgba(${rgb}, ${alpha * 0.12}) 100%)`,
    transition: "background 160ms ease-out, box-shadow 160ms ease-out",
    willChange: "background",
  };
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
  unavailableReason,
  dimmed,
  asOfLabel,
  locked,
  tapable = true,
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
  dividerLeft,
}: {
  price: number | null;
  unavailableReason?: string | null;
  dimmed?: boolean;
  asOfLabel?: string | null;
  locked?: boolean;
  tapable?: boolean;
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
  dividerLeft?: boolean;
}) {
  const selectColor = side === "BUY" ? UP : DOWN;
  return (
    <button
      type="button"
      aria-label={quoteAriaLabel({ strike, type, side, tint, price, expiryLabel })}
      data-at-quote={dataAttr}
      data-at-quote-side={side}
      data-at-quote-unavailable={unavailableReason ?? undefined}
      data-at-quote-locked={locked ? "1" : undefined}
      className="relative w-full h-full flex flex-col items-end justify-center px-1 active:opacity-80"
      style={{
        fontSize: 14,
        fontWeight: 500,
        fontVariantNumeric: "tabular-nums",
        color: WHITE,
        background: "transparent",
        borderTop: legSelected ? `2px solid ${selectColor}` : `1px solid ${BORDER_ROW}`,
        borderBottom: legSelected ? `2px solid ${selectColor}` : `1px solid ${BORDER_ROW}`,
        borderLeft: legSelected ? `2px solid ${selectColor}` : `1px solid ${BORDER_ROW}`,
        borderRight: legSelected ? `2px solid ${selectColor}` : dividerLeft ? `1px solid ${BORDER_ROW}` : `1px solid ${BORDER_ROW}`,
        boxSizing: "border-box",
      }}
      disabled={!tapable && !onClick}
      onClick={() => {
        if (!tapable && !onClick) return;
        if (onClick) onClick();
        else if (leg && tapable) onQuoteTap(leg, type, side);
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
      <span
        style={
          unavailableReason
            ? { fontSize: 9, fontWeight: 600, color: GRAY, letterSpacing: "0.02em", textTransform: "none" }
            : { color: dimmed ? GRAY : WHITE, opacity: dimmed ? 0.72 : 1 }
        }
      >
        {unavailableReason ?? fmtPx(price)}
      </span>
      {asOfLabel ? (
        <span style={{ fontSize: 7, fontWeight: 500, color: GRAY, lineHeight: 1.1, marginTop: 1, maxWidth: "100%", textAlign: "right" }}>
          {asOfLabel}
        </span>
      ) : null}
      {locked ? (
        <span style={{ fontSize: 7, fontWeight: 600, color: GRAY, opacity: 0.85, letterSpacing: "0.04em", marginTop: asOfLabel ? 0 : 1 }}>
          Locked
        </span>
      ) : null}
    </button>
  );
}

function QuoteHeatPair({
  side,
  view,
  bid,
  ask,
}: {
  side: "call" | "put";
  view: LadderHeatCellView;
  bid: ReactNode;
  ask: ReactNode;
}) {
  return (
    <div
      className="relative grid h-full min-w-0"
      style={{
        gridColumn: "span 2",
        gridTemplateColumns: "1fr 1fr",
        ...heatPairStyle(view, side),
      }}
      data-at-quote-heat={side}
      data-at-quote-heat-state={view.availability}
    >
      {bid}
      {ask}
    </div>
  );
}

type LadderRowViewProps = {
  row: LadderRowModel;
  accentHex: string;
  zones: ZoneModel;
  isSelected: boolean;
  onQuoteTap: LadderBodyProps["onQuoteTap"];
  positionQtyByKey: Map<string, number>;
  workingOrderChips?: Map<string, string>;
  heatByKey: Record<string, LadderHeatCellView>;
  underlyingPrice: number | null;
  symbolLabel: string;
  flipBetweenRows: boolean;
  ladderMode: AtLadderMode;
  verticalWidth: AtVerticalWidth;
  rowByStrike: Map<number, LadderRowModel>;
  rowHeight: number;
  onVerticalTap: LadderBodyProps["onVerticalTap"];
  keepawayPutLine?: number | null;
  keepawayCallLine?: number | null;
  selectedQuoteCells?: ReadonlySet<string>;
  chainQuoteTs?: number;
  expiryLabel: string;
};

const LadderRowView = memo(function LadderRowView({
  row,
  accentHex,
  zones,
  isSelected,
  onQuoteTap,
  positionQtyByKey,
  workingOrderChips,
  heatByKey,
  underlyingPrice,
  symbolLabel,
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

  const rowStyle: CSSProperties = {
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
    boxShadow: isSelected && !zoneTag ? `inset 0 0 0 1px ${accentHex}55` : undefined,
    borderTop: spotRow ? `1px solid ${accentHex}55` : undefined,
  };

  const putKey = row.put ? atLadderLegKey(row.put, "PUT") : null;
  const callKey = row.call ? atLadderLegKey(row.call, "CALL") : null;
  const putSingle = atLadderDisplayQuote(row.put, putTick, chainQuoteTs);
  const callSingle = atLadderDisplayQuote(row.call, callTick, chainQuoteTs);
  const putBidPx = ladderMode === "vertical" ? putSpread.bid : putSingle.bid;
  const putAskPx = ladderMode === "vertical" ? putSpread.ask : putSingle.ask;
  const callBidPx = ladderMode === "vertical" ? callSpread.bid : callSingle.bid;
  const callAskPx = ladderMode === "vertical" ? callSpread.ask : callSingle.ask;
  const putBidReason = putBidPx == null ? putSingle.reason : null;
  const putAskReason = putAskPx == null ? putSingle.reason : null;
  const callBidReason = callBidPx == null ? callSingle.reason : null;
  const callAskReason = callAskPx == null ? callSingle.reason : null;
  const putTapable = putSingle.tapable;
  const callTapable = callSingle.tapable;

  const callHeat = mergeLegHeat(
    ladderMode,
    row.call?.streamKey,
    callFarRow?.call?.streamKey,
    heatByKey,
  );
  const putHeat = mergeLegHeat(ladderMode, row.put?.streamKey, putFarRow?.put?.streamKey, heatByKey);

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
        <QuoteHeatPair
          side="call"
          view={callHeat}
          bid={
            <QuoteCell
              price={callBidPx}
              unavailableReason={callBidReason}
              dimmed={callSingle.dimmed}
              asOfLabel={callSingle.asOfLabel}
              locked={callSingle.locked && callBidPx != null}
              tapable={callTapable}
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
          }
          ask={
            <QuoteCell
              price={callAskPx}
              unavailableReason={callAskReason}
              dimmed={callSingle.dimmed}
              tapable={callTapable}
              tint="ask"
              strike={row.strike}
              leg={row.call}
              type="CALL"
              side="BUY"
              expiryLabel={expiryLabel}
              onQuoteTap={onQuoteTap}
              dataAttr={`call-ask-${row.strike}`}
              legSelected={!!(callKey && selectedQuoteCells?.has(`${callKey}|ask`))}
              dividerLeft
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
            border: spotRow
              ? "1px solid #fbbf24"
              : zoneTag === "CALL WALL"
                ? `1px solid ${GOLD}`
                : zoneTag === "PUT WALL"
                  ? `1px solid ${PUT_WALL}`
                  : `1px solid ${BORDER_ROW}`,
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
          {zoneTag === "CALL WALL" || zoneTag === "PUT WALL" ? (
            <span
              data-at-strike-zone-tag
              data-at-strike-wall={zoneTag === "CALL WALL" ? "call" : "put"}
              style={{
                fontSize: 7,
                lineHeight: 1,
                color: zoneTag === "CALL WALL" ? GOLD : PUT_WALL,
                opacity: 0.9,
              }}
            >
              {zoneTag === "CALL WALL" ? "Call wall" : "Put wall"}
            </span>
          ) : zoneTag ? (
            <span data-at-strike-zone-tag style={{ fontSize: 7, opacity: 0.65 }}>
              {zoneTag}
            </span>
          ) : null}
          {spotRow && !zoneTag && <span style={{ fontSize: 7, opacity: 0.65 }}>{symbolLabel}</span>}
        </div>
        <QuoteHeatPair
          side="put"
          view={putHeat}
          bid={
            <QuoteCell
              price={putBidPx}
              unavailableReason={putBidReason}
              dimmed={putSingle.dimmed}
              asOfLabel={putSingle.asOfLabel}
              locked={putSingle.locked && putBidPx != null}
              tapable={putTapable}
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
          }
          ask={
            <QuoteCell
              price={putAskPx}
              unavailableReason={putAskReason}
              dimmed={putSingle.dimmed}
              tapable={putTapable}
              tint="ask"
              strike={row.strike}
              leg={row.put}
              type="PUT"
              side="BUY"
              expiryLabel={expiryLabel}
              onQuoteTap={onQuoteTap}
              dataAttr={`put-ask-${row.strike}`}
              legSelected={!!(putKey && selectedQuoteCells?.has(`${putKey}|ask`))}
              dividerLeft
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
          }
        />
      </div>
    </>
  );
});

function FlipPill({ flip }: { flip: number }) {
  return (
    <span
      className="flex items-center justify-end pointer-events-none overflow-hidden"
      style={{
        gridColumn: "4 / 6",
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

  return (
    <div style={{ background: AT_LADDER_PANEL_BG }}>
      {props.rows.map((row, i) => {
        const prev = props.rows[i - 1];
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
            isSelected={props.selectedStrike === row.strike}
            underlyingPrice={props.underlyingPrice}
            symbolLabel={props.symbolLabel}
            flipBetweenRows={flipBetween}
            ladderMode={props.ladderMode}
            verticalWidth={props.verticalWidth}
            rowByStrike={props.rowByStrike}
            rowHeight={rowHeight}
            onVerticalTap={props.onVerticalTap}
            keepawayPutLine={props.keepawayPutLine}
            keepawayCallLine={props.keepawayCallLine}
            onQuoteTap={props.onQuoteTap}
            positionQtyByKey={props.positionQtyByKey}
            workingOrderChips={props.workingOrderChips}
            heatByKey={props.heatByKey}
            selectedQuoteCells={props.selectedQuoteCells}
            chainQuoteTs={props.chainQuoteTs}
            expiryLabel={props.expiryLabel}
          />
        );
      })}
    </div>
  );
});