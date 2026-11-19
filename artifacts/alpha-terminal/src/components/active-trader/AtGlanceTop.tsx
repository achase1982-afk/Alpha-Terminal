import { memo, useMemo, type CSSProperties, type ReactNode } from "react";
import { BORDER, UP, WHITE } from "@/components/options/optionsTheme";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { resolveGammaFlipDisplay } from "@/lib/active-trader/atGlanceWallDisplay";
import type { SpxKeepawayStats } from "@workspace/order-ticket-math";
import { resolveAtGlanceMode } from "@/lib/active-trader/atGlanceMode";
import { useThrottledNumber } from "@/lib/active-trader/useThrottledNumber";
import { useDeskFlowStream } from "@/hooks/useDeskFlowStream";
import { useQuote } from "@/hooks/useQuote";
import { useGlanceSpotPrice } from "@/hooks/useGlanceSpotPrice";
import { formatAtGlanceSpot } from "@/lib/active-trader/atGlanceSpotFormat";
import { AT_HEADER_BG, AT_LABEL, AT_SECONDARY } from "@/lib/active-trader/atChromeContrast";
import { useAtGlanceSessionLevels } from "@/hooks/useAtGlanceSessionLevels";
import { LOW_ZONE_REF_TOOLTIP } from "@/lib/active-trader/atLowZoneSlot";
import { formatRefZoneHalf, SPX_REF_ZONE_TOOLTIP } from "@/lib/active-trader/spxRefZone";
import { dayStatusColor, dayStatusLabel, resolveDayStatus } from "@/lib/active-trader/atDayStatus";
import { useSpotTickCue } from "@/lib/active-trader/atSpotDirection";
import { resolveAtHeaderSessionChange } from "@/lib/active-trader/atHeaderSessionChange";
import { AtGlanceGrossFlow } from "./AtGlanceGrossFlow";
import type { ActiveTraderTemplatePrefs } from "@/lib/active-trader/activeTraderPrefs";
import type { SchwabInstruction } from "@/lib/active-trader/atSchwabOrderBuilder";
import type { AtLadderHeatSourceMeta } from "@/lib/active-trader/useAtLadderVolumeHeat";
import { AT_LADDER_GAMMA } from "@/lib/active-trader/atLadderLayout";

export { AT_HEADER_BG };

const NUM_FEAT: CSSProperties = {
  fontFeatureSettings: '"tnum" 1, "ss01" 1, "cv09" 1',
  fontVariantNumeric: "tabular-nums",
};

const SPOT_PAINT_MS = 250;

const LABEL_PX = 13;
const VALUE_PX = 14;

const cellLine: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 8,
  whiteSpace: "nowrap",
  overflow: "hidden",
  lineHeight: 1,
  minWidth: 0,
};

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
  viewSelector?: ReactNode;
  orderSettings?: {
    prefs: ActiveTraderTemplatePrefs;
    primaryInstruction: SchwabInstruction;
    limitMid: number | null;
    open: boolean;
    onToggle: () => void;
  };
  ladderHeatSource?: AtLadderHeatSourceMeta;
};

function LevelsCell({
  label,
  value,
  dataAttrs,
  title,
  valueTone = WHITE,
}: {
  label: string;
  value: string;
  dataAttrs?: Record<string, string>;
  title?: string;
  valueTone?: string;
}) {
  return (
    <div {...dataAttrs} title={title} style={cellLine}>
      <span className="truncate" style={{ color: AT_LABEL, fontSize: LABEL_PX, fontWeight: 400 }}>
        {label}
      </span>
      <span className="num shrink-0 text-right" style={{ ...NUM_FEAT, color: valueTone, fontWeight: 600, fontSize: VALUE_PX }}>
        {value}
      </span>
    </div>
  );
}

