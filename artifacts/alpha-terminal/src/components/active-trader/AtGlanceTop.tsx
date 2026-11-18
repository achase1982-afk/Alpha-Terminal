import { memo, useState, type CSSProperties, type PropsWithChildren } from "react";
import {
  BG_EXP_BAR,
  BORDER,
  GAMMA_SCENARIO,
  GOLD,
  PUT_WALL,
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
import { formatAtGlanceSpot } from "@/lib/active-trader/atGlanceSpotFormat";
import { AT_LABEL, AT_SECONDARY } from "@/lib/active-trader/atChromeContrast";
import { useAtGlanceSessionLevels } from "@/hooks/useAtGlanceSessionLevels";
import { dayStatusColor, dayStatusLabel, resolveDayStatus } from "@/lib/active-trader/atDayStatus";
import { SPX_REF_ZONE_TOOLTIP } from "@/lib/active-trader/spxRefZone";
import { AtGlanceGrossFlow } from "./AtGlanceGrossFlow";
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
  keepawayPutLine,
  keepawayCallLine,
  glanceCaption,
  sessionClosed,
  skipNetwork,
}: AtGlanceTopProps) {
  const mode = resolveAtGlanceMode(symbol);
  const { sessionChange } = useQuote(symbol);
  const { aggregate: flow, sessionClosed: flowSessionClosed } = useDeskFlowStream(symbol, true);
  const flowClosed = sessionClosed || flowSessionClosed;
  const liveSpot = useGlanceSpotPrice(symbol, underlyingPrice, flow.livePx);
  const spotShown = useThrottledNumber(liveSpot, SPOT_PAINT_MS);
  const spotColor = useSpotDirectionColor(liveSpot, SPOT_PAINT_MS);
  const spotLabel = formatAtGlanceSpot(symbol, spotShown);

  const dayStatus = resolveDayStatus(sessionChange);
  const dayStatusText = dayStatusLabel(dayStatus);

  const gexStr = mode === "futures" ? null : formatGexUsd(zones.netGexUsdPer1Pct);
  const gexDisplay = gexStr && gexStr !== "\u2014" ? gexStr.replace(/^GEX\s*/, "") : "\u2014";
  const caption = glanceCaption ?? zones.glanceCaption;
  const showWalls = mode !== "futures" || zones.putWall != null || zones.callWall != null;
  const keepawayHint =
    keepawayPutLine != null || keepawayCallLine != null
      ? `KA ${keepawayPutLine != null ? formatStrikeLevel(keepawayPutLine) : "—"}/${keepawayCallLine != null ? formatStrikeLevel(keepawayCallLine) : "—"}`
      : null;

  const sessionLevels = useAtGlanceSessionLevels(symbol, { skipNetwork });
  const [flowDetailOpen, setFlowDetailOpen] = useState(false);

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
      <Pane className="flex items-center gap-1" style={{ minHeight: 16, lineHeight: 1.1 }}>
        <Pane
          className="num shrink-0"
          data-at-day-status={dayStatus.kind}
          style={{
            ...NUM_FEAT,
            fontSize: 10,
            fontWeight: 600,
            color: dayStatusColor(dayStatus),
            background: "transparent",
            border: "none",
          }}
        >
          {dayStatusText}
        </Pane>
        {gexStr != null ? (
          <Pane className="num flex-1 text-center truncate" style={{ ...NUM_FEAT, fontSize: 10, fontWeight: 600, color: WHITE }}>
            GEX {gexDisplay}
          </Pane>
        ) : (
          <Pane className="flex-1" />
        )}
        {zones.flip != null ? (
          <Pane className="num shrink-0" style={{ ...NUM_FEAT, fontSize: 10, fontWeight: 600, color: GAMMA_SCENARIO }}>
            FLIP {formatStrikeLevel(Math.round(zones.flip))}
          </Pane>
        ) : null}
        {keepawayHint ? (
          <Pane className="num shrink-0 hidden min-[400px]:block" style={{ ...NUM_FEAT, fontSize: 8, fontWeight: 500, color: AT_SECONDARY }}>
            {keepawayHint}
          </Pane>
        ) : null}
      </Pane>

      <Pane
        className="grid gap-x-0.5 items-end"
        style={{
          gridTemplateColumns: showWalls ? "1fr auto 1fr" : "1fr",
          minHeight: 30,
        }}
      >
        {showWalls ? (
          <Pane className="num text-left" style={{ ...NUM_FEAT, fontSize: 20, fontWeight: 600, color: PUT_WALL, lineHeight: 1 }}>
            <span style={{ fontSize: 8, fontWeight: 500, color: AT_LABEL, display: "block", marginBottom: 0 }}>PUT</span>
            {zones.putWall != null ? formatStrikeLevel(zones.putWall) : "—"}
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
          <Pane className="num" style={{ ...NUM_FEAT, fontSize: 26, fontWeight: 700, color: spotColor, lineHeight: 1 }}>
            {spotLabel}
          </Pane>
        </Pane>
        {showWalls ? (
          <Pane className="num text-right" style={{ ...NUM_FEAT, fontSize: 20, fontWeight: 600, color: GOLD, lineHeight: 1 }}>
            <span style={{ fontSize: 8, fontWeight: 500, color: AT_LABEL, display: "block", marginBottom: 0 }}>CALL</span>
            {zones.callWall != null ? formatStrikeLevel(zones.callWall) : "—"}
          </Pane>
        ) : null}
      </Pane>

      {sessionLevels.showRow ? (
        <Pane
          data-at-day-low-zone
          className="flex flex-nowrap items-center gap-x-0.5 px-0.5 overflow-hidden"
          style={{ minHeight: 11, lineHeight: 1.1, marginTop: 0, fontSize: 8 }}
        >
          <Pane
            className="num shrink-0"
            data-at-day-low
            data-at-day-low-kind={sessionLevels.dayLow.kind}
            style={{ ...NUM_FEAT, fontSize: 8, fontWeight: 500, color: WHITE }}
          >
            {sessionLevels.dayLowText}
          </Pane>
          {sessionLevels.lowZone.status !== "hidden" ? (
            <>
              <span style={{ color: AT_LABEL, fontSize: 9 }} aria-hidden>
                ·
              </span>
              <Pane
                className="num shrink-0"
                data-at-low-zone-slot
                data-at-low-zone-status={sessionLevels.lowZone.status}
                title={SPX_REF_ZONE_TOOLTIP}
                style={{ ...NUM_FEAT, fontSize: 8, fontWeight: 500, color: AT_SECONDARY }}
              >
                {sessionLevels.lowZoneText}
              </Pane>
            </>
          ) : null}
          {sessionLevels.highZone.status !== "hidden" ? (
            <>
              <span style={{ color: AT_LABEL, fontSize: 9 }} aria-hidden>
                ·
              </span>
              <Pane
                className="num shrink-0"
                data-at-high-zone-slot
                data-at-high-zone-status={sessionLevels.highZone.status}
                title={SPX_REF_ZONE_TOOLTIP}
                style={{ ...NUM_FEAT, fontSize: 8, fontWeight: 500, color: AT_SECONDARY }}
              >
                {sessionLevels.highZoneText}
              </Pane>
            </>
          ) : null}
          <span style={{ color: AT_LABEL, fontSize: 9 }} aria-hidden>
            ·
          </span>
          <Pane
            className="num shrink-0"
            data-at-day-high
            data-at-day-high-kind={sessionLevels.dayHigh.kind}
            style={{ ...NUM_FEAT, fontSize: 8, fontWeight: 500, color: WHITE }}
          >
            {sessionLevels.dayHighText}
          </Pane>
        </Pane>
      ) : null}

      <Pane data-at-glance-flow-row style={{ marginTop: 1, minHeight: 34, maxHeight: 40, overflow: "hidden" }}>
        <AtGlanceGrossFlow
          agg={flow}
          sessionClosed={flowClosed}
          callWall={zones.callWall}
          putWall={zones.putWall}
          onOpenDetail={() => setFlowDetailOpen(true)}
        />
      </Pane>

      <AtGlanceFlowDetail
        open={flowDetailOpen}
        onClose={() => setFlowDetailOpen(false)}
        agg={flow}
        gexLabel={gexDisplay !== "\u2014" ? gexDisplay : null}
        sessionClosed={flowClosed}
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