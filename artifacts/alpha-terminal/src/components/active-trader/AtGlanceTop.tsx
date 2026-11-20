import { memo, useMemo, type CSSProperties } from "react";
import { BORDER, WHITE } from "@/components/options/optionsTheme";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
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
import { resolveAtHeaderSessionChange } from "@/lib/active-trader/atHeaderSessionChange";
import type { ActiveTraderTemplatePrefs } from "@/lib/active-trader/activeTraderPrefs";
import type { SchwabInstruction } from "@/lib/active-trader/atSchwabOrderBuilder";
import type { AtLadderHeatSourceMeta } from "@/lib/active-trader/useAtLadderVolumeHeat";
import { AtFlowStrip } from "./AtFlowStrip";
import { AtExpiryPicker } from "./AtExpiryPicker";
import { useAtVixQuote } from "@/hooks/useAtVixQuote";
import { resolveGlanceFromOpenChange } from "@/lib/atQuoteSessionChange";

export { AT_HEADER_BG };

const NUM_FEAT: CSSProperties = {
  fontFeatureSettings: '"tnum" 1, "ss01" 1, "cv09" 1',
  fontVariantNumeric: "tabular-nums",
};

const SPOT_PAINT_MS = 250;

const LABEL_PX = 13;
const VALUE_PX = 13;
const SECTION_RULE = "#2b3033";
const SPOT_COLOR = WHITE;

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
  orderSettings?: {
    prefs: ActiveTraderTemplatePrefs;
    primaryInstruction: SchwabInstruction;
    limitMid: number | null;
    open: boolean;
    onToggle: () => void;
  };
  ladderHeatSource?: AtLadderHeatSourceMeta;
  expiryPickerLoading?: boolean;
  /** Equity or ETF share ladder. Hides option expiry, walls, and option flow. */
  stockTemplate?: boolean;
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
      <span className="truncate" style={{ color: AT_LABEL, fontSize: LABEL_PX, fontWeight: 500 }}>
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
  ladderHeatSource,
  expiryPickerLoading,
  stockTemplate = false,
}: AtGlanceTopProps) {
  const mode = resolveAtGlanceMode(symbol);
  const showFlowStrip = mode === "index" && !stockTemplate && !skipNetwork;
  const { data: quote, restQuote } = useQuote(symbol);
  const { aggregate: flow, sessionClosed: flowSessionClosed, netPremium, flowWindowMs } = useDeskFlowStream(symbol, true);
  const vixLevel = useAtVixQuote(showFlowStrip);
  const flowDashShell = Boolean(sessionClosed || flowSessionClosed);
  const liveSpot = useGlanceSpotPrice(symbol, underlyingPrice, flow.livePx);
  const spotShown = useThrottledNumber(liveSpot, SPOT_PAINT_MS);

  const sessionChange = useMemo(
    () => resolveAtHeaderSessionChange(quote, restQuote, spotShown),
    [quote, restQuote, spotShown],
  );
  const dayStatus = resolveDayStatus(sessionChange);
  const dayLabel = dayStatusLabel(dayStatus);

  const spotLabel = formatAtGlanceSpot(symbol, spotShown);
  const symLabel = symbol.replace(/^\$/, "");
  const fromOpenPts = resolveGlanceFromOpenChange(quote, spotShown, quote?.close ?? null, restQuote);
  const fromOpenLabel =
    fromOpenPts != null && Number.isFinite(fromOpenPts)
      ? `${fromOpenPts >= 0 ? "+" : "\u2212"}${Math.abs(fromOpenPts).toFixed(2)} vs open`
      : null;
  const vixLabel = vixLevel != null && Number.isFinite(vixLevel) ? vixLevel.toFixed(1) : "\u2014";

  const sessionLevels = useAtGlanceSessionLevels(symbol, { skipNetwork });

  const flowWindowSec = Math.round(flowWindowMs / 1000);

  const lowZoneVal =
    sessionLevels.lowZone.status === "value" ? formatRefZoneHalf(sessionLevels.lowZone.top) : "\u2014";
  const highZoneVal =
    sessionLevels.highZone.status === "value" ? formatRefZoneHalf(sessionLevels.highZone.bottom) : "\u2014";
  const zoneValTone = sessionLevels.zoneEmphasisFull ? WHITE : AT_SECONDARY;

  return (
    <header
      data-at-glance-top
      data-at-zone-source={zones.levelSource ?? ""}
      data-at-zone-label={zones.glanceCaption ?? ""}
      className="at-glance shrink-0 w-full"
      style={{
        background: AT_HEADER_BG,
        borderBottom: `1px solid ${BORDER}`,
        padding: 0,
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <span data-at-glance-chrome-version="flow-strip-nov-19" className="sr-only" aria-hidden />

      <div
        className="flex items-center min-w-0 gap-2"
        style={{
          height: 40,
          padding: "0 12px 0 16px",
          borderBottom: `1px solid ${SECTION_RULE}`,
          boxSizing: "border-box",
          lineHeight: 1,
        }}
      >
        <div className="flex items-baseline min-w-0 flex-1 overflow-hidden" style={{ gap: 6 }}>
          <span
            data-at-glance-symbol
            className="shrink-0 font-semibold text-white tracking-tight whitespace-nowrap"
            style={{ fontSize: 24, lineHeight: 1 }}
          >
            {symLabel}
          </span>
          <span className="inline-flex items-baseline" style={{ gap: 4 }}>
            <span
              className="num"
              data-ui-audit="at-glance-spot"
              style={{ ...NUM_FEAT, fontSize: 28, fontWeight: 600, color: SPOT_COLOR, letterSpacing: "-0.03em" }}
            >
              {spotLabel}
            </span>
            {dayStatus.kind === "up" || dayStatus.kind === "down" ? (
              <span
                data-at-day-direction={dayStatus.kind}
                style={{ fontSize: 13, lineHeight: 1, color: dayStatusColor(dayStatus) }}
              >
                {dayStatus.kind === "up" ? "\u25b2" : "\u25bc"}
              </span>
            ) : null}
          </span>
          <span
            data-at-day-status={dayStatus.kind}
            className="shrink-0"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: dayStatusColor(dayStatus),
              letterSpacing: "0.01em",
              whiteSpace: "nowrap",
            }}
          >
            {dayLabel}
          </span>
          {fromOpenLabel ? (
            <span className="shrink-0 num" style={{ ...NUM_FEAT, fontSize: 12, color: AT_SECONDARY, whiteSpace: "nowrap" }}>
              {fromOpenLabel}
            </span>
          ) : null}
          {showFlowStrip ? (
            <span className="shrink-0 num" data-at-vix-glance="" style={{ ...NUM_FEAT, fontSize: 12, color: AT_SECONDARY, whiteSpace: "nowrap" }}>
              VIX {vixLabel}
            </span>
          ) : null}
        </div>
        {mode !== "futures" && !stockTemplate ? (
          <div className="shrink-0 ml-2 flex items-center justify-end" style={{ maxWidth: "42%" }}>
            <AtExpiryPicker loading={expiryPickerLoading} />
          </div>
        ) : null}
      </div>

      {sessionLevels.showRow && mode !== "futures" ? (
        <div
          data-at-day-levels-grid
          style={{
            display: "grid",
            gridTemplateRows: "22px 22px",
            width: "100%",
            height: 44,
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 1px minmax(0, 1fr)",
              columnGap: 16,
              alignItems: "center",
              padding: "0 16px",
              borderBottom: `1px solid ${SECTION_RULE}`,
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
            <span style={{ width: 1, height: 14, background: "#3a4044" }} aria-hidden data-at-day-levels-divider />
            <div style={{ minWidth: 0 }} hidden={stockTemplate}>
              <LevelsCell
                label="High zone bottom"
                value={highZoneVal}
                dataAttrs={{ "data-at-high-zone-ref": "", "data-at-high-zone-slot": "" }}
                title={SPX_REF_ZONE_TOOLTIP}
              />
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 1px minmax(0, 1fr)",
              columnGap: 16,
              alignItems: "center",
              padding: "0 16px",
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
            <span style={{ width: 1, height: 14, background: "#3a4044" }} aria-hidden />
            <div style={{ minWidth: 0 }} hidden={stockTemplate}>
              <LevelsCell
                label="Low zone top"
                value={lowZoneVal}
                dataAttrs={{ "data-at-low-zone-ref": "", "data-at-low-zone-slot": "" }}
                title={LOW_ZONE_REF_TOOLTIP}
                valueTone={zoneValTone}
              />
            </div>
          </div>
        </div>
      ) : null}

      {showFlowStrip ? (
        <AtFlowStrip
          windowSec={flowWindowSec}
          aggregate={flow}
          netPremium={netPremium}
          zones={zones}
          forceDash={flowDashShell}
          scopeLabel="Desk flow · symbol-wide classified premium"
        />
      ) : !stockTemplate ? (
        <div data-at-glance-flow-band style={{ padding: "4px 16px", fontSize: 12, color: AT_SECONDARY }}>
          Flow strip unavailable for this symbol
          {ladderHeatSource?.label ? (
            <span className="sr-only" data-at-ladder-heat-source data-at-ladder-heat-fresh={ladderHeatSource.sourceFresh ? "1" : "0"}>
              {ladderHeatSource.label}
            </span>
          ) : null}
        </div>
      ) : null}
    </header>
  );
});