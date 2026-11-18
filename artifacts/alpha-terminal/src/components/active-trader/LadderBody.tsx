import { memo, useMemo, type CSSProperties, type ReactNode } from "react";
import type { OptionsContract } from "@/components/OptionsTab";
import {
  BORDER,
  UP,
  DOWN,
  DOWN_TEXT,
  GRAY,
  WHITE,
  MONO,
  GAMMA_SCENARIO,
  GOLD,
  PUT_WALL,
} from "@/components/options/optionsTheme";
import { useOptionTick } from "@/lib/options-stream-store";
import type { FlowLaneCounts } from "@/lib/active-trader/flowClassifier";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { ladderStrikeZoneTag } from "@/lib/active-trader/atGlanceWallDisplay";
import {
  AT_LADDER_GRID,
  AT_LADDER_PANEL_BG,
  AT_LADDER_ROW_H,
  AT_LADDER_STRIKE_BG,
  AT_LADDER_STRIKE_COL_W,
  AT_LADDER_THIN_SEP,
  AT_SPOT_PILL_TEXT,
} from "@/lib/active-trader/atLadderLayout";
import type { LadderHeatCellView } from "@/lib/active-trader/atLadderVolumeHeatEngine";
import type { AtLadderMode, AtVerticalWidth } from "@/lib/active-trader/activeTraderPrefs";
import { aggregateSpreadNBBO, verticalStrikes } from "@/lib/active-trader/aggregateSpreadNBBO";
import { atLadderLegKey } from "@/lib/active-trader/atLadderLegKeys";
import { atLadderDisplayQuote, atLadderExecutableQuote } from "@/lib/active-trader/atLadderExecutableQuote";
import { findAtmStrikeIndex } from "@/lib/optionsSchwabKey";

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
  const rgb = side === "call" ? "16, 185, 98" : "228, 48, 62";
  const dir = side === "call" ? "90deg" : "270deg";
  if (view.intensity > 0.004) {
    const eased = Math.pow(Math.min(1, view.intensity), 0.68);
    const alpha = 0.11 + eased * 0.52;
    return {
      background: `linear-gradient(${dir}, rgba(${rgb}, ${alpha}) 0%, rgba(${rgb}, ${alpha * 0.86}) 55%, rgba(${rgb}, ${alpha * 0.68}) 100%)`,
      transition: "background 180ms ease-out",
      willChange: "background",
    };
  }
  if (view.availability === "unavailable") {
    return { background: AT_LADDER_PANEL_BG };
  }
  if (view.availability === "stale") {
    return {
      background: `rgba(${rgb}, 0.04)`,
      transition: "background 180ms ease-out",
    };
  }
  return {
    background: `rgba(${rgb}, 0.06)`,
    transition: "background 180ms ease-out",
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
  const selectColor = side === "BUY" ? UP : DOWN_TEXT;
  const selectBorder = side === "BUY" ? UP : DOWN;
  const selectFill =
    side === "BUY" ? "rgba(0, 209, 102, 0.14)" : "rgba(242, 54, 69, 0.16)";

  return (
    <button
      type="button"
      aria-label={quoteAriaLabel({ strike, type, side, tint, price, expiryLabel })}
      data-at-quote={dataAttr}
      data-at-quote-side={side}
      data-at-quote-unavailable={unavailableReason ?? undefined}
      data-at-quote-locked={locked ? "1" : undefined}
      className="relative w-full h-full flex items-center justify-center px-1 active:opacity-80"
      style={{
        fontSize: 14,
        fontWeight: 500,
        fontVariantNumeric: "tabular-nums",
        color: WHITE,
        background: "transparent",
        borderLeft: dividerLeft ? `1px solid ${AT_LADDER_THIN_SEP}` : "none",
        borderTop: "none",
        borderRight: "none",
        borderBottom: "none",
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
          data-at-selected-leg-chip={side}
          className="inline-flex flex-col items-center justify-center"
          style={{
            minWidth: 52,
            padding: "1px 7px 2px",
            borderRadius: 5,
            border: `1px solid ${selectBorder}`,
            background: selectFill,
            lineHeight: 1.04,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: WHITE }}>
            {unavailableReason ?? fmtPx(price)}
          </span>
          <span
            style={{
              fontSize: 8,
              fontWeight: 700,
              color: selectColor,
              letterSpacing: "0.04em",
              marginTop: 1,
            }}
          >
            {side}
          </span>
        </span>
      ) : (
        <span
          style={
            unavailableReason
              ? { fontSize: 9, fontWeight: 500, color: GRAY, letterSpacing: "0.02em" }
              : { color: WHITE }
          }
        >
          {unavailableReason ?? fmtPx(price)}
        </span>
      )}
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
      data-at-quote-heat-intensity={view.intensity.toFixed(3)}
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
  spotRow: boolean;
  gammaFlipRow: boolean;
  onQuoteTap: LadderBodyProps["onQuoteTap"];
  positionQtyByKey: Map<string, number>;
  workingOrderChips?: Map<string, string>;
  heatByKey: Record<string, LadderHeatCellView>;
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
  spotRow,
  gammaFlipRow,
  onQuoteTap,
  positionQtyByKey,
  workingOrderChips,
  heatByKey,
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
    borderBottom: `1px solid ${AT_LADDER_THIN_SEP}`,
    fontFamily: MONO,
    position: "relative",
    borderRadius: gammaFlipRow ? 4 : undefined,
    background: keepawayForbidden ? "rgba(255,255,255,0.03)" : AT_LADDER_PANEL_BG,
    boxShadow: gammaFlipRow
      ? `inset 0 0 0 1px ${GAMMA_SCENARIO}`
      : isSelected && !zoneTag && !spotRow
        ? `inset 0 0 0 1px ${accentHex}40`
        : undefined,
    zIndex: gammaFlipRow ? 2 : undefined,
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

  const strikeBorder = spotRow
    ? "none"
    : zoneTag === "CALL WALL"
      ? `1px solid ${GOLD}`
      : zoneTag === "PUT WALL"
        ? `1px solid ${PUT_WALL}`
        : "none";

  return (
    <div
      className="grid items-stretch w-full"
      style={rowStyle}
      data-at-ladder-row={row.strike}
      data-at-gamma-flip-row={gammaFlipRow ? "1" : undefined}
    >
      <QuoteHeatPair
        side="call"
        view={callHeat}
        bid={
          <QuoteCell
            price={callBidPx}
            unavailableReason={callBidReason}
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
        className="relative flex items-center justify-center h-full"
        style={{
          width: AT_LADDER_STRIKE_COL_W,
          background: AT_LADDER_STRIKE_BG,
          borderLeft: `1px solid ${AT_LADDER_THIN_SEP}`,
          borderRight: `1px solid ${AT_LADDER_THIN_SEP}`,
          padding: spotRow || zoneTag === "CALL WALL" || zoneTag === "PUT WALL" ? "3px 4px" : 0,
          boxSizing: "border-box",
          fontVariantNumeric: "tabular-nums",
        }}
        data-at-strike={row.strike}
      >
        {renderBadges(row.call?.streamKey ?? row.put?.streamKey)}
        <div
          className="w-full h-full flex flex-col items-center justify-center"
          style={{
            background: spotRow ? GOLD : "transparent",
            color: spotRow ? AT_SPOT_PILL_TEXT : WHITE,
            borderRadius: spotRow || zoneTag === "CALL WALL" || zoneTag === "PUT WALL" ? 4 : 0,
            border: strikeBorder,
            fontSize: 15,
            fontWeight: spotRow ? 700 : 500,
            lineHeight: 1.05,
          }}
        >
          <span>{row.strike % 1 === 0 ? row.strike : row.strike.toFixed(1)}</span>
          {strikePositionQty != null && (
            <span
              data-at-position-badge
              className="leading-none"
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "1px 5px",
                borderRadius: 999,
                color: AT_SPOT_PILL_TEXT,
                background: strikePositionQty > 0 ? UP : DOWN,
                marginTop: 1,
              }}
            >
              {strikePositionQty > 0 ? "+" : "−"}
              {Math.abs(strikePositionQty)}
            </span>
          )}
          {gammaFlipRow ? (
            <span
              data-at-strike-zone-tag
              data-at-strike-gamma-flip
              style={{
                fontSize: 8,
                fontWeight: 600,
                lineHeight: 1.05,
                marginTop: 1,
                color: spotRow ? AT_SPOT_PILL_TEXT : GAMMA_SCENARIO,
                whiteSpace: "nowrap",
              }}
            >
              Gamma flip
            </span>
          ) : zoneTag === "CALL WALL" || zoneTag === "PUT WALL" ? (
            <span
              data-at-strike-zone-tag
              data-at-strike-wall={zoneTag === "CALL WALL" ? "call" : "put"}
              style={{
                fontSize: 8,
                fontWeight: 600,
                lineHeight: 1.05,
                marginTop: 1,
                color: spotRow ? AT_SPOT_PILL_TEXT : zoneTag === "CALL WALL" ? GOLD : PUT_WALL,
                whiteSpace: "nowrap",
              }}
            >
              {zoneTag === "CALL WALL" ? "Call wall" : "Put wall"}
            </span>
          ) : zoneTag ? (
            <span
              data-at-strike-zone-tag
              style={{
                fontSize: 8,
                lineHeight: 1.05,
                marginTop: 1,
                opacity: 0.75,
                whiteSpace: "nowrap",
              }}
            >
              {zoneTag}
            </span>
          ) : null}
        </div>
      </div>
      <QuoteHeatPair
        side="put"
        view={putHeat}
        bid={
          <QuoteCell
            price={putBidPx}
            unavailableReason={putBidReason}
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
  );
});

