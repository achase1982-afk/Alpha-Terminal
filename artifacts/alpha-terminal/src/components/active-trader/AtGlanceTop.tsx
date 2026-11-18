import { memo, useState, type CSSProperties, type PropsWithChildren } from "react";
import {
  BG_EXP_BAR,
  BORDER,
  DOWN,
  DOWN_TEXT,
  GAMMA_SCENARIO,
  GOLD,
  GRAY,
  PUT_WALL,
  UP,
  WHITE,
} from "@/components/options/optionsTheme";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { formatGexUsd } from "@/lib/active-trader/zonesModel";
import { formatStrikeLevel } from "@/lib/active-trader/atExpiryPill";
import type { SpxKeepawayStats } from "@workspace/order-ticket-math";
import { resolveAtGlanceMode } from "@/lib/active-trader/atGlanceMode";
import { loadAtGlanceCompact, saveAtGlanceCompact } from "@/lib/active-trader/atGlanceCompactState";
import { useSpotDirectionColor } from "@/lib/active-trader/atSpotDirection";
import { useThrottledNumber } from "@/lib/active-trader/useThrottledNumber";
import { useDeskFlowStream } from "@/hooks/useDeskFlowStream";
import { useQuote } from "@/hooks/useQuote";
import { useGlanceSpotPrice } from "@/hooks/useGlanceSpotPrice";
import { formatGlanceMoneyRow } from "@/lib/active-trader/deskFlowGlanceCopy";
import { formatAtGlanceSpot } from "@/lib/active-trader/atGlanceSpotFormat";

const NUM_FEAT: CSSProperties = {
  fontFeatureSettings: '"tnum" 1, "ss01" 1, "cv09" 1',
  fontVariantNumeric: "tabular-nums",
};

const SPOT_PAINT_MS = 250;
const MAX_GLANCE_PX = 191;

function MoneyRow({ agg }: { agg: ReturnType<typeof useDeskFlowStream> }) {
  const [detailOn, setDetailOn] = useState(true);
  const copy = formatGlanceMoneyRow(agg);
  if (copy.unsupported) {
    return (
      <Pane className="num truncate" style={{ ...NUM_FEAT, fontSize: 10, fontWeight: 500, color: GRAY, lineHeight: 1.2 }}>
        {copy.line1m}
      </Pane>
    );
  }
  if (copy.noPrints) {
    return (
      <Pane
        className="num flex items-center gap-1.5"
        data-at-glance-flow="no-prints"
        style={{ ...NUM_FEAT, fontSize: 10, fontWeight: 500, color: GRAY, lineHeight: 1.2 }}
      >
        <span style={{ color: WHITE }}>—</span>
        <span style={{ fontSize: 9, fontWeight: 400 }}>no prints</span>
      </Pane>
    );
  }
  if (!copy.line1m) return null;
  return (
    <Pane style={{ lineHeight: 1.15 }}>
      <button
        type="button"
        className="num w-full text-left truncate"
        data-at-glance-flow="live"
        onClick={() => setDetailOn((v) => !v)}
        style={{ ...NUM_FEAT, fontSize: 10, fontWeight: 500, color: WHITE }}
      >
        <span style={{ color: GRAY, fontSize: 9, fontWeight: 400, marginRight: 4 }}>1m</span>
        {copy.line1m}
        <span style={{ color: GRAY, fontSize: 8, marginLeft: 6 }}>{detailOn ? "▴" : "▾"}</span>
      </button>
      {detailOn && copy.lineDetail ? (
        <Pane
          className="num truncate pt-0.5"
          data-at-glance-flow-detail
          style={{ ...NUM_FEAT, fontSize: 9, fontWeight: 500, color: GRAY }}
        >
          {copy.lineDetail}
        </Pane>
      ) : null}
    </Pane>
  );
}

export type AtGlanceTopProps = {
  symbol: string;
  underlyingPrice: number | null;
  zones: ZoneModel;
  keepawayPutLine?: number | null;
  keepawayCallLine?: number | null;
  keepawayStats?: SpxKeepawayStats | null;
  sessionOpen?: number | null;
  embedded?: boolean;
};

