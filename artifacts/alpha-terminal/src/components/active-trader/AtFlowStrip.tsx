import { memo, useState, type CSSProperties } from "react";
import type { DeskFlowAggregate } from "@/lib/active-trader/deskFlowAggregator";
import type { DeskNetPremiumGlance } from "@/lib/active-trader/deskFlowNetPremium";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { fmtGlanceFlowAmount } from "@/lib/active-trader/deskFlowMoneyFormat";
import { detectFlowFlipExperimental, flowPremiumNet, flowPremiumNetSign } from "@/lib/active-trader/atFlowPremiumNet";
import { formatFlowFreshnessBadge, resolveFlowFreshness } from "@/lib/active-trader/atFlowStripFreshness";
import { loadAtFlowStripTab, saveAtFlowStripTab, type AtFlowStripTab } from "@/lib/active-trader/atFlowStripTab";
import { resolveGammaFlipDisplay } from "@/lib/active-trader/atGlanceWallDisplay";
import { AT_LADDER_GAMMA } from "@/lib/active-trader/atLadderLayout";
import { GOLD, PUT_WALL, WHITE } from "@/components/options/optionsTheme";
import "./AtFlowStrip.css";

const NUM: CSSProperties = {
  fontFeatureSettings: '"tnum" 1, "ss01" 1',
  fontVariantNumeric: "tabular-nums",
};

function fmtUsd(n: number | null, dash: boolean): string {
  if (dash || n == null || !Number.isFinite(n)) return "\u2014";
  const core = fmtGlanceFlowAmount(n);
  return core.startsWith("$") ? core : `$${core}`;
}

function barPair(buy: number, sell: number) {
  const gross = buy + sell;
  const buyPct = gross > 0 ? buy / gross : 0;
  const sellPct = gross > 0 ? sell / gross : 0;
  return { buyPct, sellPct };
}

function FlowSideRow({ side, buy, sell, dash }: { side: string; buy: number; sell: number; dash: boolean }) {
  const { buyPct, sellPct } = barPair(buy, sell);
  return (
    <div className="at-flow-strip-row" data-at-flow-side={side}>
      <span style={{ fontWeight: 600, color: "#a4a6aa", fontSize: 12 }}>{side}</span>
      <span className="at-flow-buy num" style={NUM}>
        {fmtUsd(buy, dash)}
      </span>
      <div className="at-flow-strip-bar-wrap" aria-hidden>
        <span className="buy" style={{ width: `${buyPct * 100}%` }} />
        <span className="sell" style={{ width: `${sellPct * 100}%` }} />
      </div>
      <span className="at-flow-sell num" style={NUM}>
        {fmtUsd(sell, dash)}
      </span>
    </div>
  );
}

export type AtFlowStripProps = {
  windowSec: number;
  aggregate: DeskFlowAggregate;
  netPremium: DeskNetPremiumGlance;
  zones: ZoneModel;
};

