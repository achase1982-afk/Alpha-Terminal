import { memo, useState, type CSSProperties, type PropsWithChildren } from "react";
import { Info } from "lucide-react";
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
import { useThrottledNumber } from "@/lib/active-trader/useThrottledNumber";
import { useDeskFlowStream } from "@/hooks/useDeskFlowStream";
import { useQuote } from "@/hooks/useQuote";
import { resolveGlanceFromOpenChange, resolveSessionChangeDisplay } from "@/lib/atQuoteSessionChange";
import { useGlanceSpotPrice } from "@/hooks/useGlanceSpotPrice";
import { formatAtGlanceSpot } from "@/lib/active-trader/atGlanceSpotFormat";
import { AT_LABEL, AT_INTERACTIVE, AT_SECONDARY } from "@/lib/active-trader/atChromeContrast";
import { useSpxLowZone } from "@/hooks/useSpxLowZone";
import { SPX_LOW_ZONE_TOOLTIP, formatLowZoneLevel } from "@/lib/active-trader/spxLowZone";
import { isSpxSymbol } from "@workspace/order-ticket-math";
import { AtGlanceFlowTracks } from "./AtGlanceFlowTracks";
import { AtGlanceFlowDetail } from "./AtGlanceFlowDetail";

const NUM_FEAT: CSSProperties = {
  fontFeatureSettings: '"tnum" 1, "ss01" 1, "cv09" 1',
  fontVariantNumeric: "tabular-nums",
};

const SPOT_PAINT_MS = 250;
const MAX_GLANCE_PX = 191;

export type AtGlanceTopProps = {
  symbol: string;
  underlyingPrice: number | null;
  zones: ZoneModel;
  keepawayPutLine?: number | null;
  keepawayCallLine?: number | null;
  keepawayStats?: SpxKeepawayStats | null;
  sessionOpen?: number | null;
  embedded?: boolean;
  glanceCaption?: string | null;
  sessionClosed?: boolean;
  skipNetwork?: boolean;
};

