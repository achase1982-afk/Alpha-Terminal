import { memo, useState, type CSSProperties, type PropsWithChildren } from "react";
import {
  BG_EXP_BAR,
  BORDER,
  DOWN_TEXT,
  GAMMA_SCENARIO,
  GOLD,
  PUT_WALL,
  UP,
  WHITE,
} from "@/components/options/optionsTheme";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { formatGexUsd } from "@/lib/active-trader/zonesModel";
import { formatStrikeLevel } from "@/lib/active-trader/atExpiryPill";
import type { SpxKeepawayStats } from "@workspace/order-ticket-math";
import { resolveAtGlanceMode } from "@/lib/active-trader/atGlanceMode";
import { useSpotDirectionColor } from "@/lib/active-trader/atSpotDirection";
import { useThrottledNumber } from "@/lib/active-trader/useThrottledNumber";
import { useDeskFlowStream } from "@/hooks/useDeskFlowStream";
import { useQuote } from "@/hooks/useQuote";
import { useGlanceSpotPrice } from "@/hooks/useGlanceSpotPrice";
import { formatGlanceMoneyRow } from "@/lib/active-trader/deskFlowGlanceCopy";
import { formatAtGlanceSpot } from "@/lib/active-trader/atGlanceSpotFormat";
import { AT_LABEL, AT_SECONDARY } from "@/lib/active-trader/atChromeContrast";

const NUM_FEAT: CSSProperties = {
  fontFeatureSettings: '"tnum" 1, "ss01" 1, "cv09" 1',
  fontVariantNumeric: "tabular-nums",
};

const SPOT_PAINT_MS = 250;
const MAX_GLANCE_PX = 191;
const FLOW_WINDOWS = ["1m", "5m", "hr"] as const;
type FlowWindow = (typeof FLOW_WINDOWS)[number];

