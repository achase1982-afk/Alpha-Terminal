import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { OptionsContract } from "@/components/OptionsTab";
import {
  BORDER,
  GOLD,
  PUT_WALL,
  UP,
  DOWN,
  GRAY,
  WHITE,
} from "@/components/options/optionsTheme";
import { ladderStrikeZoneTag } from "@/lib/active-trader/atGlanceWallDisplay";
import type { AtStrategyBuild } from "@/lib/active-trader/activeTraderPrefs";
import {
  AT_HEAT_MAX_ALPHA,
  AT_HEAT_WASH_ALPHA,
  AT_LADDER_GRID,
  AT_LADDER_GAMMA,
  AT_LADDER_GUTTER_X,
  AT_LADDER_LEG_TAG_SIZE,
  AT_LADDER_PANEL_BG,
  AT_LADDER_PRICE_COLOR,
  AT_LADDER_PRICE_SIZE,
  AT_LADDER_PRICE_WEIGHT,
  AT_LADDER_ROW_H,
  AT_LADDER_SELECT_BUY,
  AT_LADDER_SELECT_INSET,
  AT_LADDER_SELECT_RADIUS,
  AT_LADDER_SELECT_SELL,
  AT_LADDER_STRIKE_BG,
  AT_LADDER_STRIKE_COL_W,
  AT_LADDER_THIN_SEP,
  AT_SPOT_PILL,
  AT_SPOT_PILL_TEXT,
} from "@/lib/active-trader/atLadderLayout";
import {
  STRIKE_COL_PAD_X,
  STRIKE_RAIL_LETTER_SPACING,
  STRIKE_RAIL_LINE_HEIGHT,
  STRIKE_COL_SPOT_FONT_EXTRA_PX,
  strikeRailFontSize,
  strikeRailFontWeight,
} from "@/lib/options/strikeColumnChrome";
import type { LadderHeatCellView } from "@/lib/active-trader/atLadderVolumeHeatEngine";
import { useAtLadderHeatCell, type AtLadderHeatStore } from "@/lib/active-trader/atLadderHeatStore";
import type { AtLadderMode, AtVerticalWidth } from "@/lib/active-trader/activeTraderPrefs";
import { aggregateSpreadNBBO, verticalStrikes } from "@/lib/active-trader/aggregateSpreadNBBO";
import { atLadderLegKey, atLadderQuoteCellKey } from "@/lib/active-trader/atLadderLegKeys";
import {
  AT_CELL_PRESSED,
  AT_CELL_SELECTED,
  atSelectionPress,
  useAtLadderCellFlags,
  type AtLadderSelectionStore,
} from "@/lib/active-trader/atLadderSelection";
import { useAtLadderQuote, useMinuteClock } from "@/lib/active-trader/useAtLadderQuote";
import { findAtmStrikeIndex } from "@/lib/optionsSchwabKey";

export interface LadderRowModel {
  strike: number;
  call: OptionsContract | null;
  put: OptionsContract | null;
}

interface LadderBodyProps {
  rows: LadderRowModel[];
  accentHex: string;
  /** Strike nearest the underlying; gets the yellow pill. */
  spotStrike: number | null;
  /** Gamma flip level. The nearest loaded strike gets the purple outline. */
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
  pinStrike: number | null;
  /** Walls are from a prior expiry and roll at the open: no wall outlines. */
  wallsRolling: boolean;
  selectedStrike: number | null;
  onQuoteTap: (contract: OptionsContract, type: "CALL" | "PUT", side: "BUY" | "SELL") => void;
  positionQtyByKey: Map<string, number>;
  workingOrderChips?: Map<string, string>;
  heat: AtLadderHeatStore;
  selection: AtLadderSelectionStore;
  keepawayPutLine?: number | null;
  keepawayCallLine?: number | null;
  ladderMode: AtLadderMode;
  verticalWidth: AtVerticalWidth;
  rowByStrike: Map<number, LadderRowModel>;
  rowHeight?: number;
  /** Only an explicit strategy default replaces the picked legs. `off` selects the cell. */
  strategyBuild?: AtStrategyBuild;
  onStrategyTap?: (target: {
    contract: OptionsContract;
    type: "CALL" | "PUT";
    side: "BUY" | "SELL";
    strike: number;
  }) => void;
  onVerticalTap?: (payload: {
    anchorStrike: number;
    farStrike: number;
    type: "CALL" | "PUT";
    side: "BUY" | "SELL";
    nearContract: OptionsContract;
  }) => void;
  chainQuoteTs?: number;
  expiryLabel: string;
  /** Glance only: wall rows keep the color bar and use the same strike type as the rest. */
  plainWallStrike?: boolean;
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

/** Finger travel past this many CSS px turns a press into a scroll and drops it. */
export const AT_TAP_SLOP_PX = 8;
/** A click that follows a handled pointer gesture within this window is the same tap. */
const CLICK_AFTER_POINTER_MS = 700;
/**
 * A touch while the user's scroll is still moving (a swipe or momentum) stops
 * the scroll; it does not pick the cell passing under the finger. Recenter and
 * nudges are not this kind of scroll.
 */
export const AT_TAP_AFTER_SCROLL_MS = 120;

/**
 * Render counter for the isolation test: a quote must re-render one contract
 * pair, and a tap one cell, never a row or the ladder. Unset outside tests.
 */
export type AtLadderRenderProbe = (part: "body" | "row" | "pair" | "cell") => void;
const renderProbe = (part: "body" | "row" | "pair" | "cell") =>
  (globalThis as { __AT_LADDER_RENDER_PROBE__?: AtLadderRenderProbe }).__AT_LADDER_RENDER_PROBE__?.(part);

function fmtPx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  return n.toFixed(2);
}