export const AtGlanceTop = memo(function AtGlanceTop({
  symbol,
  underlyingPrice,
  zones,
  sessionOpen,
  glanceCaption,
  sessionClosed,
  skipNetwork,
}: AtGlanceTopProps) {
  const mode = resolveAtGlanceMode(symbol);
  const { data: quote, restQuote } = useQuote(symbol);
  const { aggregate: flow, sessionClosed: flowSessionClosed, netPremium } = useDeskFlowStream(symbol, true);
  const flowClosed = sessionClosed || flowSessionClosed;
  const liveSpot = useGlanceSpotPrice(symbol, underlyingPrice, flow.livePx);
  const spotShown = useThrottledNumber(liveSpot, SPOT_PAINT_MS);

  const sessionChange = resolveSessionChangeDisplay(quote, restQuote);
  const fromOpen = resolveGlanceFromOpenChange(quote, spotShown, sessionOpen, restQuote);
  const spotColor =
    flowClosed || fromOpen == null
      ? WHITE
      : fromOpen > 0
        ? UP
        : fromOpen < 0
          ? DOWN_TEXT
          : sessionChange.change === 0
            ? WHITE
            : WHITE;

  const spotLabel = formatAtGlanceSpot(symbol, spotShown);
  const gexStr = mode === "futures" ? null : formatGexUsd(zones.netGexUsdPer1Pct);
  const gexDisplay = gexStr && gexStr !== "\u2014" ? gexStr : null;
  const caption = glanceCaption ?? zones.glanceCaption;
  const showWalls = mode !== "futures" || zones.putWall != null || zones.callWall != null;

  const spxLowZone = useSpxLowZone(symbol, { skipNetwork });
  const showLowZone = isSpxSymbol(symbol);
  const [lowZoneInfo, setLowZoneInfo] = useState(false);
  const [flowDetailOpen, setFlowDetailOpen] = useState(false);
  const lowZoneTone = spxLowZone.emphasisFull ? AT_INTERACTIVE : AT_SECONDARY;

  const sessionHighLabel =
    quote?.high != null && Number.isFinite(quote.high) && quote.high > 0
      ? formatLowZoneLevel(quote.high)
      : "\u2014";

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
      <Pane
        className="flex items-center gap-1"
        style={{ minHeight: 14, lineHeight: 1.05 }}
      >
        {zones.flip != null ? (
          <Pane className="num shrink-0" style={{ ...NUM_FEAT, fontSize: 10, fontWeight: 600, color: GAMMA_SCENARIO }}>
            FLIP {formatStrikeLevel(Math.round(zones.flip))}
          </Pane>
        ) : (
          <Pane className="shrink-0" style={{ fontSize: 10, color: AT_LABEL }}>
            FLIP —
          </Pane>
        )}
        <Pane className="flex-1" />
        {showLowZone ? (
          <Pane
            className="num shrink-0 hidden min-[380px]:inline"
            data-at-day-high-context
            style={{ ...NUM_FEAT, fontSize: 9, fontWeight: 500, color: AT_SECONDARY }}
          >
            <span style={{ color: AT_LABEL }}>Day high </span>
            {sessionHighLabel}
          </Pane>
        ) : null}
      </Pane>

      <Pane
        className="grid gap-x-0.5 items-end"
        style={{
          gridTemplateColumns: showWalls ? "1fr auto 1fr" : "1fr",
          minHeight: 28,
        }}
      >
        {showWalls ? (
          <Pane className="num text-left" style={{ ...NUM_FEAT, fontSize: 18, fontWeight: 600, color: PUT_WALL, lineHeight: 1 }}>
            <span style={{ fontSize: 8, fontWeight: 500, color: AT_LABEL, display: "block", marginBottom: 0 }}>PUT</span>
            {zones.putWall != null ? formatStrikeLevel(zones.putWall) : "\u2014"}
          </Pane>
        ) : null}
        <Pane className="text-center px-0.5" style={showWalls ? undefined : { gridColumn: "1 / -1" }}>
          {caption ? (
            <Pane
              data-at-glance-session
              style={{ fontSize: 8, fontWeight: 500, letterSpacing: "0.04em", color: AT_SECONDARY, lineHeight: 1.1, marginBottom: 1 }}
            >
              {caption}
            </Pane>
          ) : null}
          <Pane style={{ fontSize: 9, fontWeight: 500, letterSpacing: "0.06em", color: AT_LABEL, lineHeight: 1 }}>
            {symbol.replace(/^\$/, "")}
          </Pane>
          <Pane
            className="num"
            data-ui-audit="at-glance-spot"
            style={{ ...NUM_FEAT, fontSize: 26, fontWeight: 700, color: spotColor, lineHeight: 1 }}
          >
            {spotLabel}
          </Pane>
        </Pane>
        {showWalls ? (
          <Pane className="num text-right" style={{ ...NUM_FEAT, fontSize: 18, fontWeight: 600, color: GOLD, lineHeight: 1 }}>
            <span style={{ fontSize: 8, fontWeight: 500, color: AT_LABEL, display: "block", marginBottom: 0 }}>CALL</span>
            {zones.callWall != null ? formatStrikeLevel(zones.callWall) : "\u2014"}
          </Pane>
        ) : null}
      </Pane>

      {showLowZone ? (
        <Pane
          data-at-day-low-zone
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-0.5"
          style={{ minHeight: 12, lineHeight: 1.1, marginTop: 0 }}
        >
          <Pane
            className="num shrink-0"
            data-at-day-low
            style={{ ...NUM_FEAT, fontSize: 9, fontWeight: 500, color: lowZoneTone }}
          >
            <span style={{ color: AT_LABEL, fontWeight: 500 }}>Day low </span>
            {spxLowZone.sessionLowLabel}
          </Pane>
          <Pane className="shrink-0 min-[380px]:hidden inline-flex num" data-at-day-high-context style={{ ...NUM_FEAT, fontSize: 9, color: AT_SECONDARY }}>
            <span style={{ color: AT_LABEL }}>Hi </span>
            {sessionHighLabel}
          </Pane>
          <Pane className="shrink-0 inline-flex items-center gap-0.5" style={{ fontSize: 9 }}>
            <Pane
              className="num"
              data-at-low-zone-ref
              style={{ ...NUM_FEAT, fontWeight: spxLowZone.emphasisFull ? 600 : 500, color: lowZoneTone }}
            >
              <span style={{ color: AT_LABEL, fontWeight: 500 }}>Low zone (ref) </span>
              {spxLowZone.lowZoneLabel}
            </Pane>
            <button
              type="button"
              aria-label="Low zone reference info"
              onClick={() => setLowZoneInfo((v) => !v)}
              className="p-0.5 rounded shrink-0"
              style={{ color: lowZoneInfo ? WHITE : AT_SECONDARY }}
            >
              <Info className="w-3 h-3" aria-hidden />
            </button>
          </Pane>
          {lowZoneInfo ? (
            <Pane
              data-at-low-zone-tooltip
              style={{ flexBasis: "100%", fontSize: 8, lineHeight: 1.2, color: AT_SECONDARY, fontWeight: 400 }}
            >
              {SPX_LOW_ZONE_TOOLTIP}
            </Pane>
          ) : null}
        </Pane>
      ) : null}

      <Pane data-at-glance-flow-row style={{ marginTop: 1, minHeight: 30, maxHeight: 32, overflow: "hidden" }}>
        <AtGlanceFlowTracks glance={netPremium} onOpenDetail={() => setFlowDetailOpen(true)} />
      </Pane>

      <AtGlanceFlowDetail
        open={flowDetailOpen}
        onClose={() => setFlowDetailOpen(false)}
        netGlance={netPremium}
        flowAgg={flow}
        gexLabel={gexDisplay}
      />
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