function MoneyRow({ agg }: { agg: ReturnType<typeof useDeskFlowStream> }) {
  const [flowWindow, setFlowWindow] = useState<FlowWindow>("1m");
  const copy = formatGlanceMoneyRow(agg);
  if (copy.unsupported) {
    return (
      <Pane className="num truncate" style={{ ...NUM_FEAT, fontSize: 11, fontWeight: 500, color: AT_SECONDARY, lineHeight: 1.15 }}>
        {copy.line1m}
      </Pane>
    );
  }
  if (copy.noPrints) {
    return (
      <Pane
        className="num flex items-center gap-1.5"
        data-at-glance-flow="no-prints"
        style={{ ...NUM_FEAT, fontSize: 11, fontWeight: 500, color: AT_SECONDARY, lineHeight: 1.15 }}
      >
        <span style={{ color: WHITE }}>—</span>
        <span style={{ fontSize: 10, fontWeight: 400, color: AT_LABEL }}>no prints</span>
      </Pane>
    );
  }
  if (!copy.line1m) return null;
  const body =
    flowWindow === "1m" ? copy.line1m : flowWindow === "5m" ? copy.line5m : copy.lineHr;

  return (
    <Pane
      data-at-glance-flow="live"
      data-at-glance-flow-window={flowWindow}
      className="flex items-start gap-1.5"
      style={{ lineHeight: 1.12, overflow: "hidden", maxHeight: 52 }}
    >
      <Pane
        className="num flex-1 min-w-0"
        data-at-glance-flow-body
        style={{
          ...NUM_FEAT,
          fontSize: 11,
          fontWeight: 400,
          color: WHITE,
          lineHeight: 1.2,
          whiteSpace: "pre-line",
          wordBreak: "break-word",
        }}
      >
        {body}
      </Pane>
      <Pane className="num flex shrink-0 items-center gap-0.5" data-at-glance-flow-seg style={{ fontSize: 10 }}>
        {FLOW_WINDOWS.map((w, i) => (
          <Pane key={w} className="inline-flex items-center gap-0.5">
            {i > 0 ? (
              <span style={{ color: AT_LABEL, fontSize: 9 }} aria-hidden>
                ·
              </span>
            ) : null}
            <button
              type="button"
              data-at-glance-flow-seg={w}
              onClick={() => setFlowWindow(w)}
              style={{
                fontSize: 10,
                fontWeight: flowWindow === w ? 600 : 500,
                color: flowWindow === w ? WHITE : AT_SECONDARY,
                padding: "2px 4px",
                minWidth: 28,
                minHeight: 28,
                background: flowWindow === w ? "rgba(255,255,255,0.1)" : "transparent",
                borderRadius: 4,
                border: flowWindow === w ? `1px solid ${AT_SECONDARY}` : "1px solid transparent",
              }}
            >
              {w}
            </button>
          </Pane>
        ))}
      </Pane>
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
  keepawayPutLine,
  keepawayCallLine,
  sessionOpen,
}: AtGlanceTopProps) {
  const mode = resolveAtGlanceMode(symbol);
  const { data: quote } = useQuote(symbol);
  const flow = useDeskFlowStream(symbol, true);
  const liveSpot = useGlanceSpotPrice(symbol, underlyingPrice, flow.livePx);
  const spotShown = useThrottledNumber(liveSpot, SPOT_PAINT_MS);
  const spotColor = useSpotDirectionColor(liveSpot, SPOT_PAINT_MS);
  const spotLabel = formatAtGlanceSpot(symbol, spotShown);

  const open = sessionOpen ?? quote?.close ?? null;
  const fromOpen =
    quote?.change != null && Number.isFinite(quote.change)
      ? quote.change
      : spotShown != null && open != null && Number.isFinite(open)
        ? spotShown - open
        : null;

  const gexStr = mode === "futures" ? null : formatGexUsd(zones.netGexUsdPer1Pct);
  const showWalls = mode !== "futures" || zones.putWall != null || zones.callWall != null;
  const keepawayHint =
    keepawayPutLine != null || keepawayCallLine != null
      ? `KA ${keepawayPutLine != null ? formatStrikeLevel(keepawayPutLine) : "—"}/${keepawayCallLine != null ? formatStrikeLevel(keepawayCallLine) : "—"}`
      : null;

  return (
    <Pane
      data-at-glance-top
      className="at-glance px-1.5 py-0 shrink-0"
      style={{
        background: BG_EXP_BAR,
        borderBottom: `1px solid ${BORDER}`,
        maxHeight: `min(${MAX_GLANCE_PX}px, 20vh)`,
        overflow: "hidden",
      }}
    >
      <Pane className="flex items-center gap-1" style={{ minHeight: 18, lineHeight: 1.1 }}>
        <Pane
          className="num shrink-0"
          style={{
            ...NUM_FEAT,
            fontSize: 12,
            fontWeight: 600,
            color: fromOpen != null && fromOpen < 0 ? DOWN_TEXT : fromOpen != null && fromOpen > 0 ? UP : WHITE,
          }}
        >
          {fromOpen != null ? (
            <>
              {fromOpen >= 0 ? "▲" : "▼"}
              {Math.abs(fromOpen).toFixed(2)}
            </>
          ) : (
            "—"
          )}
          <span style={{ fontSize: 9, fontWeight: 500, color: AT_LABEL, marginLeft: 3 }}>OPEN</span>
        </Pane>
        {gexStr ? (
          <Pane className="num flex-1 text-center truncate" style={{ ...NUM_FEAT, fontSize: 11, fontWeight: 600, color: WHITE }}>
            GEX {gexStr.replace(/^GEX\s*/, "")}
          </Pane>
        ) : (
          <Pane className="flex-1" />
        )}
        {zones.flip != null ? (
          <Pane className="num shrink-0" style={{ ...NUM_FEAT, fontSize: 11, fontWeight: 600, color: GAMMA_SCENARIO }}>
            FLIP {formatStrikeLevel(Math.round(zones.flip))}
          </Pane>
        ) : null}
        {keepawayHint ? (
          <Pane className="num shrink-0 hidden min-[400px]:block" style={{ ...NUM_FEAT, fontSize: 9, fontWeight: 500, color: AT_SECONDARY }}>
            {keepawayHint}
          </Pane>
        ) : null}
      </Pane>

      <Pane
        className="grid gap-x-0.5 items-end"
        style={{
          gridTemplateColumns: showWalls ? "1fr auto 1fr" : "1fr",
          minHeight: 32,
        }}
      >
        {showWalls ? (
          <Pane className="num text-left" style={{ ...NUM_FEAT, fontSize: 22, fontWeight: 600, color: PUT_WALL, lineHeight: 1 }}>
            <span style={{ fontSize: 8, fontWeight: 500, color: AT_LABEL, display: "block", marginBottom: 0 }}>PUT</span>
            {zones.putWall != null ? formatStrikeLevel(zones.putWall) : "—"}
          </Pane>
        ) : null}
        <Pane className="text-center px-0.5" style={showWalls ? undefined : { gridColumn: "1 / -1" }}>
          <Pane style={{ fontSize: 9, fontWeight: 500, letterSpacing: "0.06em", color: AT_LABEL, lineHeight: 1 }}>
            {symbol.replace(/^\$/, "")}
          </Pane>
          <Pane className="num" style={{ ...NUM_FEAT, fontSize: 30, fontWeight: 700, color: spotColor, lineHeight: 1 }}>
            {spotLabel}
          </Pane>
        </Pane>
        {showWalls ? (
          <Pane className="num text-right" style={{ ...NUM_FEAT, fontSize: 22, fontWeight: 600, color: GOLD, lineHeight: 1 }}>
            <span style={{ fontSize: 8, fontWeight: 500, color: AT_LABEL, display: "block", marginBottom: 0 }}>CALL</span>
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