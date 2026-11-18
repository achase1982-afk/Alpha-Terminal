import { memo, useMemo, useState, type CSSProperties, type PropsWithChildren } from "react";
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
import { useDeskFlowStream } from "@/hooks/useDeskFlowStream";
import { useQuote } from "@/hooks/useQuote";

const NUM_FEAT: CSSProperties = {
  fontFeatureSettings: '"tnum" 1, "ss01" 1, "cv09" 1',
  fontVariantNumeric: "tabular-nums",
};

function fmtMoneyShort(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toFixed(0);
}

function Spark({ bars, positive }: { bars: number[]; positive: boolean }) {
  const max = Math.max(...bars.map((b) => Math.abs(b)), 1);
  return (
    <div className="flex items-center gap-px h-5" style={{ background: "linear-gradient(#2a2a2e,#2a2a2e) 0 50%/100% 1px no-repeat" }}>
      {bars.slice(-15).map((b, i) => {
        const h = Math.max(2, Math.round((Math.sqrt(Math.abs(b)) / Math.sqrt(max)) * 14));
        const up = positive ? b >= 0 : b <= 0;
        return (
          <i
            key={i}
            style={{
              display: "block",
              width: 6,
              height: h,
              borderRadius: 1,
              alignSelf: up ? "flex-end" : "flex-start",
              background: up ? UP : DOWN_TEXT,
              opacity: i === bars.length - 1 ? 1 : 0.75,
            }}
          />
        );
      })}
    </div>
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
  keepawayStats,
  sessionOpen,
}: AtGlanceTopProps) {
  const [compact, setCompact] = useState(() => loadAtGlanceCompact());
  const mode = resolveAtGlanceMode(symbol);
  const { data: quote } = useQuote(symbol);
  const spotColor = useSpotDirectionColor(underlyingPrice, 250);
  const flow = useDeskFlowStream(symbol, mode === "index" || mode === "stock");

  const spot = underlyingPrice;
  const sessionLo = quote?.low ?? null;
  const sessionHi = quote?.high ?? null;
  const open = sessionOpen ?? quote?.close ?? null;
  const fromOpen =
    spot != null && open != null && Number.isFinite(open) ? spot - open : null;

  const gexStr = formatGexUsd(zones.netGexUsdPer1Pct);
  const env =
    zones.env === "amplifying" ? "Amplifying" : zones.env === "damping" ? "Damping" : zones.env === "near_flip" ? "Near flip" : "";

  const spotPx = typeof window !== "undefined" && window.innerWidth <= 400 ? 40 : 44;
  const wallPx = typeof window !== "undefined" && window.innerWidth <= 400 ? 24 : 28;
  const midPx = typeof window !== "undefined" && window.innerWidth <= 400 ? 22 : 24;

  const railScale = useMemo(() => {
    if (spot == null) return null;
    const pts = [
      keepawayPutLine,
      sessionLo,
      zones.putWall,
      zones.flip,
      spot,
      zones.callWall,
      sessionHi,
      keepawayCallLine,
    ].filter((x): x is number => x != null && Number.isFinite(x));
    if (pts.length < 2) return null;
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const pad = (max - min) * 0.04 || 1;
    return { min: min - pad, max: max + pad };
  }, [spot, keepawayPutLine, keepawayCallLine, sessionLo, sessionHi, zones]);

  const toggleCompact = () => {
    setCompact((c) => {
      const n = !c;
      saveAtGlanceCompact(n);
      return n;
    });
  };

  if (mode === "futures") {
    return (
      <div data-at-glance-top className="at-glance px-3 py-2" style={{ background: BG_EXP_BAR, borderBottom: `2px solid ${BORDER}`, maxHeight: "min(210px, 25vh)" }}>
        <Pane className="text-center" style={{ fontSize: midPx, fontWeight: 500, color: GRAY }}>
          Futures quote + tape — chain in a follow-up PR
        </Pane>
        {spot != null ? (
          <Pane className="text-center num" style={{ fontSize: spotPx, fontWeight: 600, color: spotColor, ...NUM_FEAT }}>
            {formatStrikeLevel(spot)}
          </Pane>
        ) : null}
      </div>
    );
  }

  if (compact) {
    const flowLine =
      flow.kind === "index"
        ? `CALLS BOUGHT ${fmtMoneyShort(flow.display.callsBought5m)} · PUTS SOLD ${fmtMoneyShort(flow.display.putsSold5m)}`
        : flow.kind === "stock"
          ? `LIFT ${fmtMoneyShort(flow.tape.buyersLift5m)} · HIT ${fmtMoneyShort(flow.tape.sellersHit5m)}`
          : "";
    return (
      <button
        type="button"
        data-at-glance-top
        className="at-glance w-full px-3 py-1.5 text-left"
        style={{ background: BG_EXP_BAR, borderBottom: `2px solid ${BORDER}` }}
        onClick={toggleCompact}
      >
        <div className="flex items-center justify-between gap-2 num" style={NUM_FEAT}>
          <span style={{ fontSize: 14, fontWeight: 600, color: fromOpen != null && fromOpen < 0 ? DOWN_TEXT : UP }}>
            {fromOpen != null ? `${fromOpen >= 0 ? "▲" : "▼"} ${Math.abs(fromOpen).toFixed(1)}` : "—"}
          </span>
          <span style={{ fontSize: 12, color: GRAY, fontWeight: 400 }}>{flowLine}</span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-1 num" style={NUM_FEAT}>
          <span style={{ fontSize: 22, fontWeight: 500, color: PUT_WALL }}>{zones.putWall != null ? formatStrikeLevel(zones.putWall) : "—"}</span>
          <span style={{ fontSize: 30, fontWeight: 600, color: spotColor }}>{spot != null ? formatStrikeLevel(spot) : "—"}</span>
          <span style={{ fontSize: 22, fontWeight: 500, color: GOLD }}>{zones.callWall != null ? formatStrikeLevel(zones.callWall) : "—"}</span>
        </div>
      </button>
    );
  }

  return (
    <Pane
      data-at-glance-top
      className="at-glance px-3 overflow-y-auto"
      style={{
        background: BG_EXP_BAR,
        borderBottom: `2px solid ${BORDER}`,
        maxHeight: typeof window !== "undefined" && window.innerWidth <= 400 ? "min(210px, 25vh)" : "min(240px, 25vh)",
      }}
    >
      <Pane className="flex items-center justify-between border-b py-1" style={{ borderColor: BORDER, minHeight: 32 }}>
        <Pane className="num" style={{ ...NUM_FEAT, fontSize: midPx, fontWeight: 500, color: fromOpen != null && fromOpen < 0 ? DOWN_TEXT : fromOpen != null && fromOpen > 0 ? UP : WHITE }}>
          {fromOpen != null ? (
            <>
              {fromOpen >= 0 ? "▲" : "▼"} {Math.abs(fromOpen).toFixed(1)}{" "}
              <span style={{ fontSize: 11, fontWeight: 400, color: GRAY, letterSpacing: "0.06em" }}>FROM OPEN</span>
            </>
          ) : (
            "—"
          )}
        </Pane>
        <Pane className="text-right">
          <Pane className="num" style={{ ...NUM_FEAT, fontSize: midPx, fontWeight: 500, color: WHITE }}>
            {gexStr}
          </Pane>
          {env ? (
            <Pane style={{ fontSize: 11, fontWeight: 500, color: GRAY, letterSpacing: "0.05em" }}>{env}</Pane>
          ) : null}
        </Pane>
        <button type="button" onClick={toggleCompact} style={{ fontSize: 11, color: GRAY }} aria-label="Collapse glance strip">
          −
        </button>
      </Pane>

      <Pane className="grid gap-x-2 py-1" style={{ gridTemplateColumns: "1fr auto 1fr" }}>
        <Pane className="min-w-0">
          <Pane style={{ fontSize: 11, fontWeight: 400, letterSpacing: "0.06em", color: GRAY }}>PUT WALL</Pane>
          <Pane className="num" style={{ ...NUM_FEAT, fontSize: wallPx, fontWeight: 500, color: PUT_WALL, lineHeight: 1.1 }}>
            {zones.putWall != null ? formatStrikeLevel(zones.putWall) : "—"}
          </Pane>
          {mode === "index" && keepawayPutLine != null ? (
            <Pane style={{ fontSize: midPx, fontWeight: 500, color: WHITE }} className="num">
              ≤{formatStrikeLevel(keepawayPutLine)}
              <span style={{ fontSize: 11, color: DOWN_TEXT, marginLeft: 4 }}>PUT SHORTS</span>
            </Pane>
          ) : sessionLo != null ? (
            <Pane style={{ fontSize: midPx, fontWeight: 500, color: WHITE }} className="num">
              LO {formatStrikeLevel(sessionLo)}
            </Pane>
          ) : null}
        </Pane>
        <Pane className="text-center px-1">
          <Pane style={{ fontSize: 11, fontWeight: 400, letterSpacing: "0.06em", color: GRAY }}>{symbol.replace(/^\$/, "")}</Pane>
          <Pane className="num" style={{ ...NUM_FEAT, fontSize: spotPx, fontWeight: 600, color: spotColor, lineHeight: 1.05 }}>
            {spot != null ? formatStrikeLevel(spot) : "—"}
          </Pane>
          {zones.flip != null ? (
            <Pane className="num" style={{ ...NUM_FEAT, fontSize: midPx, fontWeight: 500, color: GAMMA_SCENARIO, marginTop: 2 }}>
              FLIP {formatStrikeLevel(Math.round(zones.flip))}
            </Pane>
          ) : (
            <Pane style={{ fontSize: 13, fontWeight: 500, color: GRAY, marginTop: 2 }}>FLIP none in range</Pane>
          )}
        </Pane>
        <Pane className="min-w-0 text-right">
          <Pane style={{ fontSize: 11, fontWeight: 400, letterSpacing: "0.06em", color: GRAY }}>CALL WALL</Pane>
          <Pane className="num" style={{ ...NUM_FEAT, fontSize: wallPx, fontWeight: 500, color: GOLD, lineHeight: 1.1 }}>
            {zones.callWall != null ? formatStrikeLevel(zones.callWall) : "—"}
          </Pane>
          {mode === "index" && keepawayCallLine != null ? (
            <Pane style={{ fontSize: midPx, fontWeight: 500, color: WHITE }} className="num">
              ≥{formatStrikeLevel(keepawayCallLine)}
              <span style={{ fontSize: 11, color: DOWN_TEXT, marginLeft: 4 }}>CALL SHORTS</span>
            </Pane>
          ) : sessionHi != null ? (
            <Pane style={{ fontSize: midPx, fontWeight: 500, color: WHITE }} className="num">
              HI {formatStrikeLevel(sessionHi)}
            </Pane>
          ) : null}
        </Pane>
      </Pane>

      {railScale && spot != null ? (
        <Pane className="relative h-8 mb-1">
          <Pane className="absolute left-0 right-0 top-5 h-px" style={{ background: BORDER }} />
          <Pane
            className="absolute top-4 h-3"
            style={{
              left: `${((spot - railScale.min) / (railScale.max - railScale.min)) * 100}%`,
              marginLeft: -1,
              width: 0,
              height: 0,
              borderLeft: "7px solid transparent",
              borderRight: "7px solid transparent",
              borderTop: `10px solid ${WHITE}`,
            }}
          />
        </Pane>
      ) : null}

      {flow.kind === "index" ? (
        <Pane style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 4 }}>
          <Pane className="flex justify-between items-center">
            <span style={{ fontSize: 11, fontWeight: 400, color: GRAY, letterSpacing: "0.05em" }}>FLOW</span>
            <span className="rounded px-1.5" style={{ fontSize: 10, fontWeight: 600, color: flow.snapshot.estimated ? GOLD : GRAY, border: `1px solid ${BORDER}` }}>
              {flow.snapshot.estimated ? "est." : "live"}
              {flow.snapshot.delayed ? " · delayed" : ""}
            </span>
          </Pane>
          <Pane className="grid grid-cols-2 gap-3 mt-1">
            <Pane>
              <Pane style={{ fontSize: 12, fontWeight: 500, color: UP }}>▲ CALLS BOUGHT</Pane>
              <Pane className="num" style={{ ...NUM_FEAT, fontSize: 26, fontWeight: 500, color: UP }}>
                +{fmtMoneyShort(flow.display.callsBought1m)}
                <span style={{ fontSize: 12, color: GRAY, marginLeft: 4 }}>1m</span>
              </Pane>
              <Spark bars={flow.display.sparkCalls} positive />
            </Pane>
            <Pane>
              <Pane style={{ fontSize: 12, fontWeight: 500, color: UP }}>▲ PUTS SOLD</Pane>
              <Pane className="num" style={{ ...NUM_FEAT, fontSize: 26, fontWeight: 500, color: UP }}>
                {fmtMoneyShort(flow.display.putsSold1m)}
                <span style={{ fontSize: 12, color: GRAY, marginLeft: 4 }}>1m</span>
              </Pane>
              <Spark bars={flow.display.sparkPuts.map((x) => -Math.abs(x))} positive />
            </Pane>
          </Pane>
          {flow.display.priceNotFollowing ? (
            <Pane className="mt-1 inline-block rounded px-2 py-0.5" style={{ fontSize: 11, fontWeight: 600, background: GOLD, color: "#000" }}>
              PRICE NOT FOLLOWING
            </Pane>
          ) : null}
        </Pane>
      ) : null}

      {flow.kind === "stock" ? (
        <Pane style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 4 }}>
          <Pane className="flex justify-between">
            <span style={{ fontSize: 11, color: GRAY }}>TAPE</span>
            {flow.tape.estimated ? (
              <span style={{ fontSize: 10, color: GOLD }}>est.</span>
            ) : null}
          </Pane>
          <Pane className="grid grid-cols-2 gap-3">
            <Pane>
              <Pane style={{ fontSize: 12, fontWeight: 500, color: UP }}>▲ BUYERS LIFTING ASK</Pane>
              <Pane className="num" style={{ ...NUM_FEAT, fontSize: 24, fontWeight: 500, color: UP }}>
                ${fmtMoneyShort(flow.tape.buyersLift1m)}
              </Pane>
              <Spark bars={flow.tape.sparkBuy} positive />
            </Pane>
            <Pane>
              <Pane style={{ fontSize: 12, fontWeight: 500, color: DOWN_TEXT }}>▼ SELLERS HITTING BID</Pane>
              <Pane className="num" style={{ ...NUM_FEAT, fontSize: 24, fontWeight: 500, color: DOWN_TEXT }}>
                ${fmtMoneyShort(flow.tape.sellersHit1m)}
              </Pane>
              <Spark bars={flow.tape.sparkSell} positive={false} />
            </Pane>
          </Pane>
          <Pane className="mt-1 num" style={{ ...NUM_FEAT, fontSize: 14, fontWeight: 500, color: WHITE }}>
            BID × ASK {quote?.bid?.toFixed(2) ?? "—"} ×{quote?.bidSize != null ? Math.round(quote.bidSize) : "—"} ·{" "}
            {quote?.ask?.toFixed(2) ?? "—"} ×{quote?.askSize != null ? Math.round(quote.askSize) : "—"}
          </Pane>
          <Pane style={{ fontSize: 13, fontWeight: 500, color: GRAY }}>
            VOL {quote?.volume != null ? `${(quote.volume / 1e6).toFixed(1)}M` : "—"} · VWAP — (stream)
          </Pane>
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
    <div
      className={className}
      style={style}
      onClick={onClick}
      role={onClick ? "presentation" : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}