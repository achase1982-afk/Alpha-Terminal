import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { FIXTURE, fixtureHistory } from "./fixture";
import {
  dayMove,
  formatAge,
  formatGross,
  formatNet,
  formatPct,
  formatSignedPts,
  formatSpot,
  formatWall,
  fromOpenPoints,
  pathStats,
  premiumNet,
  priceNotFollowing,
  railPositions,
  resolveTrend,
  SIDE_LABEL,
  wallDistance,
  wallDrift,
  type GrossQuad,
  type PnfResult,
  type TrendReading,
} from "./math";
import { useGlanceLive } from "./useGlanceLive";
import "./glance.css";

type Mode = "live" | "fixture";

function readMode(): Mode {
  try {
    return window.localStorage.getItem("glance-mode") === "fixture" ? "fixture" : "live";
  } catch {
    return "live";
  }
}

function moneyOr(n: number | null): string {
  return formatGross(n);
}

function signedClass(n: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

function History({ values, color, max }: { values: readonly (number | null)[]; color: string; max: number }) {
  return (
    <div className="hist" aria-hidden>
      {values.map((v, i) =>
        v == null ? (
          <b key={i} className="gap" />
        ) : (
          <b key={i} style={{ height: `${max > 0 ? Math.max(2, (v / max) * 22) : 2}px`, background: color }} />
        ),
      )}
    </div>
  );
}

function FlowSide({
  name,
  sold,
  bought,
  soldHist,
  boughtHist,
  scale,
  histMax,
}: {
  name: string;
  sold: number | null;
  bought: number | null;
  soldHist: readonly (number | null)[];
  boughtHist: readonly (number | null)[];
  scale: number;
  histMax: number;
}) {
  const soldW = sold != null && scale > 0 ? Math.min(100, (sold / scale) * 100) : 0;
  const boughtW = bought != null && scale > 0 ? Math.min(100, (bought / scale) * 100) : 0;
  return (
    <div className="flow-row">
      <div className="side-name">{name}</div>
      <div className="amt down num">
        ▼ {moneyOr(sold)}
        <History values={soldHist} color="#f23645" max={histMax} />
      </div>
      <div className="track" aria-hidden>
        <span className="sold" style={{ width: `${soldW}%` }} />
        <span className="bought" style={{ width: `${boughtW}%` }} />
        <i />
      </div>
      <div className="amt up num">
        ▲ {moneyOr(bought)}
        <History values={boughtHist} color="#00d166" max={histMax} />
      </div>
    </div>
  );
}

function spark(values: readonly number[], color: string) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 26 - ((v - min) / span) * 24;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

export default function GlancePage() {
  const live = useGlanceLive();
  const [mode, setMode] = useState<Mode>(readMode);
  const [trendOn, setTrendOn] = useState(() => {
    try {
      return window.localStorage.getItem("glance-trend") !== "0";
    } catch {
      return true;
    }
  });
  const [grossMin, setGrossMin] = useState(() => {
    try {
      const n = Number(window.localStorage.getItem("glance-pnf-gross"));
      return Number.isFinite(n) && n > 0 ? n : 10;
    } catch {
      return 10;
    }
  });
  const [responseMin, setResponseMin] = useState(() => {
    try {
      const n = Number(window.localStorage.getItem("glance-pnf-pts"));
      return Number.isFinite(n) && n > 0 ? n : 3;
    } catch {
      return 3;
    }
  });
  const [panel, setPanel] = useState<"settings" | "details" | null>(null);
  const [held, setHeld] = useState<TrendReading | null>(null);
  const [lastPnf, setLastPnf] = useState<PnfResult | null>(null);

  useEffect(() => {
    document.title = "Alpha Terminal · SPX 0DTE Glance";
  }, []);

  const fixture = mode === "fixture";
  const spot = fixture ? FIXTURE.spot : live.spot;
  const prev = fixture ? FIXTURE.previousClose : live.previousClose;
  const day = dayMove(spot, prev);
  const open = fixture ? FIXTURE.rthOpen : live.open;
  const fromOpen = fromOpenPoints(spot, open);
  const high = fixture ? FIXTURE.high : live.high;
  const low = fixture ? FIXTURE.low : live.low;
  const vix = fixture ? FIXTURE.vix : live.vix;
  const vixOpen = fixture ? FIXTURE.vixOpen : live.vixOpen;
  const vixDelta = fromOpenPoints(vix, vixOpen);
  const vixPct = vix != null && vixOpen != null && vixOpen > 0 ? (100 * (vix - vixOpen)) / vixOpen : null;

  const flow1 = fixture ? FIXTURE.flow.m1 : live.flow1;
  const flow5 = fixture ? FIXTURE.flow.m5 : live.flow5;
  const flow15 = fixture ? FIXTURE.flow.m15 : live.flow15;
  const flowSession = fixture ? FIXTURE.flow.session : live.flowSession;
  const windows = fixture ? FIXTURE.windows : live.windows;

  const fixtureM10 = pathStats(FIXTURE.closes.slice(-11));
  const fixtureM15 = pathStats(FIXTURE.closes.slice(-16));
  const trend = useMemo(() => {
    if (!trendOn) return null;
    if (fixture) {
      return resolveTrend({
        m10: fixtureM10,
        m15: fixtureM15,
        held: null,
      });
    }
    return resolveTrend({
      m10: live.m10 ? { move: live.m10.move, efficiency: live.m10.efficiency } : null,
      m15: live.m15 ? { move: live.m15.move, efficiency: live.m15.efficiency } : null,
      held,
    });
  }, [fixture, fixtureM10, fixtureM15, held, live.m10, live.m15, trendOn]);

  useEffect(() => {
    if (fixture) return;
    if (!trend) {
      if (live.m10 && live.m15) setHeld(null);
      return;
    }
    setHeld((prev) =>
      prev &&
      prev.horizon === trend.horizon &&
      prev.direction === trend.direction &&
      prev.move === trend.move &&
      prev.efficiency === trend.efficiency
        ? prev
        : trend,
    );
  }, [fixture, live.m10, live.m15, trend]);

  const pnfNow = priceNotFollowing(flow5, windows.m5 ?? null, grossMin * 1_000_000, responseMin);
  useEffect(() => {
    if (pnfNow.status === "incomplete") return;
    setLastPnf((prev) =>
      prev &&
      prev.status === pnfNow.status &&
      prev.delta5 === pnfNow.delta5 &&
      prev.side === pnfNow.side &&
      prev.sideUsd === pnfNow.sideUsd &&
      prev.response === pnfNow.response
        ? prev
        : pnfNow,
    );
  }, [pnfNow]);
  const pnf = pnfNow.status === "incomplete" ? lastPnf : pnfNow;

  const scale = Math.max(flow1.cb ?? 0, flow1.cs ?? 0, flow1.pb ?? 0, flow1.ps ?? 0, 1);
  const hist = fixture
    ? {
        cs: fixtureHistory(FIXTURE.flow.m1.cs!, 1),
        cb: fixtureHistory(FIXTURE.flow.m1.cb!, 2),
        ps: fixtureHistory(FIXTURE.flow.m1.ps!, 3),
        pb: fixtureHistory(FIXTURE.flow.m1.pb!, 4),
      }
    : {
        cs: Array<number | null>(15).fill(null),
        cb: Array<number | null>(15).fill(null),
        ps: Array<number | null>(15).fill(null),
        pb: Array<number | null>(15).fill(null),
      };
  const histMax = Math.max(
    1,
    ...hist.cs.map((v) => v ?? 0),
    ...hist.cb.map((v) => v ?? 0),
    ...hist.ps.map((v) => v ?? 0),
    ...hist.pb.map((v) => v ?? 0),
  );

  const callOi = fixture ? FIXTURE.walls.callOi.now : (live.zones?.callWall ?? null);
  const putOi = fixture ? FIXTURE.walls.putOi.now : (live.zones?.putWall ?? null);
  const callOiOpen = fixture ? FIXTURE.walls.callOi.open : null;
  const putOiOpen = fixture ? FIXTURE.walls.putOi.open : null;
  const callVol = fixture ? FIXTURE.walls.callVol.now : null;
  const putVol = fixture ? FIXTURE.walls.putVol.now : null;
  const callVolOpen = fixture ? FIXTURE.walls.callVol.open : null;
  const putVolOpen = fixture ? FIXTURE.walls.putVol.open : null;
  const flip = fixture ? FIXTURE.flip : (live.zones?.flip ?? null);
  const lowZone = fixture ? FIXTURE.lowZoneTop : live.lowZone;
  const highZone = fixture ? FIXTURE.highZoneBottom : live.highZone;
  const zonesInverted = lowZone != null && highZone != null && lowZone >= highZone;

  const rail = useMemo(() => {
    if (spot == null) return [];
    const points = [
      { id: "spot", price: spot },
      callOi != null ? { id: "callOi", price: callOi } : null,
      putOi != null ? { id: "putOi", price: putOi } : null,
      callVol != null ? { id: "callVol", price: callVol } : null,
      putVol != null ? { id: "putVol", price: putVol } : null,
      flip != null ? { id: "flip", price: flip } : null,
      high != null ? { id: "high", price: high } : null,
      low != null ? { id: "low", price: low } : null,
    ].filter((p): p is { id: string; price: number } => p != null);
    return railPositions(spot, points);
  }, [callOi, callVol, flip, high, low, putOi, putVol, spot]);

  const tracePx = fixture ? FIXTURE.closes : live.closes;
  const traceNet = fixture
    ? [FIXTURE.nets.session ?? 0, (FIXTURE.nets.session ?? 0) * 0.4, FIXTURE.nets.m15 ?? 0, FIXTURE.nets.m5 ?? 0]
    : [];

  function row(label: string, quad: GrossQuad) {
    return (
      <tr>
        <td>{label}</td>
        <td className="down num">{moneyOr(quad.cs)}</td>
        <td className="up num">{moneyOr(quad.cb)}</td>
        <td className="down num">{moneyOr(quad.ps)}</td>
        <td className="up num">{moneyOr(quad.pb)}</td>
      </tr>
    );
  }

  function wallRow(label: string, tone: string, now: number | null, baseline: number | null, baselineNote: string) {
    const dist = wallDistance(now, spot);
    const drift = wallDrift(now, baseline);
    return (
      <tr>
        <td className={tone}>{label}</td>
        <td className={`wall-now num ${tone}`}>{formatWall(now)}</td>
        <td className="num">{baseline == null ? "—" : `${formatWall(baseline)} ${baselineNote}`}</td>
        <td className="num">{formatSignedPts(drift, 0)}</td>
        <td className="num">{formatSignedPts(dist, 2)}</td>
      </tr>
    );
  }

  const gex = fixture ? FIXTURE.gex : (live.zones?.netGexUsdPer1Pct ?? null);
  const env = fixture ? "amplifying" : live.zones?.env;

  return (
    <div className="glance" data-testid="spx-glance" data-mode={mode}>
      <header className="cmd">
        <div className="brand">
          ALPHA
          <em>TERMINAL</em>
        </div>
        <h1>SPX 0DTE Glance</h1>
        <span className="sub">ET</span>
        <span className="spacer" />
        <Link href="/">Mobile</Link>
        <button
          type="button"
          data-on={fixture ? "true" : "false"}
          onClick={() => {
            const next = fixture ? "live" : "fixture";
            setMode(next);
            try {
              window.localStorage.setItem("glance-mode", next);
            } catch {
              /* ignore */
            }
          }}
        >
          {fixture ? "Fixture" : "Live"}
        </button>
        <button type="button" onClick={() => setPanel(panel === "settings" ? null : "settings")}>
          Settings
        </button>
        <button type="button" onClick={() => setPanel(panel === "details" ? null : "details")}>
          Details
        </button>
      </header>

      <section className="headline" aria-label="Market headline">
        <div>
          <span className="k">SPX {formatAge(fixture ? 12 : live.spotAgeSec)}</span>
          <div className="spot num">{formatSpot(spot)}</div>
        </div>
        <div>
          <span className="k">{day == null ? "DAY —" : day.points < 0 ? "DAY DOWN" : "DAY UP"}</span>
          <div className={`day-pct num ${signedClass(day?.points ?? null)}`}>{formatPct(day?.percent ?? null)}</div>
          <div className={`support num ${signedClass(day?.points ?? null)}`}>{formatSignedPts(day?.points ?? null)} vs close</div>
        </div>
        <div>
          <span className="k">From open</span>
          <div className={`open-pts num ${signedClass(fromOpen)}`}>{formatSignedPts(fromOpen, 2)}</div>
          <div className="support num">Open {formatSpot(open)}</div>
        </div>
        <div>
          <span className="k">VIX {formatAge(fixture ? 12 : live.vixAgeSec)}</span>
          <div className="vix-px num">{vix == null ? "—" : vix.toFixed(2)}</div>
          <div className={`support num ${signedClass(vixDelta)}`}>
            {formatSignedPts(vixDelta)} · {formatPct(vixPct)} from open
          </div>
          <div className="support num">
            L {fixture ? FIXTURE.vixLow.toFixed(2) : live.vixLow == null ? "—" : live.vixLow.toFixed(2)} · H{" "}
            {fixture ? FIXTURE.vixHigh.toFixed(2) : live.vixHigh == null ? "—" : live.vixHigh.toFixed(2)}
          </div>
        </div>
        <div>
          <span className="k">Session range</span>
          <div className="hl num">
            H {formatSpot(high)} <span className="when">{fixture ? FIXTURE.highMinute : (live.highMinute ?? "")} ET</span>
          </div>
          <div className="hl num">
            L {formatSpot(low)} <span className="when">{fixture ? FIXTURE.lowMinute : (live.lowMinute ?? "")} ET</span>
          </div>
        </div>
      </section>

      <div className="main">
        <div className="left">
          <section className="block" aria-label="Flow">
            <h2>
              <span>Flow now · 1m · {fixture ? FIXTURE.scope : "Scope follows source"}</span>
              <span>{fixture ? "Age 30s · fixture" : formatAge(live.flowAgeSec)}</span>
            </h2>
            <FlowSide name="Calls" sold={flow1.cs} bought={flow1.cb} soldHist={hist.cs} boughtHist={hist.cb} scale={scale} histMax={histMax} />
            <FlowSide name="Puts" sold={flow1.ps} bought={flow1.pb} soldHist={hist.ps} boughtHist={hist.pb} scale={scale} histMax={histMax} />
            <table className="table">
              <thead>
                <tr>
                  <th>Window</th>
                  <th>Calls sold</th>
                  <th>Calls bought</th>
                  <th>Puts sold</th>
                  <th>Puts bought</th>
                </tr>
              </thead>
              <tbody>
                {row("5m", flow5)}
                {row("15m", flow15)}
                {row(fixture ? "Since 09:30" : "Since 09:30", flowSession)}
              </tbody>
            </table>
            <div className="nets num">
              <span>5m net {formatNet(premiumNet(flow5))}</span>
              <span>15m net {formatNet(premiumNet(flow15))}</span>
              <span>Session net {formatNet(premiumNet(flowSession))}</span>
            </div>
            <div className="traces">
              {spark(traceNet, "#cbd5e1")}
              {spark(tracePx, "#fff")}
            </div>
          </section>

          <section className="block behavior" aria-label="Price behavior">
            <h2>
              <span>Price behavior</span>
              <span>{fixture ? "Matched to fixture cutoff" : "Minute closes"}</span>
            </h2>
            <div className="windows num">
              {(
                [
                  ["1m", windows.m1],
                  ["5m", windows.m5],
                  ["10m", windows.m10],
                  ["15m", windows.m15],
                  ["20m", windows.m20],
                ] as const
              ).map(([label, pts]) => (
                <div key={label}>
                  <span>{label}</span>
                  <b className={signedClass(pts)}>{formatSignedPts(pts, 1)}</b>
                </div>
              ))}
            </div>
            <div className="chips">
              {trendOn && trend ? (
                <div className={`trend num ${trend.direction < 0 ? "down" : "up"}`}>
                  {trend.horizon}m {trend.direction < 0 ? "▼" : "▲"} {formatSignedPts(trend.move, 1)} pts · E {trend.efficiency.toFixed(2)}
                </div>
              ) : (
                <div className="trend" style={{ color: "#9aa6b8" }}>
                  {trendOn ? "Trend —" : "Trend off"}
                </div>
              )}
              <div className="pnf" style={{ visibility: pnf?.status === "tag" ? "visible" : "hidden" }}>
                PRICE NOT FOLLOWING
                <small className="num">
                  {pnf?.side ? `5m · ${SIDE_LABEL[pnf.side]} ${formatGross(pnf.sideUsd)} · SPX ${formatSignedPts(pnf.delta5, 1)} pts` : "5m"}
                </small>
              </div>
            </div>
          </section>
        </div>

        <section className="block levels" aria-label="Levels">
          <h2>
            <span>Levels</span>
            <span>
              {fixture ? "Fixture walls" : live.zones?.levelSource === "unusual_whales" ? "OI gamma" : "Snapshot"} · {formatAge(fixture ? 20 : live.zonesAgeSec)}
            </span>
          </h2>
          <table>
            <thead>
              <tr>
                <th>Wall</th>
                <th>Now</th>
                <th>At open</th>
                <th>Move</th>
                <th>Distance</th>
              </tr>
            </thead>
            <tbody>
              {wallRow("Call OI", "call", callOi, callOiOpen, fixture ? "open" : "")}
              {wallRow("Call volume", "call", callVol, callVolOpen, fixture ? "open" : "")}
              {wallRow("Put OI", "put", putOi, putOiOpen, fixture ? "open" : "")}
              {wallRow("Put volume", "put", putVol, putVolOpen, fixture ? "open" : "")}
            </tbody>
          </table>
          <div className="meta-row">
            <span className="flip">Gamma flip {formatWall(flip)}</span>
            <span className="num">{spot != null && flip != null ? `${formatSignedPts(spot - flip)} vs spot` : "—"}</span>
          </div>
          <div className="meta-row">
            <span>Low zone top {lowZone == null ? "—" : formatSpot(lowZone)}</span>
            <span>High zone bottom {highZone == null ? "—" : formatSpot(highZone)}</span>
          </div>
          {zonesInverted ? <div className="support">Zone pair invalid</div> : null}
          <div className="meta-row num">
            <span>GEX {gex == null ? "—" : formatNet(gex)}</span>
            <span>{env === "amplifying" ? "AMPLIFYING · model" : env === "damping" ? "STABILIZING · model" : "Model sign"}</span>
          </div>
          <div className="rail" aria-label="Price rail">
            <i className="axis" />
            {rail.map((mark) => {
              const lane = mark.id.endsWith("Vol") ? "lane-1" : mark.id === "high" || mark.id === "low" ? "lane-2" : "lane-0";
              const color =
                mark.id === "spot" ? "#fff" : mark.id.startsWith("call") ? "#ffb800" : mark.id.startsWith("put") ? "#14b8a6" : mark.id === "flip" ? "#a78bfa" : "#94a3b8";
              return (
                <span key={mark.id} className={`mark ${lane}`} style={{ left: `${mark.x * 100}%`, background: color }} title={`${mark.id} ${formatSpot(mark.price)}`}>
                  <em>{mark.id === "spot" ? "SPX" : mark.id}</em>
                </span>
              );
            })}
          </div>
        </section>
      </div>

      <footer className="footer">
        <span>{fixture ? FIXTURE.label : "Live readings stay up with their own age. No session gate."}</span>
        <span>Sold left · Bought right · net = CB − CS − PB + PS</span>
      </footer>

      {panel ? (
        <aside className="sheet" role="dialog" aria-label={panel}>
          <h3>{panel === "settings" ? "Settings" : "Details"}</h3>
          {panel === "settings" ? (
            <>
              <label>
                Trend detector
                <button
                  type="button"
                  data-on={trendOn ? "true" : "false"}
                  onClick={() => {
                    const next = !trendOn;
                    setTrendOn(next);
                    try {
                      window.localStorage.setItem("glance-trend", next ? "1" : "0");
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  {trendOn ? "ON" : "OFF"}
                </button>
              </label>
              <label>
                Gross side &gt; $M / 5m
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={grossMin}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n)) return;
                    setGrossMin(n);
                    try {
                      window.localStorage.setItem("glance-pnf-gross", String(n));
                    } catch {
                      /* ignore */
                    }
                  }}
                />
              </label>
              <label>
                Response &lt; SPX pts
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={responseMin}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n)) return;
                    setResponseMin(n);
                    try {
                      window.localStorage.setItem("glance-pnf-pts", String(n));
                    } catch {
                      /* ignore */
                    }
                  }}
                />
              </label>
              <p>Five minutes is fixed. These thresholds describe the tag. They do not place or block an order.</p>
            </>
          ) : (
            <>
              <p>Fixture numbers are the section 16.1 demonstration. Live mode never substitutes them.</p>
              <ul>
                <li>SPX and VIX come from the existing quote stream. Day change uses the quote close when that field is present.</li>
                <li>Open, high, and low minutes come from Schwab 1-minute bars when that route returns them. A bar that does not start at 09:30 is not labeled the RTH open.</li>
                <li>1m, 5m, and 15m gross amounts come from the existing flow stream. Since 09:30 stays blank on live until that session total is actually covered.</li>
                <li>Call and put walls are the gamma snapshot’s single basis, shown on the OI rows. Volume rows stay blank rather than copying those strikes.</li>
                <li>PRICE NOT FOLLOWING needs all four 5m gross amounts and a matching 5-minute SPX change. The last evaluated result stays visible when a newer window is incomplete.</li>
                <li>Flow connection: {fixture ? "fixture" : live.flowConnection}. Gamma source: {fixture ? "fixture" : (live.zones?.levelSource ?? "unavailable")}.</li>
              </ul>
            </>
          )}
          <button type="button" onClick={() => setPanel(null)}>
            Close
          </button>
        </aside>
      ) : null}
    </div>
  );
}
