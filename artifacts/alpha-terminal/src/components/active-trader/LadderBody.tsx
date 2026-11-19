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
  AT_LADDER_SELECT_MAX_W,
  AT_LADDER_SELECT_RADIUS,
  AT_LADDER_SELECT_SELL,
  AT_LADDER_STRIKE_BG,
  AT_LADDER_STRIKE_COL_W,
  AT_LADDER_STRIKE_SIZE,
  AT_LADDER_STRIKE_WEIGHT,
  AT_LADDER_THIN_SEP,
  AT_SPOT_PILL_TEXT,
} from "@/lib/active-trader/atLadderLayout";
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
  onVerticalTap: (payload: {
    anchorStrike: number;
    farStrike: number;
    type: "CALL" | "PUT";
    side: "BUY" | "SELL";
    nearContract: OptionsContract;
  }) => void;
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

/** Finger travel past this many CSS px turns a press into a scroll and drops it. */
export const AT_TAP_SLOP_PX = 8;
/** A click that follows a handled pointer gesture within this window is the same tap. */
const CLICK_AFTER_POINTER_MS = 700;
/**
 * A touch while the ladder is still moving (momentum, Recenter, a nudge) stops
 * the scroll; it does not pick whatever cell happens to be passing under the finger.
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

/** Re-export heat bounds so tests can assert volume-only coloring. */
export { AT_HEAT_WASH_ALPHA, AT_HEAT_MAX_ALPHA };

/** Near-black rest tone. Volume walks this toward HEAT_BRIGHT. */
const HEAT_DEEP = {
  call: [4, 8, 6],
  put: [12, 5, 5],
} as const;
const HEAT_BRIGHT = {
  call: [6, 148, 64],
  put: [184, 30, 40],
} as const;

function heatTone(intensity: number): number {
  return Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0;
}

/** Keeps a light print close to black and saves the bright end for heavy volume. */
function heatLift(intensity: number): number {
  return Math.pow(heatTone(intensity), 1.2);
}

function mixHeatRgb(side: "call" | "put", lift: number): string {
  const deep = HEAT_DEEP[side];
  const bright = HEAT_BRIGHT[side];
  const t = Math.min(1, Math.max(0, lift));
  const r = Math.round(deep[0] + (bright[0] - deep[0]) * t);
  const g = Math.round(deep[1] + (bright[1] - deep[1]) * t);
  const b = Math.round(deep[2] + (bright[2] - deep[2]) * t);
  return `${r}, ${g}, ${b}`;
}

/** Alpha of a pair's heat colour for a 0-1 intensity. Zero volume stays transparent. */
export function atHeatAlpha(intensity: number): number {
  const t = heatTone(intensity);
  if (t <= 0) return 0;
  const presence = 0.7 + 0.3 * t;
  return AT_HEAT_WASH_ALPHA + (AT_HEAT_MAX_ALPHA - AT_HEAT_WASH_ALPHA) * presence;
}