/** Re-export heat bounds so existing imports keep resolving. */
export { AT_HEAT_WASH_ALPHA, AT_HEAT_MAX_ALPHA };

function heatTone(intensity: number): number {
  return Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0;
}

function mixChannel(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t);
}

/** Below this, a side is quiet and the cell stays the black of the book. */
const SALE_HEAT_MIN = 0.04;
const SALE_PANEL = [6, 7, 9] as const;
/** Deep green. Full heat stays behind the price, readable, not a neon slab. */
const SALE_BUY = [16, 92, 56] as const;
/** Deep red, the sell color of the flow strip, held back so the premium still reads. */
const SALE_SELL = [122, 36, 40] as const;
/** Size is here, but the quote rule could not call the side. */
const SALE_NEUTRAL = [48, 64, 78] as const;

export type SaleHeatKind = "buy" | "sell" | "neutral";

/**
 * Background behind one sale. `t` is 0–1 against the busiest contract on the
 * ladder. Quiet stays transparent. The curve opens early so a real print is
 * visible, and full brightness stays with the heaviest sale.
 */
export function saleHeatColor(kind: SaleHeatKind, intensity: number): string {
  const t = heatTone(intensity);
  if (t < SALE_HEAT_MIN) return "transparent";
  const u = Math.pow(t, 0.65);
  const ink = kind === "buy" ? SALE_BUY : kind === "sell" ? SALE_SELL : SALE_NEUTRAL;
  return `rgb(${mixChannel(SALE_PANEL[0], ink[0], u)}, ${mixChannel(SALE_PANEL[1], ink[1], u)}, ${mixChannel(SALE_PANEL[2], ink[2], u)})`;
}

export type SaleHeatPane = { kind: SaleHeatKind | "off"; color: string };

/**
 * Ask lights when buyers lift. Bid lights when sellers hit. Size with no side
 * lights both sales in steel so the location still reads, without inventing a direction.
 */
export function saleHeatPanes(view: LadderHeatCellView): { bid: SaleHeatPane; ask: SaleHeatPane } {
  const off = (color: string, kind: SaleHeatPane["kind"]): SaleHeatPane => ({ kind, color });
  if (view.availability === "unavailable") {
    return { bid: off("transparent", "off"), ask: off("transparent", "off") };
  }
  const buy = view.buyIntensity ?? 0;
  const sell = view.sellIntensity ?? 0;
  const neutral = view.neutralIntensity ?? 0;
  const location = buy + sell + neutral > 0.001 ? neutral : view.intensity;
  const bid = sell >= SALE_HEAT_MIN
    ? off(saleHeatColor("sell", sell), "sell")
    : off(saleHeatColor("neutral", location), location >= SALE_HEAT_MIN ? "neutral" : "off");
  const ask = buy >= SALE_HEAT_MIN
    ? off(saleHeatColor("buy", buy), "buy")
    : off(saleHeatColor("neutral", location), location >= SALE_HEAT_MIN ? "neutral" : "off");
  return { bid, ask };
}

const HEAT_PAIR_STYLE: CSSProperties = {
  backgroundColor: "transparent",
  backgroundImage: "none",
  boxShadow: "none",
  animation: "none",
};