function resolveNearestStrikeInBand(
  strikes: readonly number[],
  target: number | null | undefined,
): number | null {
  if (target == null || !Number.isFinite(target) || strikes.length === 0) return null;
  const idx = findAtmStrikeIndex([...strikes], target);
  if (idx < 0) return null;
  const nearest = strikes[idx]!;
  if (strikes.length < 2) return nearest;
  let minStep = Infinity;
  for (let i = 1; i < strikes.length; i++) {
    const d = Math.abs(strikes[i]! - strikes[i - 1]!);
    if (d > 0 && d < minStep) minStep = d;
  }
  const tolerance = Number.isFinite(minStep) ? minStep * 0.75 : 5;
  return Math.abs(nearest - target) <= tolerance ? nearest : null;
}

export const LadderBody = memo(function LadderBody(props: LadderBodyProps) {
  const rowHeight = props.rowHeight ?? AT_LADDER_ROW_H;

  const strikes = useMemo(() => props.rows.map((r) => r.strike), [props.rows]);
  const spotStrike = useMemo(() => {
    if (props.underlyingPrice == null || strikes.length === 0) return null;
    const idx = findAtmStrikeIndex(strikes, props.underlyingPrice);
    return idx >= 0 ? strikes[idx]! : null;
  }, [strikes, props.underlyingPrice]);

  const gammaFlipStrike = useMemo(
    () => resolveNearestStrikeInBand(strikes, props.zones.flip),
    [strikes, props.zones.flip],
  );

  return (
    <div style={{ background: AT_LADDER_PANEL_BG }}>
      {props.rows.map((row) => (
        <LadderRowView
          key={row.strike}
          row={row}
          accentHex={props.accentHex}
          zones={props.zones}
          isSelected={props.selectedStrike === row.strike}
          spotRow={spotStrike === row.strike}
          gammaFlipRow={gammaFlipStrike === row.strike}
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
      ))}
    </div>
  );
});