function heatPairStyle(view: LadderHeatCellView, side: "call" | "put"): CSSProperties {
  const t = heatTone(view.intensity);
  const alpha = atHeatAlpha(t);
  if (alpha <= 0) {
    return {
      backgroundColor: "transparent",
      backgroundImage: "none",
      boxShadow: "none",
      animation: "none",
    };
  }
  const lift = heatLift(t);
  const rest = mixHeatRgb(side, lift);
  const peak = mixHeatRgb(side, Math.min(1, lift + 0.16 + 0.12 * t));
  const restAlpha = alpha.toFixed(3);
  const peakAlpha = Math.min(1, alpha + 0.06).toFixed(3);
  const restGlow = (0.04 + 0.22 * t).toFixed(3);
  const peakGlow = (0.2 + 0.55 * t).toFixed(3);
  const bright = HEAT_BRIGHT[side].join(", ");
  const seconds = (2.6 - t * 0.9).toFixed(2);
  return {
    backgroundColor: `rgba(${rest}, ${restAlpha})`,
    backgroundImage: "none",
    boxShadow: `inset 0 0 ${Math.round(6 + 10 * t)}px rgba(${bright}, ${restGlow})`,
    ["--at-heat-rest" as string]: `rgba(${rest}, ${restAlpha})`,
    ["--at-heat-peak" as string]: `rgba(${peak}, ${peakAlpha})`,
    ["--at-heat-glow-rest" as string]: `inset 0 0 ${Math.round(6 + 10 * t)}px rgba(${bright}, ${restGlow})`,
    ["--at-heat-glow-peak" as string]: `inset 0 0 ${Math.round(16 + 22 * t)}px rgba(${bright}, ${peakGlow})`,
    animation: `at-heat-breathe ${seconds}s ease-in-out infinite`,
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
        padding: 0,
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        WebkitTouchCallout: "none",
        userSelect: "none",
        opacity: dimmed ? 0.72 : 1,
      }}
      disabled={!tapable}
    >
      {legSelected ? (
        <span
          data-at-selected-leg-chip={side}
          className="inline-flex flex-col items-center justify-center"
          style={{
            boxSizing: "border-box",
            width: `min(${AT_LADDER_SELECT_MAX_W}px, calc(100% - ${AT_LADDER_SELECT_INSET * 2}px))`,
            height: `calc(100% - ${AT_LADDER_SELECT_INSET * 2}px)`,
            margin: AT_LADDER_SELECT_INSET,
            padding: "0 2px",
            borderRadius: AT_LADDER_SELECT_RADIUS,
            border: `1px solid ${selectBorder}`,
            background: pressed ? pressWash : "transparent",
            lineHeight: 1.05,
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              fontSize: AT_LADDER_PRICE_SIZE,
              fontWeight: AT_LADDER_PRICE_WEIGHT,
              color: AT_LADDER_PRICE_COLOR,
            }}
          >
            {unavailableReason ?? fmtPx(price)}
          </span>
          {statusReason ? (
            <span style={{ fontSize: 7, color: GRAY, letterSpacing: "0.03em" }}>
              {statusReason}
            </span>
          ) : null}
          <span
            style={{
              fontSize: AT_LADDER_LEG_TAG_SIZE,
              fontWeight: 700,
              color: selectColor,
              letterSpacing: "0.06em",
              marginTop: 1,
              textTransform: "uppercase",
            }}
          >
            {side}
          </span>
        </span>
      ) : (
        <span
          className="inline-flex flex-col items-center justify-center"
          style={
            pressed
              ? {
                  boxSizing: "border-box",
                  width: `min(${AT_LADDER_SELECT_MAX_W}px, calc(100% - ${AT_LADDER_SELECT_INSET * 2}px))`,
                  height: `calc(100% - ${AT_LADDER_SELECT_INSET * 2}px)`,
                  margin: AT_LADDER_SELECT_INSET,
                  borderRadius: AT_LADDER_SELECT_RADIUS,
                  border: `1px solid ${selectBorder}`,
                  background: pressWash,
                  pointerEvents: "none",
                }
              : unavailableReason
                ? {
                    fontSize: 9,
                    fontWeight: 500,
                    color: GRAY,
                    letterSpacing: "0.02em",
                    pointerEvents: "none",
                    padding: "0 4px",
                  }
                : { color: AT_LADDER_PRICE_COLOR, pointerEvents: "none", padding: "0 4px" }
          }
        >
          {unavailableReason ?? fmtPx(price)}
          {statusReason ? (
            <span style={{ fontSize: 7, color: GRAY, letterSpacing: "0.03em", lineHeight: 1 }}>
              {statusReason}
            </span>
          ) : null}
        </span>
      )}
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
 * Bid + ask cells of one contract over their shared heat shade. Subscribes to
 * that contract's quote and heat only, so a tick here never touches another
 * strike, the row, or the ladder.
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
  const farHeat = useAtLadderHeatCell(heat, vertical ? far?.streamKey : null);

  let bidPx = near.bid;
  let askPx = near.ask;
  let heatView = nearHeat;
  if (vertical) {
    const spread = aggregateSpreadNBBO(
      { bid: near.bid, ask: near.ask },
      { bid: farQuote.bid, ask: farQuote.ask },
    );
    bidPx = spread.bid;
    askPx = spread.ask;
    if (contract?.streamKey && far?.streamKey) {
      heatView = {
        availability: nearHeat.availability,
        contracts30s: nearHeat.contracts30s + farHeat.contracts30s,
        intensity: Math.max(nearHeat.intensity, farHeat.intensity),
      };
    }
  }

  const legKey = contract ? atLadderLegKey(contract, type) : null;
  const bidTapable = vertical ? bidPx != null : near.bidTapable;
  const askTapable = vertical ? askPx != null : near.askTapable;

  return (
    <div
      className="relative grid h-full min-w-0"
      style={{
        gridColumn: "span 2",
        gridTemplateColumns: "1fr 1fr",
        ...heatPairStyle(heatView, pairSide),
      }}
      data-at-quote-heat={pairSide}
      data-at-quote-heat-state={heatView.availability}
      data-at-quote-heat-intensity={heatView.intensity.toFixed(3)}
      data-at-quote-heat-contracts={heatView.contracts30s}
    >
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

function StrikeSideTag({
  marker,
  color,
  lines,
}: {
  marker: "gamma-flip" | "call-wall" | "put-wall";
  color: string;
  lines: readonly [string, string];
}) {
  return (
    <div
      data-at-strike-zone-tag
      data-at-strike-gamma-flip={marker === "gamma-flip" ? "" : undefined}
      data-at-strike-call-wall={marker === "call-wall" ? "" : undefined}
      data-at-strike-put-wall={marker === "put-wall" ? "" : undefined}
      className="pointer-events-none absolute z-[4]"
      style={{
        left: 0,
        top: "50%",
        transform: "translateY(-50%)",
        color,
        fontSize: 7,
        fontWeight: 700,
        lineHeight: 1.05,
        letterSpacing: "0.03em",
        textAlign: "left",
      }}
    >
      {lines[0]}
      <br />
      {lines[1]}
    </div>
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
  positionQty: number | null;
  workChip?: string;
  heat: AtLadderHeatStore;
  selection: AtLadderSelectionStore;
  rowHeight: number;
  chainQuoteTs: number;
  clockMinute: number;
  expiryLabel: string;
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
  positionQty,
  workChip,
  heat,
  selection,
  rowHeight,
  chainQuoteTs,
  clockMinute,
  expiryLabel,
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
    zIndex: gammaFlipRow || callWallRow || putWallRow ? 2 : undefined,
  };

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
      {gammaFlipRow ? (
        <span
          aria-hidden
          data-at-gamma-flip-outline=""
          className="pointer-events-none absolute z-[3]"
          style={{ inset: 3, border: `1px solid ${AT_LADDER_GAMMA}`, borderRadius: 4 }}
        />
      ) : null}
      {callWallRow ? (
        <span
          aria-hidden
          data-at-call-wall-outline=""
          className="pointer-events-none absolute z-[3]"
          style={{ inset: 3, border: `1px solid ${GOLD}`, borderRadius: 4 }}
        />
      ) : null}
      {putWallRow ? (
        <span
          aria-hidden
          data-at-put-wall-outline=""
          className="pointer-events-none absolute z-[3]"
          style={{ inset: 3, border: `1px solid ${PUT_WALL}`, borderRadius: 4 }}
        />
      ) : null}
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
          padding: 0,
          boxSizing: "border-box",
          fontVariantNumeric: "tabular-nums",
          background: spotRow ? GOLD : AT_LADDER_STRIKE_BG,
        }}
        data-at-strike={row.strike}
      >
        {workChip ? (
          <div className="absolute top-0.5 right-0.5 flex gap-px">
            <span className="px-0.5 rounded border" style={{ fontSize: 7, color: GRAY, borderColor: BORDER }}>
              {workChip}
            </span>
          </div>
        ) : null}
        {gammaFlipRow ? (
          <StrikeSideTag marker="gamma-flip" color={spotRow ? AT_SPOT_PILL_TEXT : AT_LADDER_GAMMA} lines={["GAMMA", "FLIP"]} />
        ) : null}
        {callWallRow && !gammaFlipRow ? (
          <StrikeSideTag marker="call-wall" color={spotRow ? AT_SPOT_PILL_TEXT : GOLD} lines={["CALL", "WALL"]} />
        ) : null}
        {putWallRow && !gammaFlipRow && !callWallRow ? (
          <StrikeSideTag marker="put-wall" color={spotRow ? AT_SPOT_PILL_TEXT : PUT_WALL} lines={["PUT", "WALL"]} />
        ) : null}
        <div
          className="w-full h-full flex flex-col items-center justify-center"
          style={{
            background: "transparent",
            color: spotRow ? AT_SPOT_PILL_TEXT : WHITE,
            borderRadius: 0,
            border: "none",
            fontSize: AT_LADDER_STRIKE_SIZE,
            fontWeight: spotRow ? 500 : AT_LADDER_STRIKE_WEIGHT,
            lineHeight: 1.05,
            letterSpacing: spotRow ? "-0.02em" : "0.01em",
          }}
        >
          <span>{row.strike % 1 === 0 ? row.strike : row.strike.toFixed(1)}</span>
          {positionQty != null && (
            <span
              data-at-position-badge
              className="leading-none"
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "1px 5px",
                borderRadius: 999,
                color: AT_SPOT_PILL_TEXT,
                background: positionQty > 0 ? UP : DOWN,
                marginTop: 1,
              }}
            >
              {positionQty > 0 ? "+" : "−"}
              {Math.abs(positionQty)}
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
  const { rows, selection, onQuoteTap, onVerticalTap, ladderMode, verticalWidth, rowByStrike } = props;
  const vertical = ladderMode === "vertical";
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

  const latest = useRef({ cellTargets, onQuoteTap, onVerticalTap, vertical, verticalWidth });
  latest.current = { cellTargets, onQuoteTap, onVerticalTap, vertical, verticalWidth };
  const gestureRef = useRef<PressGesture | null>(null);
  const lastPointerHandledAtRef = useRef(-Infinity);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastScrollAtRef = useRef(-Infinity);

  useEffect(() => {
    const scroller = bodyRef.current?.closest<HTMLElement>("[data-at-ladder-scroll]");
    if (!scroller) return;
    const onScroll = () => {
      lastScrollAtRef.current = performance.now();
      // The row moved out from under the finger: this is a scroll, not a press.
      gestureRef.current?.release();
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  const commitCell = useCallback((cellKey: string) => {
    const cur = latest.current;
    const target = cur.cellTargets.get(cellKey);
    if (!target) return;
    if (cur.vertical) {
      cur.onVerticalTap({
        anchorStrike: target.strike,
        farStrike: verticalStrikes(target.strike, cur.verticalWidth, target.type).far,
        type: target.type,
        side: target.side,
        nearContract: target.contract,
      });
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
      if (performance.now() - lastScrollAtRef.current < AT_TAP_AFTER_SCROLL_MS) return;
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
        if (ev.pointerId === pointerId) end(false);
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
      if (performance.now() - lastPointerHandledAtRef.current < CLICK_AFTER_POINTER_MS) return;
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
        let positionQty: number | null = null;
        for (const key of [row.call?.streamKey, row.put?.streamKey]) {
          if (!key) continue;
          const q = props.positionQtyByKey.get(key);
          if (q != null && q !== 0) {
            positionQty = q;
            break;
          }
        }
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
            positionQty={positionQty}
            workChip={chipKey ? props.workingOrderChips?.get(chipKey) : undefined}
            heat={props.heat}
            selection={selection}
            rowHeight={rowHeight}
            chainQuoteTs={props.chainQuoteTs ?? 0}
            clockMinute={clockMinute}
            expiryLabel={props.expiryLabel}
          />
        );
      })}
    </div>
  );
});