function volumeCountLabel(view: LadderHeatCellView, neutral: boolean): string {
  if (neutral || view.availability === "unavailable") return "—";
  return `${Math.round(view.contracts30s)} contracts / 30s`;
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

type QuoteCellProps = {
  /** `atLadderQuoteCellKey`; null when the strike has no contract on this side. */
  cellKey: string | null;
  legKey: string | null;
  quoteSide: "bid" | "ask";
  side: "BUY" | "SELL";
  price: number | null;
  unavailableReason: string | null;
  statusReason: string | null;
  dimmed: boolean;
  locked: boolean;
  tapable: boolean;
  strike: number;
  type: "CALL" | "PUT";
  expiryLabel: string;
  selection: AtLadderSelectionStore;
  dataAttr: string;
  dividerLeft?: boolean;
};

/**
 * One bid or ask cell. Taps are handled once for the whole ladder (see
 * `LadderBody`); this only draws, and re-renders when its own price, press or
 * leg state changes.
 */
const QuoteCell = memo(function QuoteCell({
  cellKey,
  legKey,
  quoteSide,
  side,
  price,
  unavailableReason,
  statusReason,
  dimmed,
  locked,
  tapable,
  strike,
  type,
  expiryLabel,
  selection,
  dataAttr,
  dividerLeft,
}: QuoteCellProps) {
  renderProbe("cell");
  const flags = useAtLadderCellFlags(selection, legKey, quoteSide, cellKey);
  const legSelected = (flags & AT_CELL_SELECTED) !== 0;
  const pressed = (flags & AT_CELL_PRESSED) !== 0;

  const selectColor = side === "BUY" ? AT_LADDER_SELECT_BUY : AT_LADDER_SELECT_SELL;
  const selectBorder = selectColor;
  const pressWash = side === "BUY" ? "rgba(78, 198, 133, 0.12)" : "rgba(227, 103, 90, 0.14)";

  return (
    <button
      type="button"
      aria-label={quoteAriaLabel({ strike, type, side, tint: quoteSide, price, expiryLabel })}
      aria-pressed={legSelected}
      data-at-cell={cellKey ?? undefined}
      data-at-tapable={tapable && cellKey ? "1" : undefined}
      data-at-quote={dataAttr}
      data-at-quote-side={side}
      data-at-quote-unavailable={unavailableReason ?? statusReason ?? undefined}
      data-at-quote-locked={locked ? "1" : undefined}
      data-at-pressed={pressed ? "1" : undefined}
      data-at-leg-selected={legSelected ? side : undefined}
      className="relative w-full h-full flex items-center justify-center"
      style={{
        fontSize: AT_LADDER_PRICE_SIZE,
        fontWeight: AT_LADDER_PRICE_WEIGHT,
        fontVariantNumeric: "tabular-nums",
        color: AT_LADDER_PRICE_COLOR,
        background: "transparent",
        borderLeft: dividerLeft ? `1px solid ${AT_LADDER_THIN_SEP}` : "none",
        borderTop: "none",
        borderRight: "none",
        borderBottom: "none",
        boxSizing: "border-box",
        zIndex: 1,
        padding: 0,
        overflow: "hidden",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        WebkitTouchCallout: "none",
        userSelect: "none",
        opacity: dimmed ? 0.72 : 1,
      }}
      disabled={!tapable}
    >
      {legSelected || pressed ? (
        <span
          data-at-selected-leg-chip={legSelected ? side : undefined}
          className="absolute flex flex-col items-center justify-center"
          style={{
            top: AT_LADDER_SELECT_INSET,
            right: AT_LADDER_SELECT_INSET,
            bottom: AT_LADDER_SELECT_INSET,
            left: AT_LADDER_SELECT_INSET,
            boxSizing: "border-box",
            borderRadius: AT_LADDER_SELECT_RADIUS,
            border: `1px solid ${selectBorder}`,
            background: pressed ? pressWash : "transparent",
            lineHeight: 1,
            overflow: "hidden",
            pointerEvents: "none",
          }}
        >
          <span style={{ pointerEvents: "none" }}>{unavailableReason ?? fmtPx(price)}</span>
          {legSelected ? (
            <span
              style={{
                fontSize: AT_LADDER_LEG_TAG_SIZE,
                fontWeight: 700,
                color: selectColor,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {side}
            </span>
          ) : null}
        </span>
      ) : (
        <span
          className="inline-flex flex-col items-center justify-center"
          style={
            unavailableReason
              ? {
                  fontSize: 9,
                  fontWeight: 500,
                  color: GRAY,
                  letterSpacing: "0.02em",
                  pointerEvents: "none",
                  padding: "0 4px",
                }
              : { pointerEvents: "none", padding: "0 4px" }
          }
        >
          <span style={{ pointerEvents: "none" }}>{unavailableReason ?? fmtPx(price)}</span>
          {statusReason ? (
            <span style={{ fontSize: 7, color: GRAY, letterSpacing: "0.03em", lineHeight: 1 }}>
              {statusReason}
            </span>
          ) : null}
        </span>
      )}
      {legSelected && statusReason ? (
        <span
          style={{
            position: "absolute",
            top: 0,
            left: 1,
            right: 1,
            fontSize: 7,
            lineHeight: "8px",
            textAlign: "center",
            color: GRAY,
            letterSpacing: "0.03em",
            pointerEvents: "none",
          }}
        >
          {statusReason}
        </span>
      ) : null}
    </button>
  );
});

type ContractPairProps = {
  pairSide: "call" | "put";
  type: "CALL" | "PUT";
  strike: number;
  contract: OptionsContract | null;
  /** Wing contract for vertical mode; null in single mode. */
  far: OptionsContract | null;
  vertical: boolean;
  heat: AtLadderHeatStore;
  selection: AtLadderSelectionStore;
  chainQuoteTs: number;
  clockMinute: number;
  expiryLabel: string;
};

/**
 * Bid and ask of one contract. Buyers light the ask, sellers light the bid.
 * Subscribes to that contract's quote and heat only, so a tick here never
 * touches another strike, the row, or the ladder.
 */
const ContractPair = memo(function ContractPair({
  pairSide,
  type,
  strike,
  contract,
  far,
  vertical,
  heat,
  selection,
  chainQuoteTs,
  clockMinute,
  expiryLabel,
}: ContractPairProps) {
  renderProbe("pair");
  const near = useAtLadderQuote(contract, chainQuoteTs, clockMinute);
  const farQuote = useAtLadderQuote(vertical ? far : null, chainQuoteTs, clockMinute);
  const nearHeat = useAtLadderHeatCell(heat, contract?.streamKey);

  let bidPx = near.bid;
  let askPx = near.ask;
  // Leg prints are not executions of the spread. The spread stays neutral
  // until a feed reports volume for that exact spread.
  const heatView = vertical
    ? {
        availability: "unavailable" as const,
        contracts30s: 0,
        intensity: 0,
        buyIntensity: 0,
        sellIntensity: 0,
        neutralIntensity: 0,
      }
    : nearHeat;
  if (vertical) {
    const spread = aggregateSpreadNBBO(
      { bid: near.bid, ask: near.ask },
      { bid: farQuote.bid, ask: farQuote.ask },
    );
    bidPx = spread.bid;
    askPx = spread.ask;
  }
  const volumeText = volumeCountLabel(heatView, vertical);
  const panes = saleHeatPanes(heatView);

  const legKey = contract ? atLadderLegKey(contract, type) : null;
  const bidTapable = vertical ? bidPx != null : near.bidTapable;
  const askTapable = vertical ? askPx != null : near.askTapable;

  return (
    <div
      className="relative grid h-full min-w-0"
      style={{
        gridColumn: "span 2",
        gridTemplateColumns: "1fr 1fr",
        ...HEAT_PAIR_STYLE,
      }}
      data-at-quote-heat={pairSide}
      data-at-quote-heat-state={vertical ? "neutral" : heatView.availability}
      data-at-quote-heat-intensity={vertical ? "0.000" : heatView.intensity.toFixed(3)}
      data-at-quote-heat-contracts={vertical ? undefined : heatView.contracts30s}
      data-at-quote-heat-buy={vertical ? undefined : (heatView.buyIntensity ?? 0).toFixed(3)}
      data-at-quote-heat-sell={vertical ? undefined : (heatView.sellIntensity ?? 0).toFixed(3)}
      data-at-quote-volume={volumeText}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          pointerEvents: "none",
          zIndex: 0,
        }}
      >
        <div
          data-at-sale-heat-pane="bid"
          data-at-sale-heat={panes.bid.kind}
          style={{ backgroundColor: panes.bid.color, height: "100%" }}
        />
        <div
          data-at-sale-heat-pane="ask"
          data-at-sale-heat={panes.ask.kind}
          style={{ backgroundColor: panes.ask.color, height: "100%" }}
        />
      </div>
      <QuoteCell
        cellKey={contract ? atLadderQuoteCellKey(contract, type, "bid") : null}
        legKey={legKey}
        quoteSide="bid"
        side="SELL"
        price={bidPx}
        unavailableReason={bidPx == null ? near.reason : null}
        statusReason={bidPx != null ? near.reason : null}
        dimmed={near.dimmed}
        locked={near.locked && bidPx != null}
        tapable={bidTapable}
        strike={strike}
        type={type}
        expiryLabel={expiryLabel}
        selection={selection}
        dataAttr={`${pairSide}-bid-${strike}`}
      />
      <QuoteCell
        cellKey={contract ? atLadderQuoteCellKey(contract, type, "ask") : null}
        legKey={legKey}
        quoteSide="ask"
        side="BUY"
        price={askPx}
        unavailableReason={askPx == null ? near.reason : null}
        statusReason={askPx != null ? near.reason : null}
        dimmed={near.dimmed}
        locked={false}
        tapable={askTapable}
        strike={strike}
        type={type}
        expiryLabel={expiryLabel}
        selection={selection}
        dataAttr={`${pairSide}-ask-${strike}`}
        dividerLeft
      />
    </div>
  );
});

/** Zone copy sits on the call wing, flush to the left edge of the strike-column outline (not on the strike rail). */
function StrikeSideTag({
  marker,
  color,
  lines,
  nudge = 0,
}: {
  marker: "gamma-flip" | "call-wall" | "put-wall";
  color: string;
  lines: readonly [string, string];
  /** Vertical offset when call and put walls share the strike. */
  nudge?: number;
}) {
  return (
    <div
      data-at-strike-zone-tag
      data-at-strike-gamma-flip={marker === "gamma-flip" ? "" : undefined}
      data-at-strike-call-wall={marker === "call-wall" ? "" : undefined}
      data-at-strike-put-wall={marker === "put-wall" ? "" : undefined}
      className="pointer-events-none absolute z-[4]"
      style={{
        right: "100%",
        marginRight: 2,
        top: "50%",
        transform: nudge === 0 ? "translateY(-50%)" : `translateY(calc(-50% + ${nudge}px))`,
        color,
        fontSize: 7,
        fontWeight: 700,
        lineHeight: 1.05,
        letterSpacing: "0.03em",
        textAlign: "right",
      }}
    >
      {lines[0]}
      <br />
      {lines[1]}
    </div>
  );
}

function strikeColumnBackground(
  spotRow: boolean,
  gammaFlipRow: boolean,
  callWallRow: boolean,
  putWallRow: boolean,
): string {
  if (spotRow) return AT_SPOT_PILL;
  if (callWallRow) return GOLD;
  if (putWallRow) return PUT_WALL;
  if (gammaFlipRow) return AT_LADDER_GAMMA;
  return AT_LADDER_STRIKE_BG;
}

function strikeRailTypography(
  strike: number,
  spotRow: boolean,
  callWallRow: boolean,
  putWallRow: boolean,
  plainWall = false,
): { fontSize: number; fontWeight: number; color: string; letterSpacing: string } {
  const wallBar = !spotRow && (callWallRow || putWallRow);
  const wallEmphasis = !plainWall && wallBar;
  const emphasized = spotRow || wallEmphasis;
  const fontSize = spotRow
    ? strikeRailFontSize(strike, true)
    : wallEmphasis
      ? strikeRailFontSize(strike, false) + STRIKE_COL_SPOT_FONT_EXTRA_PX
      : strikeRailFontSize(strike, false);
  return {
    fontSize,
    fontWeight: emphasized ? strikeRailFontWeight(true) : strikeRailFontWeight(false),
    color: spotRow || wallBar ? AT_SPOT_PILL_TEXT : WHITE,
    letterSpacing: emphasized ? "-0.02em" : STRIKE_RAIL_LETTER_SPACING,
  };
}

function signedContractQty(
  qtyByKey: Map<string, number>,
  contract: OptionsContract | null | undefined,
): number | null {
  if (!contract) return null;
  const keys = [
    contract.streamKey?.trim(),
    typeof contract.schwabSymbol === "string" ? contract.schwabSymbol.trim() : "",
  ];
  for (const key of keys) {
    if (!key) continue;
    const qty = qtyByKey.get(key);
    if (qty != null && qty !== 0) return qty;
  }
  return null;
}

function PositionQtyBadge({ qty, side }: { qty: number; side: "call" | "put" }) {
  return (
    <span
      data-at-position-badge
      data-at-position-side={side}
      className="leading-none"
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: "1px 5px",
        borderRadius: 999,
        color: AT_SPOT_PILL_TEXT,
        background: qty > 0 ? UP : DOWN,
      }}
    >
      {qty > 0 ? "+" : "−"}
      {Math.abs(qty)}
    </span>
  );
}