export const AtGlanceTop = memo(function AtGlanceTop({
  symbol,
  underlyingPrice,
  zones,
  sessionClosed,
  skipNetwork,
  viewSelector,
  ladderHeatSource,
}: AtGlanceTopProps) {
  const mode = resolveAtGlanceMode(symbol);
  const { data: quote, restQuote } = useQuote(symbol);
  const { aggregate: flow, sessionClosed: flowSessionClosed, netPremium, flowWindowMs } = useDeskFlowStream(symbol, true);
  const flowDashShell = Boolean(sessionClosed || flowSessionClosed);
  const liveSpot = useGlanceSpotPrice(symbol, underlyingPrice, flow.livePx);
  const spotShown = useThrottledNumber(liveSpot, SPOT_PAINT_MS);
  const tickCue = useSpotTickCue(liveSpot, SPOT_PAINT_MS);

  const sessionChange = useMemo(
    () => resolveAtHeaderSessionChange(quote, restQuote, spotShown),
    [quote, restQuote, spotShown],
  );
  const dayStatus = resolveDayStatus(sessionChange);
  const dayLabel = dayStatusLabel(dayStatus);

  const spotLabel = formatAtGlanceSpot(symbol, spotShown);
  const symLabel = symbol.replace(/^\$/, "");

  const sessionLevels = useAtGlanceSessionLevels(symbol, { skipNetwork });

  const flowWindowSec = Math.round(flowWindowMs / 1000);
  const flipLabel = resolveGammaFlipDisplay(zones);

  const lowZoneVal =
    sessionLevels.lowZone.status === "value" ? formatRefZoneHalf(sessionLevels.lowZone.top) : "\u2014";
  const highZoneVal =
    sessionLevels.highZone.status === "value" ? formatRefZoneHalf(sessionLevels.highZone.bottom) : "\u2014";
  const zoneValTone = sessionLevels.zoneEmphasisFull ? WHITE : AT_SECONDARY;

  return (
    <header
      data-at-glance-top
      className="at-glance shrink-0 w-full"
      style={{
        background: AT_HEADER_BG,
        borderBottom: `1px solid ${BORDER}`,
        padding: 0,
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <span data-at-glance-chrome-version="anthony-v4" className="sr-only" aria-hidden />

      <div
        className="flex items-center gap-1 min-w-0"
        style={{
          height: 42,
          padding: "0 13px",
          borderBottom: `1px solid ${BORDER}`,
          boxSizing: "border-box",
          lineHeight: 1,
        }}
      >
        <div className="flex items-baseline gap-1.5 min-w-0 flex-1 overflow-hidden">
          <span style={{ fontSize: 13, fontWeight: 500, color: AT_SECONDARY, letterSpacing: "0.01em" }}>{symLabel}</span>
          <span
            className="num"
            data-ui-audit="at-glance-spot"
            style={{ ...NUM_FEAT, fontSize: 28, fontWeight: 500, color: UP, letterSpacing: "-0.02em" }}
          >
            {spotLabel}
          </span>
          {tickCue.glyph ? (
            <span data-at-tick-cue style={{ fontSize: 9, color: tickCue.color, lineHeight: 1 }}>
              {tickCue.glyph}
            </span>
          ) : null}
          <span
            data-at-day-status={dayStatus.kind}
            className="shrink-0"
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: dayStatusColor(dayStatus),
              marginLeft: 1,
              whiteSpace: "nowrap",
            }}
          >
            {dayLabel}
          </span>
        </div>
        {viewSelector ? (
          <div data-at-header-view-selector className="shrink-0">
            {viewSelector}
          </div>
        ) : null}
      </div>

      {sessionLevels.showRow && mode !== "futures" ? (
        <div
          data-at-day-levels-grid
          style={{
            display: "grid",
            gridTemplateRows: "26px 26px",
            width: "100%",
            height: 52,
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "161px 24px 1px 15px minmax(0, 1fr)",
              alignItems: "center",
              padding: "0 13px",
              borderBottom: `1px solid ${BORDER}`,
              boxSizing: "border-box",
            }}
          >
            <LevelsCell
              label="Day low"
              value={sessionLevels.dayLowValue}
              dataAttrs={{
                "data-at-day-low": "",
                "data-at-day-low-kind": sessionLevels.dayLow.kind,
              }}
            />
            <span style={{ gridColumn: 3, width: 1, height: 14, background: AT_LABEL, opacity: 0.35 }} aria-hidden data-at-day-levels-divider />
            <div style={{ gridColumn: 5, minWidth: 0 }}>
              <LevelsCell
                label="Low zone top"
                value={lowZoneVal}
                dataAttrs={{ "data-at-low-zone-ref": "", "data-at-low-zone-slot": "" }}
                title={LOW_ZONE_REF_TOOLTIP}
                valueTone={zoneValTone}
              />
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "161px 24px 1px 15px minmax(0, 1fr)",
              alignItems: "center",
              padding: "0 13px",
              boxSizing: "border-box",
            }}
          >
            <LevelsCell
              label="Day high"
              value={sessionLevels.dayHighValue}
              dataAttrs={{
                "data-at-day-high": "",
                "data-at-day-high-kind": sessionLevels.dayHigh.kind,
              }}
            />
            <span style={{ gridColumn: 3, width: 1, height: 14, background: AT_LABEL, opacity: 0.35 }} aria-hidden />
            <div style={{ gridColumn: 5, minWidth: 0 }}>
              <LevelsCell
                label="High zone bottom"
                value={highZoneVal}
                dataAttrs={{ "data-at-high-zone-ref": "", "data-at-high-zone-slot": "" }}
                title={SPX_REF_ZONE_TOOLTIP}
              />
            </div>
          </div>
        </div>
      ) : null}

      <div
        data-at-glance-flow-band
        style={{
          height: 79,
          padding: "6px 13px 5px",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
        }}
      >
        <div className="flex items-center justify-between gap-2 min-w-0 overflow-hidden" style={{ height: 18, lineHeight: 1 }}>
          <span className="flex items-center min-w-0 overflow-hidden" style={{ flex: "1 1 auto" }}>
            <span
              data-at-flow-now
              style={{ fontWeight: 500, color: WHITE, fontSize: 15, letterSpacing: 0, whiteSpace: "nowrap" }}
            >
              Flow now · {flowWindowSec}s
            </span>
            {ladderHeatSource?.label ? <span className="sr-only" data-at-ladder-heat-source data-at-ladder-heat-fresh={ladderHeatSource.sourceFresh ? "1" : "0"}>{ladderHeatSource.label}</span> : null}
          </span>
          <span
            data-at-gamma-flip
            className="num shrink-0 truncate"
            style={{ ...NUM_FEAT, fontWeight: 500, color: AT_LADDER_GAMMA, fontSize: 14, whiteSpace: "nowrap" }}
          >
            Gamma flip {flipLabel}
          </span>
        </div>

        <div data-at-glance-flow-row style={{ marginTop: 4, height: 45 }}>
          <AtGlanceGrossFlow
            glance={netPremium}
            zones={zones}
            forceDashAmounts={flowDashShell}
          />
        </div>
      </div>
    </header>
  );
});