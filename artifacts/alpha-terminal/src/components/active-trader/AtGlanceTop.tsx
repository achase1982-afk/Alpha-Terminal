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

const NUM_FEAT: CSSProperties = {
  fontFeatureSettings: '"tnum" 1, "ss01" 1, "cv09" 1',
  fontVariantNumeric: "tabular-nums",
};

const PAINT_MS = 250;

function fmtMoneyShort(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toFixed(0);
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
  const spotShown = useThrottledNumber(underlyingPrice, PAINT_MS);
  const spotColor = useSpotDirectionColor(underlyingPrice, PAINT_MS, quote?.change ?? null);
  const flow = useDeskFlowStream(symbol, mode === "index" || mode === "stock");

  const open = sessionOpen ?? quote?.close ?? null;
  const fromOpen =
    quote?.change != null && Number.isFinite(quote.change)
      ? quote.change
      : spotShown != null && open != null && Number.isFinite(open)
        ? spotShown - open
        : null;

  const gexStr = `GEX ${formatGexUsd(zones.netGexUsdPer1Pct)}`;

  const toggleCompact = () => {
    setCompact((c) => {
      const n = !c;
      saveAtGlanceCompact(n);
      return n;
    });
  };

  const flowLine =
    flow.kind === "index"
      ? `▲ CALLS +${fmtMoneyShort(flow.display.callsBought1m)} · ▲ PUTS ${fmtMoneyShort(flow.display.putsSold1m)}`
      : flow.kind === "stock"
        ? `▲ LIFT $${fmtMoneyShort(flow.tape.buyersLift1m)} · ▼ HIT $${fmtMoneyShort(flow.tape.sellersHit1m)}`
        : null;

  if (mode === "futures") {
    return (
      <div
        data-at-glance-top
        className="at-glance px-2 py-1 shrink-0"
        style={{ background: BG_EXP_BAR, borderBottom: `1px solid ${BORDER}`, maxHeight: "20vh" }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="num" style={{ ...NUM_FEAT, fontSize: 28, fontWeight: 600, color: spotColor }}>
            {spotShown != null ? formatStrikeLevel(spotShown) : "—"}
          </span>
          <span style={{ fontSize: 10, fontWeight: 400, color: GRAY }}>{symbol.replace(/^\$/, "")} futures</span>
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <button
        type="button"
        data-at-glance-top
        className="at-glance w-full px-2 py-1 text-left shrink-0"
        style={{ background: BG_EXP_BAR, borderBottom: `1px solid ${BORDER}` }}
        onClick={toggleCompact}
      >
        <div className="flex items-center justify-between gap-1 num" style={NUM_FEAT}>
          <span style={{ fontSize: 12, fontWeight: 500, color: fromOpen != null && fromOpen < 0 ? DOWN_TEXT : UP }}>
            {fromOpen != null ? `${fromOpen >= 0 ? "▲" : "▼"}${Math.abs(fromOpen).toFixed(mode === "stock" ? 2 : 1)}` : "—"}
          </span>
          <span style={{ fontSize: 26, fontWeight: 600, color: spotColor }}>
            {spotShown != null ? formatStrikeLevel(spotShown) : "—"}
          </span>
          <span style={{ fontSize: 10, color: GRAY, fontWeight: 400 }}>{flowLine}</span>
        </div>
      </button>
    );
  }

  return (
    <Pane
      data-at-glance-top
      className="at-glance px-2 py-0.5 shrink-0"
      style={{ background: BG_EXP_BAR, borderBottom: `1px solid ${BORDER}`, maxHeight: "min(152px, 20vh)" }}
    >
      <Pane className="flex items-center gap-1.5" style={{ minHeight: 18 }}>
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
              {Math.abs(fromOpen).toFixed(mode === "stock" ? 2 : 1)}
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

      <Pane className="grid gap-x-1 items-end" style={{ gridTemplateColumns: "1fr auto 1fr", minHeight: 40 }}>
        <Pane className="num" style={{ ...NUM_FEAT, fontSize: 20, fontWeight: 500, color: PUT_WALL, lineHeight: 1 }}>
          {zones.putWall != null ? formatStrikeLevel(zones.putWall) : "—"}
        </Pane>
        <Pane className="text-center px-0.5">
          <Pane style={{ fontSize: 8, fontWeight: 400, letterSpacing: "0.05em", color: GRAY }}>
            {symbol.replace(/^\$/, "")}
          </Pane>
          <Pane className="num" style={{ ...NUM_FEAT, fontSize: 28, fontWeight: 600, color: spotColor, lineHeight: 1 }}>
            {spotShown != null ? formatStrikeLevel(spotShown) : "—"}
          </Pane>
        </Pane>
        <Pane className="num text-right" style={{ ...NUM_FEAT, fontSize: 20, fontWeight: 500, color: GOLD, lineHeight: 1 }}>
          {zones.callWall != null ? formatStrikeLevel(zones.callWall) : "—"}
        </Pane>
      </Pane>

      {flowLine ? (
        <Pane
          className="num truncate"
          style={{ ...NUM_FEAT, fontSize: 10, fontWeight: 500, color: WHITE, lineHeight: 1.25, paddingBottom: 2 }}
        >
          {flowLine}
        </Pane>
      ) : null}
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