export const AtFlowStrip = memo(function AtFlowStrip({
  windowSec,
  aggregate,
  netPremium,
  zones,
}: AtFlowStripProps) {
  const [tab, setTab] = useState<AtFlowStripTab>(() => loadAtFlowStripTab());
  /** Show live feed figures even after hours; only blank when the stream kind is unsupported. */
  const dash = netPremium.unsupported;
  const rx = aggregate.lastRxMs;
  const freshBadge = formatFlowFreshnessBadge(resolveFlowFreshness(rx));
  const idx = aggregate.index;

  const nowCb = netPremium.grossCallsBuy;
  const nowCs = netPremium.grossCallsSell;
  const nowPb = netPremium.grossPutsBuy;
  const nowPs = netPremium.grossPutsSell;
  const nowNet = flowPremiumNet(nowCb, nowCs, nowPb, nowPs);

  const sessCb = idx?.callBuyHr ?? 0;
  const sessCs = idx?.callSellHr ?? 0;
  const sessPb = idx?.putBuyHr ?? 0;
  const sessPs = idx?.putSellHr ?? 0;
  const sessionNet = flowPremiumNet(sessCb, sessCs, sessPb, sessPs);

  const net5m = idx
    ? flowPremiumNet(idx.callBuy5m, idx.callSell5m, idx.putBuy5m, idx.putSell5m)
    : 0;
  const net15m = idx
    ? flowPremiumNet(idx.callBuy15m, idx.callSell15m, idx.putBuy15m, idx.putSell15m)
    : 0;
  const flip = detectFlowFlipExperimental(sessionNet, net15m);

  function pickTab(next: AtFlowStripTab) {
    setTab(next);
    saveAtFlowStripTab(next);
  }

  const sessionSign = flowPremiumNetSign(sessionNet);
  const sessionSignLabel =
    sessionSign === "bullish" ? "bullish premium" : sessionSign === "bearish" ? "bearish premium" : "flat";

  return (
    <div className="at-flow-strip" data-at-flow-strip="" data-at-flow-tab={tab} data-at-glance-flow-band="">
      <div className="at-flow-strip-tabs" role="group" aria-label="Flow strip view">
        {(
          [
            ["now", "Now"],
            ["session", "Session"],
            ["levels", "Levels"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => pickTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="at-flow-strip-body">
        {tab === "now" ? (
          <div className="at-flow-strip-now">
            <div className="at-flow-strip-now-head">
              <span data-at-flow-now="" style={{ fontWeight: 600, color: WHITE, fontSize: 12 }}>
                Flow now · {windowSec}s
              </span>
              <span
                className="num"
                style={{
                  ...NUM,
                  fontSize: 12,
                  color:
                    sessionSign === "bearish" ? "#ff7164" : sessionSign === "bullish" ? "#5df1a0" : "#a4a6aa",
                }}
              >
                Sess net {fmtUsd(sessionNet, dash)}
              </span>
            </div>
            <FlowSideRow side="CALL" buy={nowCb} sell={nowCs} dash={dash} />
            <FlowSideRow side="PUT" buy={nowPb} sell={nowPs} dash={dash} />
            <span className="sr-only">Window net {fmtUsd(nowNet, dash)}</span>
          </div>
        ) : null}

        {tab === "session" ? (
          <div className="at-flow-strip-session-grid">
            <span>
              CB <b className="at-flow-buy">{fmtUsd(sessCb, dash)}</b>
            </span>
            <span>
              CS <b className="at-flow-sell">{fmtUsd(sessCs, dash)}</b>
            </span>
            <span>
              PB <b className="at-flow-buy">{fmtUsd(sessPb, dash)}</b>
            </span>
            <span>
              PS <b className="at-flow-sell">{fmtUsd(sessPs, dash)}</b>
            </span>
            <span style={{ gridColumn: "1 / -1", fontWeight: 600, color: WHITE }}>
              Since open net {fmtUsd(sessionNet, dash)} · {sessionSignLabel}
            </span>
            <span style={{ gridColumn: "1 / -1" }}>
              5m {fmtUsd(net5m, dash)} · 15m {fmtUsd(net15m, dash)}
            </span>
          </div>
        ) : null}

        {tab === "levels" ? (
          <div className="at-flow-strip-levels">
            <span>
              Call wall <b style={{ color: GOLD }}>{zones.callWall ?? "\u2014"}</b>
            </span>
            <span>
              Put wall <b style={{ color: PUT_WALL }}>{zones.putWall ?? "\u2014"}</b>
            </span>
            <span>
              Gamma flip{" "}
              <b className="num" style={{ ...NUM, color: AT_LADDER_GAMMA }}>
                {resolveGammaFlipDisplay(zones)}
              </b>
            </span>
          </div>
        ) : null}
      </div>

      <div className="at-flow-strip-footer" aria-live="polite">
        {flip ? <span className="at-flow-strip-flags">FLIP · EXPERIMENTAL </span> : null}
        {freshBadge ? <span data-at-flow-freshness="">{freshBadge}</span> : null}
      </div>
    </div>
  );
});