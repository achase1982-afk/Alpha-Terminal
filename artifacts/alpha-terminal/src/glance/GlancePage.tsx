import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuote } from "@/hooks/useQuote";
import { useSpotQuoteTickColor } from "@/lib/active-trader/atSpotDirection";
import { FIXTURE, fixtureHistory } from "./fixture";
import { GlanceLadder } from "./GlanceLadder";
import {
  assignRailLanes,
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
  railLabelShift,
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
          <b key={i} style={{ height: `${max > 0 ? Math.max(2, (v / max) * 12) : 2}px`, background: color }} />
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
      <span className="flow-read buy">
        <span className="flow-words">{name} bought</span>
        <span className="flow-dollars up">{moneyOr(bought)}</span>
      </span>
      <div className="track" aria-hidden>
        <span className="bought" style={{ width: `${boughtW}%` }} />
        <span className="sold" style={{ width: `${soldW}%` }} />
        <i />
      </div>
      <span className="flow-read sell">
        <span className="flow-dollars down">{moneyOr(sold)}</span>
        <span className="flow-words">{name} sold</span>
      </span>
      <div className="flow-hist buy">
        <History values={boughtHist} color="#00d166" max={histMax} />
      </div>
      <div className="flow-hist sell">
        <History values={soldHist} color="#f23645" max={histMax} />
      </div>
    </div>
  );
}

const RAIL_LABEL: Record<string, string> = {
  spot: "SPX",
  callOi: "Call open interest",
  putOi: "Put open interest",
  callVol: "Call volume",
  putVol: "Put volume",
  flip: "Gamma flip",
  high: "High",
  low: "Low",
};