export const AtGlanceTop = memo(function AtGlanceTop({
  symbol,
  underlyingPrice,
  zones,
  keepawayPutLine: _keepawayPutLine,
  keepawayCallLine: _keepawayCallLine,
  keepawayStats: _keepawayStats,
  sessionOpen,
}: AtGlanceTopProps) {
  const [compact, setCompact] = useState(() => loadAtGlanceCompact());
  const mode = resolveAtGlanceMode(symbol);
  const { data: quote } = useQuote(symbol);
  const flow = useDeskFlowStream(symbol, true);
  const liveSpot = useGlanceSpotPrice(symbol, underlyingPrice, flow.livePx);
  const spotShown = useThrottledNumber(liveSpot, SPOT_PAINT_MS);
  const spotColor = useSpotDirectionColor(liveSpot, SPOT_PAINT_MS);
  const flowCopy = formatGlanceMoneyRow(flow);
  const spotLabel = formatAtGlanceSpot(symbol, spotShown);

  const open = sessionOpen ?? quote?.close ?? null;
  const fromOpen =
    quote?.change != null && Number.isFinite(quote.change)
      ? quote.change
      : spotShown != null && open != null && Number.isFinite(open)
        ? spotShown - open
        : null;

  const gexStr = mode === "futures" ? null : `GEX ${formatGexUsd(zones.netGexUsdPer1Pct)}`;
  const showWalls = mode !== "futures" || zones.putWall != null || zones.callWall != null;

  const toggleCompact = () => {
    setCompact((c) => {
      const n = !c;
      saveAtGlanceCompact(n);
      return n;
    });
  };

  const compactFlow =
    flowCopy.unsupported
      ? flowCopy.line1m
      : flowCopy.noPrints
        ? "no prints"
        : flowCopy.line1m;

  if (compact) {
    return (
      <button
        type="button"
        data-at-glance-top
        className="at-glance w-full px-2 py-1 text-left shrink-0"
        style={{ background: BG_EXP_BAR, borderBottom: `1px solid ${BORDER}`, maxHeight: MAX_GLANCE_PX }}
        onClick={toggleCompact}
      >
        <div className="flex items-center justify-between gap-1 num" style={NUM_FEAT}>
          <span style={{ fontSize: 12, fontWeight: 500, color: fromOpen != null && fromOpen < 0 ? DOWN_TEXT : UP }}>
            {fromOpen != null ? `${fromOpen >= 0 ? "▲" : "▼"}${Math.abs(fromOpen).toFixed(mode === "stock" ? 2 : 2)}` : "—"}
          </span>
          <span style={{ fontSize: 26, fontWeight: 600, color: spotColor }}>
            {spotLabel}
          </span>
          <span style={{ fontSize: 10, color: flowCopy.noPrints && !flowCopy.unsupported ? GRAY : WHITE, fontWeight: 400 }}>
            {flowCopy.noPrints && !flowCopy.unsupported ? "—" : compactFlow ?? "—"}
          </span>
        </div>
      </button>
    );
  }

  return (
    <Pane
      data-at-glance-top
      className="at-glance px-2 py-0.5 shrink-0"
      style={{ background: BG_EXP_BAR, borderBottom: `1px solid ${BORDER}`, maxHeight: `min(${MAX_GLANCE_PX}px, 20vh)` }}
    >
      {mode !== "futures" ? (
        <Pane className="flex items-center gap-1.5" style={{ minHeight: 16 }}>
          <Pane
            className="num shrink-0"
            style={{
              ...NUM_FEAT,
              fontSize: 11,
              fontWeight: 500,
              color: fromOpen != null && fromOpen < 0 ? DOWN_TEXT : fromOpen != null && fromOpen > 0 ? UP : WHITE,
            }}
          >
            {fromOpen != null ? (
              <>
                {fromOpen >= 0 ? "▲" : "▼"}
                {Math.abs(fromOpen).toFixed(2)}
                <span style={{ fontSize: 9, fontWeight: 400, color: GRAY, marginLeft: 4 }}>OPEN</span>
              </>
            ) : (
              "—"
            )}
          </Pane>
          <Pane className="num flex-1 text-center truncate" style={{ ...NUM_FEAT, fontSize: 10, fontWeight: 500, color: WHITE }}>
            {gexStr}
          </Pane>
          {zones.flip != null ? (
            <Pane className="num shrink-0" style={{ ...NUM_FEAT, fontSize: 10, fontWeight: 500, color: GAMMA_SCENARIO }}>
              FLIP {formatStrikeLevel(Math.round(zones.flip))}
            </Pane>
          ) : null}
          <button type="button" onClick={toggleCompact} className="shrink-0 px-0.5" style={{ fontSize: 9, color: GRAY }} aria-label="Collapse glance strip">
            −
          </button>
        </Pane>
      ) : (
        <Pane className="flex items-center justify-end" style={{ minHeight: 14 }}>
          <button type="button" onClick={toggleCompact} className="shrink-0 px-0.5" style={{ fontSize: 9, color: GRAY }} aria-label="Collapse glance strip">
            −
          </button>
        </Pane>
      )}

      <Pane
        className="grid gap-x-1 items-end"
        style={{
          gridTemplateColumns: showWalls ? "1fr auto 1fr" : "1fr",
          minHeight: 36,
        }}
      >
        {showWalls ? (
          <Pane className="num" style={{ ...NUM_FEAT, fontSize: 20, fontWeight: 500, color: PUT_WALL, lineHeight: 1 }}>
            {zones.putWall != null ? formatStrikeLevel(zones.putWall) : "—"}
          </Pane>
        ) : null}
        <Pane className="text-center px-0.5" style={showWalls ? undefined : { gridColumn: "1 / -1" }}>
          <Pane style={{ fontSize: 8, fontWeight: 400, letterSpacing: "0.05em", color: GRAY }}>
            {symbol.replace(/^\$/, "")}
          </Pane>
          <Pane className="num" style={{ ...NUM_FEAT, fontSize: 28, fontWeight: 600, color: spotColor, lineHeight: 1 }}>
            {spotLabel}
          </Pane>
        </Pane>
        {showWalls ? (
          <Pane className="num text-right" style={{ ...NUM_FEAT, fontSize: 20, fontWeight: 500, color: GOLD, lineHeight: 1 }}>
            {zones.callWall != null ? formatStrikeLevel(zones.callWall) : "—"}
          </Pane>
        ) : null}
      </Pane>

      <MoneyRow agg={flow} />
    </Pane>
  );
});

function Pane(
  props: PropsWithChildren<{ className?: string; style?: CSSProperties; onClick?: () => void }> &
    Record<string, unknown>,
) {
  const { className, style, onClick, children, ...rest } = props;
  return (
    <div className={className} style={style} onClick={onClick} role={onClick ? "presentation" : undefined} {...rest}>
      {children}
    </div>
  );
}