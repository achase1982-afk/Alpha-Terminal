import { memo, useState, type CSSProperties, type PropsWithChildren, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { BORDER, DOWN_TEXT, GAMMA_SCENARIO, GOLD, PUT_WALL, UP, WHITE } from "@/components/options/optionsTheme";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { formatStrikeLevel } from "@/lib/active-trader/atExpiryPill";
import type { SpxKeepawayStats } from "@workspace/order-ticket-math";
import { resolveAtGlanceMode } from "@/lib/active-trader/atGlanceMode";
import { useThrottledNumber } from "@/lib/active-trader/useThrottledNumber";
import { useDeskFlowStream } from "@/hooks/useDeskFlowStream";
import { useQuote } from "@/hooks/useQuote";
import { resolveSessionChangeDisplay } from "@/lib/atQuoteSessionChange";
import { useGlanceSpotPrice } from "@/hooks/useGlanceSpotPrice";
import { formatAtGlanceSpot } from "@/lib/active-trader/atGlanceSpotFormat";
import { AT_LABEL, AT_SECONDARY } from "@/lib/active-trader/atChromeContrast";
import { useAtGlanceSessionLevels } from "@/hooks/useAtGlanceSessionLevels";
import { LOW_ZONE_REF_TOOLTIP } from "@/lib/active-trader/atLowZoneSlot";
import { formatRefZoneHalf, SPX_REF_ZONE_TOOLTIP } from "@/lib/active-trader/spxRefZone";
import { dayStatusColor, dayStatusLabel, resolveDayStatus } from "@/lib/active-trader/atDayStatus";
import { useSpotTickCue } from "@/lib/active-trader/atSpotDirection";
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
const MAX_GLANCE_PX = 191;

const DIVIDER: CSSProperties = {
  height: 1,
  background: BORDER,
  opacity: 0.55,
  margin: "2px 0",
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
  const flowClosed = sessionClosed || flowSessionClosed;
  const liveSpot = useGlanceSpotPrice(symbol, underlyingPrice, flow.livePx);
  const spotShown = useThrottledNumber(liveSpot, SPOT_PAINT_MS);
  const tickCue = useSpotTickCue(liveSpot, SPOT_PAINT_MS);

  const sessionChange = resolveSessionChangeDisplay(quote, restQuote);
  const dayStatus = resolveDayStatus(sessionChange);
  const dayLabel = dayStatusLabel(dayStatus);

  const spotLabel = formatAtGlanceSpot(symbol, spotShown);
  const symLabel = symbol.replace(/^\$/, "");

  const sessionLevels = useAtGlanceSessionLevels(symbol, { skipNetwork });
  const [flowDetailOpen, setFlowDetailOpen] = useState(false);

  const flowWindowSec = Math.round(flowWindowMs / 1000);
  const flipLabel =
    zones.flip != null ? formatStrikeLevel(Math.round(zones.flip)) : "\u2014";

  const orderLine =
    orderSettings != null
      ? formatGlanceOrderSettingsLine(
          orderSettings.prefs,
          orderSettings.limitMid,
          orderSettings.primaryInstruction,
        )
      : null;

  return (
    <Pane
      data-at-glance-top
      className="at-glance px-1.5 py-0.5 shrink-0"
      style={{
        background: AT_HEADER_BG,
        borderBottom: `1px solid ${BORDER}`,
        maxHeight: `min(${MAX_GLANCE_PX}px, 22vh)`,
        overflow: "hidden",
      }}
    >
      <Pane className="flex items-center gap-1 min-w-0" style={{ minHeight: 16, lineHeight: 1.1 }}>
        <Pane className="flex items-baseline gap-1 min-w-0 flex-1">
          <span style={{ fontSize: 10, fontWeight: 600, color: WHITE, letterSpacing: "0.04em" }}>{symLabel}</span>
          <span className="num" data-ui-audit="at-glance-spot" style={{ ...NUM_FEAT, fontSize: 11, fontWeight: 700, color: WHITE }}>
            {spotLabel}
          </span>
          {tickCue.glyph ? (
            <span data-at-tick-cue style={{ fontSize: 9, color: tickCue.color, lineHeight: 1 }}>
              {tickCue.glyph}
            </span>
          ) : null}
          <span
            data-at-day-status={dayStatus.kind}
            className="truncate"
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: dayStatusColor(dayStatus),
              marginLeft: 4,
            }}
          >
            {dayLabel}
          </span>
        </Pane>
        {viewSelector ? (
          <Pane data-at-header-view-selector className="shrink-0">
            {viewSelector}
          </Pane>
        ) : null}
      </Pane>

      <div style={DIVIDER} aria-hidden />

      {sessionLevels.showRow && mode !== "futures" ? (
        <Pane
          data-at-day-levels-grid
          className="grid"
          style={{
            gridTemplateColumns: "1fr 1px 1fr",
            gridTemplateRows: "auto auto",
            columnGap: 6,
            rowGap: 1,
            fontSize: 8,
            lineHeight: 1.2,
          }}
        >
          <Pane data-at-day-low data-at-day-low-kind={sessionLevels.dayLow.kind}>
            <span style={{ color: AT_LABEL }}>Day low </span>
            <span className="num" style={{ ...NUM_FEAT, color: WHITE, fontWeight: 600 }}>
              {sessionLevels.dayLowValue}
            </span>
          </Pane>
          <div style={{ gridRow: "1 / 3", background: BORDER, opacity: 0.45 }} aria-hidden />
          <Pane data-at-day-high data-at-day-high-kind={sessionLevels.dayHigh.kind}>
            <span style={{ color: AT_LABEL }}>Day high </span>
            <span className="num" style={{ ...NUM_FEAT, color: WHITE, fontWeight: 600 }}>
              {sessionLevels.dayHighValue}
            </span>
          </Pane>
          <Pane data-at-low-zone-ref title={LOW_ZONE_REF_TOOLTIP}>
            <span style={{ color: AT_LABEL }}>Low zone top </span>
            <span
              className="num"
              data-at-low-zone-slot
              style={{
                ...NUM_FEAT,
                color: sessionLevels.zoneEmphasisFull ? WHITE : AT_SECONDARY,
                fontWeight: sessionLevels.zoneEmphasisFull ? 600 : 500,
              }}
            >
              {sessionLevels.lowZone.status === "value"
                ? formatRefZoneHalf(sessionLevels.lowZone.top)
                : "\u2014"}
            </span>
          </Pane>
          <Pane data-at-high-zone-ref title={SPX_REF_ZONE_TOOLTIP}>
            <span style={{ color: AT_LABEL }}>High zone bottom </span>
            <span className="num" data-at-high-zone-slot style={{ ...NUM_FEAT, color: WHITE, fontWeight: 600 }}>
              {sessionLevels.highZone.status === "value"
                ? formatRefZoneHalf(sessionLevels.highZone.bottom)
                : "\u2014"}
            </span>
          </Pane>
        </Pane>
      ) : null}

      <div style={DIVIDER} aria-hidden />

      <Pane className="flex items-center justify-between gap-1" style={{ minHeight: 12, fontSize: 8, lineHeight: 1.1 }}>
        <span data-at-flow-now style={{ fontWeight: 600, color: AT_LABEL, letterSpacing: "0.04em" }}>
          FLOW NOW · {flowWindowSec}s
        </span>
        <span data-at-gamma-flip className="num" style={{ ...NUM_FEAT, fontWeight: 600, color: GAMMA_SCENARIO, fontSize: 8 }}>
          Gamma flip {flipLabel}
        </span>
      </Pane>

      <Pane data-at-glance-flow-row style={{ marginTop: 1, minHeight: 32, maxHeight: 36, overflow: "hidden" }}>
        <AtGlanceGrossFlow
          glance={netPremium}
          callWall={zones.callWall}
          putWall={zones.putWall}
          onOpenDetail={() => setFlowDetailOpen(true)}
        />
      </Pane>

      {orderLine != null && orderSettings != null ? (
        <>
          <div style={DIVIDER} aria-hidden />
          <button
            type="button"
            data-at-order-settings-row
            data-at-settings-summary
            data-at-advanced-order-trigger
            className="w-full flex items-center justify-between gap-1 min-w-0"
            style={{
              minHeight: 22,
              padding: 0,
              background: "transparent",
              border: "none",
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
        </>
      ) : null}

      <AtGlanceFlowDetail
        open={flowDetailOpen}
        onClose={() => setFlowDetailOpen(false)}
        netGlance={netPremium}
        flowAgg={flow}
        gexLabel={null}
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