/** Even lanes sit above the dot, odd lanes below, one row apart. */
function railLabelTop(lane: number): number {
  const row = Math.floor(lane / 2);
  return lane % 2 === 0 ? -(20 + row * 22) : 12 + row * 22;
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

function PriceTrace({ points }: { points: readonly { t: number; c: number }[] }) {
  if (points.length < 2) return <div className="trace-empty">Price trace —</div>;
  const min = Math.min(...points.map((p) => p.c));
  const max = Math.max(...points.map((p) => p.c));
  const span = max - min || 1;
  const t0 = points[0]!.t;
  const tw = Math.max(points[points.length - 1]!.t - t0, 1);
  let d = "";
  let pen = false;
  points.forEach((p, i) => {
    const x = ((p.t - t0) / tw) * 100;
    const y = 78 - ((p.c - min) / span) * 70;
    if (i > 0 && p.t - points[i - 1]!.t > 90_000) pen = false;
    d += `${pen ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)} `;
    pen = true;
  });
  return (
    <svg className="trace" viewBox="0 0 100 84" preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke="#fff" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function PulseQuote({ symbol, quote }: { symbol: string; quote: ReturnType<typeof useQuote> }) {
  const last = quote.data?.last;
  const pct = quote.data?.changePct;
  const age = quote.data?.tradeTimeMs != null ? formatAge(Math.max(0, (Date.now() - quote.data.tradeTimeMs) / 1000)) : "Age —";
  return (
    <div className="pulse-cell">
      <span className="k">{symbol}</span>
      <b className="num">{last == null ? "—" : last.toFixed(2)}</b>
      <span className={`num ${signedClass(pct ?? null)}`}>{pct == null ? "day unavailable" : `${formatPct(pct)} day`}</span>
      <span className="sub">{age}</span>
    </div>
  );
}

export default function GlancePage({ embedded = false }: { embedded?: boolean }) {
  const live = useGlanceLive();
  const spxQuote = useQuote("$SPX");
  const spy = useQuote("SPY");
  const qqq = useQuote("QQQ");
  const iwm = useQuote("IWM");
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
    if (embedded) return;
    document.title = "Alpha Terminal · SPX 0DTE Glance";
  }, [embedded]);

  const fixture = mode === "fixture";
  const spotTick = useSpotQuoteTickColor("$SPX", fixture ? null : spxQuote.data, null);
  const streamedSpot = fixture ? FIXTURE.spot : live.spot;
  const spot = streamedSpot ?? (fixture ? FIXTURE.spot : live.lastClose);
  const spotCaption = fixture || streamedSpot != null ? "SPX" : live.lastClose != null ? "Last completed minute" : "SPX";
  const prev = fixture ? FIXTURE.previousClose : live.previousClose;
  const day = dayMove(spot, prev);
  const dayPoints = fixture ? (day?.points ?? null) : live.dayPoints;
  const dayPct = fixture ? (day?.percent ?? null) : live.dayPct;
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
    : live.flowHist;
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
  const callVol = fixture ? FIXTURE.walls.callVol.now : (live.zones?.callWallVol ?? null);
  const putVol = fixture ? FIXTURE.walls.putVol.now : (live.zones?.putWallVol ?? null);
  const callVolOpen = fixture ? FIXTURE.walls.callVol.open : null;
  const putVolOpen = fixture ? FIXTURE.walls.putVol.open : null;
  const flip = fixture ? FIXTURE.flip : (live.zones?.flip ?? null);
  const lowZone = fixture ? FIXTURE.lowZoneTop : live.lowZone;
  const highZone = fixture ? FIXTURE.highZoneBottom : live.highZone;
  const zonesInverted = lowZone != null && highZone != null && lowZone >= highZone;

  const rail = useMemo(() => {
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
  const railLanes = assignRailLanes(rail, 0.32);
  const tracePoints = fixture
    ? FIXTURE.closes.map((c, i) => ({ t: i * 60_000, c }))
    : live.traceBars.map((bar) => ({ t: bar.t, c: bar.c }));

  const tracePx = fixture ? FIXTURE.closes : live.closes;
  const traceNet = fixture
    ? [FIXTURE.nets.session ?? 0, (FIXTURE.nets.session ?? 0) * 0.4, FIXTURE.nets.m15 ?? 0, FIXTURE.nets.m5 ?? 0]
    : [];

  function row(label: string, quad: GrossQuad) {
    return (
      <tr>
        <td>{label}</td>
        <td className="up num">{moneyOr(quad.cb)}</td>
        <td className="down num">{moneyOr(quad.cs)}</td>
        <td className="up num">{moneyOr(quad.pb)}</td>
        <td className="down num">{moneyOr(quad.ps)}</td>
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
    <div className={embedded ? "glance glance-embedded" : "glance"} data-testid="spx-glance" data-mode={mode}>
      <header className="cmd">
        {embedded ? null : (
          <div className="brand">
            ALPHA
            <em>TERMINAL</em>
          </div>
        )}
        <span className="spacer" />
        {embedded ? null : <Link href="/">Mobile</Link>}
        <button type="button" onClick={() => setPanel(panel === "settings" ? null : "settings")}>
          Settings
        </button>
        <button type="button" onClick={() => setPanel(panel === "details" ? null : "details")}>
          Details
        </button>
      </header>

      <section className="headline" aria-label="Market headline">
        <div>
          <span className="k">
            {spotCaption}
            {fixture || live.spotAgeSec != null ? ` ${formatAge(fixture ? 12 : live.spotAgeSec)}` : ""}
          </span>
          <div
            className="spot num"
            data-at-spot-tick={fixture ? "flat" : spotTick.side}
            style={{ color: fixture ? "#fff" : spotTick.color }}
          >
            {formatSpot(spot)}
          </div>
        </div>
        <div className="day-read">
          <span className="k">SPX day</span>
          <div className={`day-pct num ${signedClass(dayPct)}`}>{formatPct(dayPct)}</div>
          <div className={`day-pts num ${signedClass(dayPoints)}`}>
            {dayPoints == null ? "—" : `${formatSignedPts(dayPoints, 0)} points from the close`}
          </div>
        </div>
        <div>
          <span className="k">SPX from the open</span>
          <div className={`open-pts num ${signedClass(fromOpen)}`}>
            {fromOpen == null ? "—" : `${formatSignedPts(fromOpen, 0)} points`}
          </div>
          <div className="support num">Open {formatSpot(open)}</div>
        </div>
        <div>
          <span className="k">Session high</span>
          <div className="hl num">
            <span className="hl-px">{formatSpot(high)}</span>{" "}
            {fixture || live.highMinute ? <span className="when">{fixture ? FIXTURE.highMinute : live.highMinute}</span> : null}
          </div>
          <span className="k">Session low</span>
          <div className="hl num">
            <span className="hl-px">{formatSpot(low)}</span>{" "}
            {fixture || live.lowMinute ? <span className="when">{fixture ? FIXTURE.lowMinute : live.lowMinute}</span> : null}
          </div>
          {spot != null && high != null && low != null ? (
            <div className="support num">
              {formatSignedPts(high - spot, 0)} points under the high · {formatSignedPts(spot - low, 0)} points above the low
            </div>
          ) : null}
        </div>
        <div>
          <span className="k">VIX {fixture || live.vixAgeSec != null ? formatAge(fixture ? 12 : live.vixAgeSec) : ""}</span>
          <div className="vix-px num">{vix == null ? "—" : vix.toFixed(2)}</div>
          <div className={`support num ${signedClass(vixDelta)}`}>{formatSignedPts(vixDelta)} · {formatPct(vixPct)} from open</div>
          <div className="support num">
            VIX low {fixture ? FIXTURE.vixLow.toFixed(2) : live.vixLow == null ? "—" : live.vixLow.toFixed(2)} · VIX high{" "}
            {fixture ? FIXTURE.vixHigh.toFixed(2) : live.vixHigh == null ? "—" : live.vixHigh.toFixed(2)}
          </div>
        </div>
      </section>

      <div className="band">
        <GlanceLadder spot={spot} callWall={callOi} putWall={putOi} flip={flip} />
        <section className="block" aria-label="Flow">
            <h2>
              <span>Flow now</span>
              <span>{fixture ? "Age 30 seconds · sample" : formatAge(live.flowAgeSec)}</span>
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
            <div className="desk-trace">
              <PriceTrace points={tracePoints} />
            </div>
            <div className="chips">
              {trendOn && trend ? (
                <div className={`trend num ${trend.direction < 0 ? "down" : "up"}`}>
                  {trend.horizon} minutes {trend.direction < 0 ? "▼" : "▲"} {formatSignedPts(trend.move, 1)} points · efficiency {trend.efficiency.toFixed(2)}
                </div>
              ) : (
                <div className="trend" style={{ color: "#9aa6b8" }}>
                  {trendOn ? "Trend —" : "Trend off"}
                </div>
              )}
              <div className="pnf" style={{ visibility: pnf?.status === "tag" ? "visible" : "hidden" }}>
                PRICE NOT FOLLOWING
                <small className="num">
                  {pnf?.side ? `5 minutes · ${SIDE_LABEL[pnf.side]} ${formatGross(pnf.sideUsd)} · SPX ${formatSignedPts(pnf.delta5, 1)} points` : "5 minutes"}
                </small>
              </div>
            </div>
            <FlowSide name="Calls" sold={flow1.cs} bought={flow1.cb} soldHist={hist.cs} boughtHist={hist.cb} scale={scale} histMax={histMax} />
            <FlowSide name="Puts" sold={flow1.ps} bought={flow1.pb} soldHist={hist.ps} boughtHist={hist.pb} scale={scale} histMax={histMax} />
            <table className="table">
              <thead>
                <tr>
                  <th>Window</th>
                  <th>Calls bought</th>
                  <th>Calls sold</th>
                  <th>Puts bought</th>
                  <th>Puts sold</th>
                </tr>
              </thead>
              <tbody>
                {row("5 minutes", flow5)}
                {row("15 minutes", flow15)}
                {row(fixture ? "Since 09:30" : "Day", flowSession)}
              </tbody>
            </table>
            <div className="nets num">
              <span>5 minute net {formatNet(premiumNet(flow5))}</span>
              <span>15 minute net {formatNet(premiumNet(flow15))}</span>
              <span>{fixture ? "Session" : "Day"} net {formatNet(premiumNet(flowSession))}</span>
              {!fixture && live.flowUw ? <span>Level 1 estimate {formatNet(premiumNet(live.flowL1Session))}</span> : null}
            </div>
          </section>
      </div>

      <div className="levels-wrap">
        <section className="block levels" aria-label="Levels">
          <h2>
            <span>Levels</span>
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
              {wallRow("Call open interest", "call", callOi, callOiOpen, fixture ? "open" : "")}
              {wallRow("Call volume", "call", callVol, callVolOpen, fixture ? "open" : "")}
              {wallRow("Put open interest", "put", putOi, putOiOpen, fixture ? "open" : "")}
              {wallRow("Put volume", "put", putVol, putVolOpen, fixture ? "open" : "")}
            </tbody>
          </table>
        </section>
        <section className="block levels" aria-label="Level map">
          <div className="meta-row">
            <span className="flip">Gamma flip {flip == null ? "none in range" : formatWall(flip)}</span>
            <span className="num">{spot != null && flip != null ? `${formatSignedPts(spot - flip)} from spot` : "—"}</span>
          </div>
          <div className="meta-row">
            <span>Low zone top {lowZone == null ? "—" : formatSpot(lowZone)}</span>
            <span>High zone bottom {highZone == null ? "—" : formatSpot(highZone)}</span>
          </div>
          {zonesInverted ? <div className="support">Zone pair invalid</div> : null}
          <div className="gex-box num">
            <span>Gamma exposure {gex == null ? "—" : `${formatNet(gex)} per 1%`}</span>
            <span>{env === "amplifying" ? "AMPLIFYING · model" : env === "damping" ? "STABILIZING · model" : "Model sign"}</span>
          </div>
          <div className="rail" aria-label="Price rail">
            <i className="axis" />
            {rail.map((mark, index) => {
              const lane = railLanes[index] ?? 0;
              const color =
                mark.id === "spot" ? "#fff" : mark.id.startsWith("call") ? "#ffb800" : mark.id.startsWith("put") ? "#14b8a6" : mark.id === "flip" ? "#a78bfa" : "#94a3b8";
              const label = RAIL_LABEL[mark.id] ?? mark.id;
              return (
                <span
                  key={mark.id}
                  className="mark"
                  style={{
                    left: `${mark.x * 100}%`,
                    background: color,
                    ["--shift" as string]: railLabelShift(mark.x),
                    ["--lift" as string]: `${railLabelTop(lane)}px`,
                  }}
                  title={`${label} ${formatSpot(mark.price)}`}
                >
                  <em>{label}</em>
                </span>
              );
            })}
          </div>
          {spot == null && rail.length > 0 ? <div className="support">SPX last not received</div> : null}
        </section>
      </div>

      <section className="pulse" aria-label="Market context">
        <PulseQuote symbol="SPY" quote={spy} />
        <PulseQuote symbol="QQQ" quote={qqq} />
        <PulseQuote symbol="IWM" quote={iwm} />
      </section>

      <footer className="footer">
        <span>{fixture ? "Sample data is on" : spotCaption === "Last completed minute" ? `Completed minute ${live.lastCloseMinute ?? ""}`.trim() : formatAge(live.spotAgeSec)}</span>
        <span>Expires today</span>
      </footer>

      {panel ? (
        <div
          className="sheet-scrim"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setPanel(null);
          }}
        >
        <aside
          className="sheet"
          role="dialog"
          aria-label={panel}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="sheet-head">
            <h3>{panel === "settings" ? "Settings" : "Details"}</h3>
            <button type="button" onClick={() => setPanel(null)}>
              Close
            </button>
          </div>
          {panel === "settings" ? (
            <>
              <label>
                Sample data
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
                  {fixture ? "On" : "Off"}
                </button>
              </label>
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
                  {trendOn ? "On" : "Off"}
                </button>
              </label>
              <label>
                Minimum millions in 5 minutes
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
                SPX response under points
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
              <p>Five minutes is fixed. These thresholds describe the tag. They do not place or block an order. Sample data replaces the live page until you turn it off.</p>
            </>
          ) : (
            <>
              <p>Sample numbers are a demonstration. Live mode never substitutes them unless Sample data is on in Settings.</p>
              <ul>
                <li>SPX and VIX come from the quote stream. Day change uses the quote close when that field is present.</li>
                <li>Open, high, and low minutes come from 1-minute bars when that route returns them. A bar that does not start at 09:30 is not labeled the regular-hours open.</li>
                <li>Flow now and the day row are 1-minute premium bars since 09:30 Eastern. The age is now minus tape time. Level 1 estimate is the separate streamer total.</li>
                <li>Call open interest and put open interest are the strikes with the largest open-interest gamma. Call volume and put volume are the strikes with the largest volume gamma. One strike can sit on more than one row.</li>
                <li>PRICE NOT FOLLOWING needs all four 5-minute gross amounts and a matching 5-minute SPX change. The last evaluated result stays visible when a newer window is incomplete.</li>
                <li>Flow connection: {fixture ? "fixture" : live.flowConnection}.</li>
              </ul>
            </>
          )}
        </aside>
        </div>
      ) : null}
    </div>
  );
}