type LadderRowViewProps = {
  row: LadderRowModel;
  callFar: OptionsContract | null;
  putFar: OptionsContract | null;
  vertical: boolean;
  accentHex: string;
  isSelected: boolean;
  spotRow: boolean;
  gammaFlipRow: boolean;
  callWallRow: boolean;
  putWallRow: boolean;
  zoneTag: string | null;
  keepawayForbidden: boolean;
  positionCallQty: number | null;
  positionPutQty: number | null;
  workChip?: string;
  heat: AtLadderHeatStore;
  selection: AtLadderSelectionStore;
  rowHeight: number;
  chainQuoteTs: number;
  clockMinute: number;
  expiryLabel: string;
  plainWallStrike: boolean;
};

/** One strike. Every prop is a primitive or a stable reference, so quotes and taps elsewhere skip it. */
const LadderRowView = memo(function LadderRowView({
  row,
  callFar,
  putFar,
  vertical,
  spotRow,
  gammaFlipRow,
  callWallRow,
  putWallRow,
  keepawayForbidden,
  positionCallQty,
  positionPutQty,
  workChip,
  heat,
  selection,
  rowHeight,
  chainQuoteTs,
  clockMinute,
  expiryLabel,
  plainWallStrike,
}: LadderRowViewProps) {
  renderProbe("row");
  const rowStyle: CSSProperties = {
    gridTemplateColumns: AT_LADDER_GRID,
    height: rowHeight,
    borderBottom: `1px solid ${AT_LADDER_THIN_SEP}`,
    position: "relative",
    background: keepawayForbidden ? "rgba(255,255,255,0.03)" : AT_LADDER_PANEL_BG,
    boxSizing: "border-box",
    paddingLeft: AT_LADDER_GUTTER_X,
    paddingRight: AT_LADDER_GUTTER_X,
  };

  const strikeBg = strikeColumnBackground(spotRow, gammaFlipRow, callWallRow, putWallRow);
  const strikeType = strikeRailTypography(row.strike, spotRow, callWallRow, putWallRow, plainWallStrike);

  return (
    <div
      className="grid items-stretch w-full"
      style={rowStyle}
      data-at-ladder-row={row.strike}
      data-at-spot-row={spotRow ? "1" : undefined}
      data-at-gamma-flip-row={gammaFlipRow ? "1" : undefined}
      data-at-call-wall-row={callWallRow ? "1" : undefined}
      data-at-put-wall-row={putWallRow ? "1" : undefined}
    >
      <ContractPair
        pairSide="call"
        type="CALL"
        strike={row.strike}
        contract={row.call}
        far={callFar}
        vertical={vertical}
        heat={heat}
        selection={selection}
        chainQuoteTs={chainQuoteTs}
        clockMinute={clockMinute}
        expiryLabel={expiryLabel}
      />
      <div
        className="relative flex items-center justify-center h-full"
        style={{
          width: AT_LADDER_STRIKE_COL_W,
          borderLeft: `1px solid ${AT_LADDER_THIN_SEP}`,
          borderRight: `1px solid ${AT_LADDER_THIN_SEP}`,
          padding: `0 ${STRIKE_COL_PAD_X}px`,
          boxSizing: "border-box",
          fontVariantNumeric: "tabular-nums",
          background: strikeBg,
        }}
        data-at-strike={row.strike}
        data-at-strike-wall-fill={callWallRow || putWallRow ? "1" : undefined}
      >
        {gammaFlipRow ? (
          <span
            aria-hidden
            data-at-gamma-flip-outline=""
            className="pointer-events-none absolute z-[1]"
            style={{
              inset: 0,
              boxSizing: "border-box",
              border: `1px solid ${AT_LADDER_GAMMA}`,
              borderRadius: 0,
            }}
          />
        ) : null}
        {callWallRow && !spotRow ? (
          <span
            aria-hidden
            data-at-call-wall-outline=""
            className="pointer-events-none absolute z-[1]"
            style={{
              inset: 0,
              boxSizing: "border-box",
              border: `1px solid ${GOLD}`,
              borderRadius: 0,
            }}
          />
        ) : null}
        {putWallRow ? (
          <span
            aria-hidden
            data-at-put-wall-outline=""
            className="pointer-events-none absolute z-[1]"
            style={{
              inset: 0,
              boxSizing: "border-box",
              border: `1px solid ${PUT_WALL}`,
              borderRadius: 0,
            }}
          />
        ) : null}
        {workChip ? (
          <div className="absolute top-0.5 right-0.5 flex gap-px z-[3]">
            <span className="px-0.5 rounded border" style={{ fontSize: 7, color: GRAY, borderColor: BORDER }}>
              {workChip}
            </span>
          </div>
        ) : null}
        {gammaFlipRow ? (
          <StrikeSideTag
            marker="gamma-flip"
            color={AT_LADDER_GAMMA}
            lines={["GAMMA", "FLIP"]}
          />
        ) : null}
        {callWallRow && !gammaFlipRow && !plainWallStrike ? (
          <StrikeSideTag
            marker="call-wall"
            color={GOLD}
            lines={["CALL", "WALL"]}
            nudge={putWallRow ? -8 : 0}
          />
        ) : null}
        {putWallRow && !gammaFlipRow && !plainWallStrike ? (
          <StrikeSideTag
            marker="put-wall"
            color={PUT_WALL}
            lines={["PUT", "WALL"]}
            nudge={callWallRow ? 8 : 0}
          />
        ) : null}
        <div
          className="relative z-[2] w-full h-full flex flex-col items-center justify-center"
          style={{
            background: "transparent",
            color: strikeType.color,
            borderRadius: 0,
            border: "none",
            fontSize: strikeType.fontSize,
            fontWeight: strikeType.fontWeight,
            lineHeight: STRIKE_RAIL_LINE_HEIGHT,
            letterSpacing: strikeType.letterSpacing,
          }}
        >
          <span style={{ whiteSpace: "nowrap" }}>
            {row.strike % 1 === 0 ? row.strike : row.strike.toFixed(1)}
          </span>
          {(positionCallQty != null || positionPutQty != null) && (
            <span className="flex items-center justify-center gap-0.5" style={{ marginTop: 1 }}>
              {positionCallQty != null ? <PositionQtyBadge qty={positionCallQty} side="call" /> : null}
              {positionPutQty != null ? <PositionQtyBadge qty={positionPutQty} side="put" /> : null}
            </span>
          )}
        </div>
      </div>
      <ContractPair
        pairSide="put"
        type="PUT"
        strike={row.strike}
        contract={row.put}
        far={putFar}
        vertical={vertical}
        heat={heat}
        selection={selection}
        chainQuoteTs={chainQuoteTs}
        clockMinute={clockMinute}
        expiryLabel={expiryLabel}
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

type CellTarget = {
  contract: OptionsContract;
  type: "CALL" | "PUT";
  side: "BUY" | "SELL";
  strike: number;
};

type PressGesture = {
  pointerId: number;
  cellKey: string;
  x: number;
  y: number;
  release: () => void;
};

export const LadderBody = memo(function LadderBody(props: LadderBodyProps) {
  renderProbe("body");
  const rowHeight = props.rowHeight ?? AT_LADDER_ROW_H;
  const { rows, selection, onQuoteTap, onStrategyTap, ladderMode, verticalWidth, rowByStrike } = props;
  const strategyBuild = props.strategyBuild ?? "off";
  const vertical = ladderMode === "vertical" && strategyBuild !== "off" && strategyBuild !== "iron-condor";
  const clockMinute = useMinuteClock();

  const strikes = useMemo(() => rows.map((r) => r.strike), [rows]);
  const gammaFlipStrike = useMemo(
    () => resolveNearestStrikeInBand(strikes, props.flip),
    [strikes, props.flip],
  );
  const callWallStrike = useMemo(
    () => (props.wallsRolling ? null : resolveNearestStrikeInBand(strikes, props.callWall)),
    [strikes, props.callWall, props.wallsRolling],
  );
  const putWallStrike = useMemo(
    () => (props.wallsRolling ? null : resolveNearestStrikeInBand(strikes, props.putWall)),
    [strikes, props.putWall, props.wallsRolling],
  );
  const zoneLevels = useMemo(
    () => ({
      gammaPinStrike: props.pinStrike,
      wallsRollLabel: props.wallsRolling ? "roll" : null,
      callWall: props.callWall,
      putWall: props.putWall,
    }),
    [props.pinStrike, props.wallsRolling, props.callWall, props.putWall],
  );

  /** Cell key -> what a tap on it means. Rebuilt only when the strike list changes. */
  const cellTargets = useMemo(() => {
    const map = new Map<string, CellTarget>();
    for (const row of rows) {
      if (row.call) {
        map.set(atLadderQuoteCellKey(row.call, "CALL", "bid"), { contract: row.call, type: "CALL", side: "SELL", strike: row.strike });
        map.set(atLadderQuoteCellKey(row.call, "CALL", "ask"), { contract: row.call, type: "CALL", side: "BUY", strike: row.strike });
      }
      if (row.put) {
        map.set(atLadderQuoteCellKey(row.put, "PUT", "bid"), { contract: row.put, type: "PUT", side: "SELL", strike: row.strike });
        map.set(atLadderQuoteCellKey(row.put, "PUT", "ask"), { contract: row.put, type: "PUT", side: "BUY", strike: row.strike });
      }
    }
    return map;
  }, [rows]);

  const latest = useRef({ cellTargets, onQuoteTap, onStrategyTap, strategyBuild });
  latest.current = { cellTargets, onQuoteTap, onStrategyTap, strategyBuild };
  const gestureRef = useRef<PressGesture | null>(null);
  const lastPointerHandledAtRef = useRef(-Infinity);
  /** A rejected or canceled pointer gesture still emits a click. Swallow that click. */
  const suppressClickRef = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastScrollAtRef = useRef(-Infinity);

  useEffect(() => {
    const scroller = bodyRef.current?.closest<HTMLElement>("[data-at-ladder-scroll]");
    if (!scroller) return;
    const onScroll = () => {
      // Recenter and nudges mark the scroller. They must not eat the next tap.
      if (scroller.dataset.atProgrammaticScroll === "1") return;
      lastScrollAtRef.current = performance.now();
      // The row moved out from under the finger: this is a scroll, not a press.
      if (gestureRef.current) {
        suppressClickRef.current = true;
        gestureRef.current.release();
      }
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  const commitCell = useCallback((cellKey: string) => {
    const cur = latest.current;
    const target = cur.cellTargets.get(cellKey);
    if (!target) return;
    // A saved vertical ladder mode is not a strategy default. Free taps stay free
    // until Strategy is set in order defaults.
    if (cur.strategyBuild !== "off") {
      cur.onStrategyTap?.(target);
      return;
    }
    cur.onQuoteTap(target.contract, target.type, target.side);
  }, []);

  /**
   * Touch -> highlight, lift -> commit. The highlight is one store write that
   * re-renders a single cell; nothing waits on quotes, the ticket or a fetch.
   * Moving past the slop (a scroll) or a browser pointercancel drops the press.
   */
  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.isPrimary === false || (e.pointerType === "mouse" && e.button !== 0)) return;
      if (performance.now() - lastScrollAtRef.current < AT_TAP_AFTER_SCROLL_MS) {
        suppressClickRef.current = true;
        lastPointerHandledAtRef.current = performance.now();
        return;
      }
      const cellEl = (e.target as HTMLElement).closest<HTMLElement>("[data-at-cell]");
      const cellKey = cellEl?.dataset.atCell;
      if (!cellEl || !cellKey || cellEl.dataset.atTapable !== "1") return;
      gestureRef.current?.release();

      const pointerId = e.pointerId;
      const end = (commit: boolean) => {
        const g = gestureRef.current;
        if (!g || g.pointerId !== pointerId) return;
        g.release();
        lastPointerHandledAtRef.current = performance.now();
        if (!commit) suppressClickRef.current = true;
        if (commit) commitCell(g.cellKey);
      };
      const onMove = (ev: PointerEvent) => {
        const g = gestureRef.current;
        if (!g || ev.pointerId !== g.pointerId) return;
        if (Math.hypot(ev.clientX - g.x, ev.clientY - g.y) > AT_TAP_SLOP_PX) end(false);
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId === pointerId) end(true);
      };
      const onCancel = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        suppressClickRef.current = true;
        end(false);
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);

      gestureRef.current = {
        pointerId,
        cellKey,
        x: e.clientX,
        y: e.clientY,
        release: () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onCancel);
          gestureRef.current = null;
          atSelectionPress(selection, null);
        },
      };
      atSelectionPress(selection, cellKey);
    },
    [commitCell, selection],
  );

  /** Keyboard and assistive-tech activation arrive as a click with no pointer gesture before it. */
  const handleClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const followUp =
        suppressClickRef.current ||
        performance.now() - lastPointerHandledAtRef.current < CLICK_AFTER_POINTER_MS;
      if (followUp) {
        suppressClickRef.current = false;
        return;
      }
      const cellEl = (e.target as HTMLElement).closest<HTMLElement>("[data-at-cell]");
      const cellKey = cellEl?.dataset.atCell;
      if (!cellEl || !cellKey || cellEl.dataset.atTapable !== "1") return;
      commitCell(cellKey);
    },
    [commitCell],
  );

  useEffect(() => () => gestureRef.current?.release(), []);

  return (
    <div
      ref={bodyRef}
      data-at-ladder-body
      className="at-ladder-num"
      style={{ background: AT_LADDER_PANEL_BG }}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    >
      {rows.map((row) => {
        const positionCallQty = signedContractQty(props.positionQtyByKey, row.call);
        const positionPutQty = signedContractQty(props.positionQtyByKey, row.put);
        const chipKey = row.call?.streamKey ?? row.put?.streamKey;
        const putKeepaway = props.keepawayPutLine != null && row.strike < props.keepawayPutLine;
        const callKeepaway = props.keepawayCallLine != null && row.strike > props.keepawayCallLine;
        return (
          <LadderRowView
            key={row.strike}
            row={row}
            callFar={
              vertical
                ? rowByStrike.get(verticalStrikes(row.strike, verticalWidth, "CALL").far)?.call ?? null
                : null
            }
            putFar={
              vertical
                ? rowByStrike.get(verticalStrikes(row.strike, verticalWidth, "PUT").far)?.put ?? null
                : null
            }
            vertical={vertical}
            accentHex={props.accentHex}
            isSelected={props.selectedStrike === row.strike}
            spotRow={props.spotStrike === row.strike}
            gammaFlipRow={gammaFlipStrike === row.strike}
            callWallRow={callWallStrike === row.strike}
            putWallRow={putWallStrike === row.strike}
            zoneTag={ladderStrikeZoneTag(zoneLevels, row.strike)}
            keepawayForbidden={putKeepaway || callKeepaway}
            positionCallQty={positionCallQty}
            positionPutQty={positionPutQty}
            workChip={chipKey ? props.workingOrderChips?.get(chipKey) : undefined}
            heat={props.heat}
            selection={selection}
            rowHeight={rowHeight}
            chainQuoteTs={props.chainQuoteTs ?? 0}
            clockMinute={clockMinute}
            expiryLabel={props.expiryLabel}
            plainWallStrike={props.plainWallStrike === true}
          />
        );
      })}
    </div>
  );
});
