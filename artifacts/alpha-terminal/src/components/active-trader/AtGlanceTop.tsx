import { memo, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { BORDER, GAMMA_SCENARIO, WHITE } from "@/components/options/optionsTheme";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { formatStrikeLevel } from "@/lib/active-trader/atExpiryPill";
import type { SpxKeepawayStats } from "@workspace/order-ticket-math";
import { resolveAtGlanceMode } from "@/lib/active-trader/atGlanceMode";
import { useThrottledNumber } from "@/lib/active-trader/useThrottledNumber";
import { useDeskFlowStream } from "@/hooks/useDeskFlowStream";
import { useQuote } from "@/hooks/useQuote";
import { useGlanceSpotPrice } from "@/hooks/useGlanceSpotPrice";
import { formatAtGlanceSpot } from "@/lib/active-trader/atGlanceSpotFormat";
import { AT_LABEL, AT_SECONDARY } from "@/lib/active-trader/atChromeContrast";
import { useAtGlanceSessionLevels } from "@/hooks/useAtGlanceSessionLevels";
import { LOW_ZONE_REF_TOOLTIP } from "@/lib/active-trader/atLowZoneSlot";
import { formatRefZoneHalf, SPX_REF_ZONE_TOOLTIP } from "@/lib/active-trader/spxRefZone";
import { dayStatusColor, dayStatusLabel, resolveDayStatus } from "@/lib/active-trader/atDayStatus";
import { useSpotTickCue } from "@/lib/active-trader/atSpotDirection";
import { resolveAtHeaderSessionChange } from "@/lib/active-trader/atHeaderSessionChange";
import { AtGlanceGrossFlow } from "./AtGlanceGrossFlow";
import { AtGlanceFlowDetail } from "./AtGlanceFlowDetail";
import type { ActiveTraderTemplatePrefs } from "@/lib/active-trader/activeTraderPrefs";
import type { SchwabInstruction } from "@/lib/active-trader/atSchwabOrderBuilder";
import { formatGlanceOrderSettingsLine } from "@/lib/active-trader/atSummaryFormat";

export const AT_HEADER_BG = "#1b1d21";

const NUM_FEAT: CSSProperties = {
  fontFeatureSettings: '"tnum" 1, "ss01" 1, "cv09" 1',
  fontVariantNumeric: "tabular-nums",
};

const SPOT_PAINT_MS = 250;

const LABEL_PX = 11;
const VALUE_PX = 13;

const cellLine: CSSProperties = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  lineHeight: 1.12,
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
      <span style={{ color: AT_LABEL, fontSize: LABEL_PX, fontWeight: 500 }}>{label} </span>
      <span className="num" style={{ ...NUM_FEAT, color: valueTone, fontWeight: 700, fontSize: VALUE_PX }}>
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
  orderSettings,
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
  const [flowDetailOpen, setFlowDetailOpen] = useState(false);

  const flowWindowSec = Math.round(flowWindowMs / 1000);
  const flipLabel = zones.flip != null ? formatStrikeLevel(Math.round(zones.flip)) : "\u2014";

  const orderLine =
    orderSettings != null
      ? formatGlanceOrderSettingsLine(
          orderSettings.prefs,
          orderSettings.limitMid,
          orderSettings.primaryInstruction,
        )
      : null;

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
        padding: "3px 6px 4px",
        overflow: "hidden",
      }}
    >
      <span data-at-glance-chrome-version="anthony-v2" className="sr-only" aria-hidden />

      <div className="flex items-center gap-1 min-w-0" style={{ minHeight: 16, lineHeight: 1.1 }}>
        <div className="flex items-baseline gap-1 min-w-0 flex-1 overflow-hidden">
          <span style={{ fontSize: 13, fontWeight: 700, color: WHITE, letterSpacing: "0.03em" }}>{symLabel}</span>
          <span className="num" data-ui-audit="at-glance-spot" style={{ ...NUM_FEAT, fontSize: 13, fontWeight: 700, color: WHITE }}>
            {spotLabel}
          </span>
          {tickCue.glyph ? (
            <span data-at-tick-cue style={{ fontSize: 8, color: tickCue.color, lineHeight: 1 }}>
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
              marginLeft: 3,
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
            display: "flex",
            alignItems: "stretch",
            width: "100%",
            marginTop: 2,
            columnGap: 0,
          }}
        >
          <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
            <LevelsCell
              label="Day low"
              value={sessionLevels.dayLowValue}
              dataAttrs={{
                "data-at-day-low": "",
                "data-at-day-low-kind": sessionLevels.dayLow.kind,
              }}
            />
            <LevelsCell
              label="Low zone top"
              value={lowZoneVal}
              dataAttrs={{ "data-at-low-zone-ref": "", "data-at-low-zone-slot": "" }}
              title={LOW_ZONE_REF_TOOLTIP}
              valueTone={zoneValTone}
            />
          </div>
          <div
            aria-hidden
            data-at-day-levels-divider
            style={{ flex: "0 0 1px", width: 1, background: BORDER, opacity: 0.55, margin: "0 5px" }}
          />
          <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
            <LevelsCell
              label="Day high"
              value={sessionLevels.dayHighValue}
              dataAttrs={{
                "data-at-day-high": "",
                "data-at-day-high-kind": sessionLevels.dayHigh.kind,
              }}
            />
            <LevelsCell
              label="High zone bottom"
              value={highZoneVal}
              dataAttrs={{ "data-at-high-zone-ref": "", "data-at-high-zone-slot": "" }}
              title={SPX_REF_ZONE_TOOLTIP}
            />
          </div>
        </div>
      ) : null}

      <div data-at-glance-flow-band style={{ marginTop: 3, display: "flex", flexDirection: "column", gap: 2 }}>
        <div className="flex items-center justify-between gap-1" style={{ minHeight: 13, lineHeight: 1.1 }}>
          <span
            data-at-flow-now
            style={{ fontWeight: 600, color: AT_LABEL, fontSize: 10, letterSpacing: "0.04em", whiteSpace: "nowrap" }}
          >
            FLOW NOW · {flowWindowSec}s
          </span>
          <span
            data-at-gamma-flip
            className="num"
            style={{ ...NUM_FEAT, fontWeight: 600, color: GAMMA_SCENARIO, fontSize: 10, whiteSpace: "nowrap" }}
          >
            Gamma flip {flipLabel}
          </span>
        </div>

        <div data-at-glance-flow-row style={{ minHeight: 30 }}>
          <AtGlanceGrossFlow
            glance={netPremium}
            callWall={zones.callWall}
            putWall={zones.putWall}
            forceDashAmounts={flowDashShell}
            onOpenDetail={() => setFlowDetailOpen(true)}
          />
        </div>
      </div>

      {orderLine != null && orderSettings != null ? (
        <button
          type="button"
          data-at-order-settings-row
          data-at-settings-summary
          data-at-advanced-order-trigger
          className="w-full flex items-center justify-between gap-1 min-w-0"
          style={{
            marginTop: 3,
            minHeight: 18,
            padding: 0,
            background: "transparent",
            border: "none",
            borderTop: `1px solid ${BORDER}`,
            paddingTop: 2,
            fontSize: 8,
            color: AT_SECONDARY,
            lineHeight: 1.2,
          }}
          onClick={orderSettings.onToggle}
          aria-expanded={orderSettings.open}
        >
          <span className="truncate text-left">{orderLine}</span>
          <ChevronRight className="w-3 h-3 shrink-0" style={{ color: AT_LABEL }} aria-hidden />
        </button>
      ) : null}

      <AtGlanceFlowDetail
        open={flowDetailOpen}
        onClose={() => setFlowDetailOpen(false)}
        netGlance={netPremium}
        flowAgg={flow}
        gexLabel={null}
      />
    </header>
  );
});