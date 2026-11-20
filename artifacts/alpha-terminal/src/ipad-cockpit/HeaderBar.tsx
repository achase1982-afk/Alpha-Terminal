import { useEffect, useState } from "react";
import { marketClock } from "./clock";
import { formatChange, formatSpot, formatSignedPts, toneForSigned } from "./format";
import type { IpadScenario } from "./scenarios";
import type { IpadExpiry, IpadMetric } from "./types";

function MarketClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const clock = marketClock(now);
  return (
    <div className="mkt num" aria-label="Market status">
      <span className={clock.open ? "live-dot" : "dead-dot"} />
      <span className={clock.open ? "mkt-open" : "mkt-closed"}>{clock.statusLabel}</span>
      <span className="mkt-count">
        {clock.countdownLabel} {clock.countdown}
      </span>
      <span className="mkt-clock hide-narrow">{clock.clock}</span>
    </div>
  );
}

export function HeaderBar({
  scenario,
  expiry,
  metric,
  onExpiry,
  onMetric,
  onScenario,
}: {
  scenario: IpadScenario;
  expiry: IpadExpiry;
  metric: IpadMetric;
  onExpiry: () => void;
  onMetric: (metric: IpadMetric) => void;
  onScenario: () => void;
}) {
  const market = scenario.market;
  const vixUp = market.vixChange > 0;
  return (
    <header id="zone1">
      <div className="hz-left">
        <div className="brand" aria-label="Alpha Terminal">
          <div className="brand-alpha">ALPHA</div>
          <div className="brand-terminal">TERMINAL</div>
        </div>
        <div className="vdiv" />
        <div className="hz-id">
          <div className="mode-badge">IPAD ACTIVE TRADER</div>
          <MarketClock />
        </div>
      </div>
      <div className="hz-center">
        <div className="ticker">
          <span className="sym">SPX</span>
          <span className="spot num">{formatSpot(market.spot)}</span>
          <span className="chg num" style={{ color: toneForSigned(market.changePts) }}>
            {formatChange(market.changePts, market.changePct)}
          </span>
        </div>
        <div className="hz-meta">
          <div className="sess num">
            <span>
              <span className="lbl">Open</span>
              <span className="px" style={{ color: toneForSigned(market.fromOpen) }}>
                {formatSignedPts(market.fromOpen)}
              </span>
            </span>
            <span>
              <span className="lbl">H</span>
              <span className="px">{formatSpot(market.high)}</span>
              <span className="tm">{market.highTime}</span>
            </span>
            <span>
              <span className="lbl">L</span>
              <span className="px">{formatSpot(market.low)}</span>
              <span className="tm">{market.lowTime}</span>
            </span>
          </div>
          <div className="vdiv hide-narrow" />
          <div className="vix num hide-narrow">
            <span className="lbl">VIX</span>
            <span className="vix-px">{market.vix.toFixed(1)}</span>
            <span style={{ color: vixUp ? "var(--bear-red)" : "var(--bull-green)", fontWeight: 700 }}>
              {vixUp ? "▲" : "▼"}
              {Math.abs(market.vixChange).toFixed(1)}
            </span>
            <span className="vix-range">
              ({market.vixLow.toFixed(1)}-{market.vixHigh.toFixed(1)})
            </span>
          </div>
        </div>
      </div>
      <div className="hz-right">
        <button type="button" className="expiry" onClick={onExpiry} aria-label="Cycle expiration">
          {expiry.pill} ▾
        </button>
        <div className="seg" role="group" aria-label="Open interest or volume">
          <button type="button" aria-pressed={metric === "OI"} onClick={() => onMetric("OI")}>
            OI
          </button>
          <button type="button" aria-pressed={metric === "VOL"} onClick={() => onMetric("VOL")}>
            Vol
          </button>
        </div>
        <button
          type="button"
          className="scenario"
          data-mode={scenario.id}
          onClick={onScenario}
          aria-label={scenario.id === "bear" ? "DEMO: BEAR CTRL" : "DEMO: BULL CTRL"}
        >
          {scenario.id === "bear" ? "DEMO: BEAR CTRL" : "DEMO: BULL CTRL"}
        </button>
      </div>
    </header>
  );
}
