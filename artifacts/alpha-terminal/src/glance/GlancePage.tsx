import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuote } from "@/hooks/useQuote";
import { useSpotQuoteTickColor } from "@/lib/active-trader/atSpotDirection";
import { formatDisplaySymbol } from "@/lib/formatDisplaySymbol";
import { FIXTURE, fixtureHistory } from "./fixture";
import { GlanceLadder } from "./GlanceLadder";
import {
  dayMove,
  formatGross,
  formatPct,
  formatSignedPts,
  formatSpot,
  formatWall,
  fromOpenPoints,
  pathStats,
  priceNotFollowing,
  resolveTrend,
  SIDE_LABEL,
  wallDistance,
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

function quoteTitle(symbol: string, description: string | null | undefined): string {
  const text = description?.split(",")[0]?.trim();
  if (text) return text.toUpperCase();
  if (symbol.replace(/^\$/, "").toUpperCase() === "SPX") return "S&P 500";
  return formatDisplaySymbol(symbol);
}

function signedMoney(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function signedPctParen(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "(—%)";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `(${sign}${Math.abs(n).toFixed(2)}%)`;
}

const PRICE_DOWN = "#f23645";
const PRICE_UP = "#00d166";
const PRICE_FLAT = "#9CA3AF";

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
  compact = false,
}: {
  name: string;
  sold: number | null;
  bought: number | null;
  soldHist: readonly (number | null)[];
  boughtHist: readonly (number | null)[];
  scale: number;
  histMax: number;
  compact?: boolean;
}) {
  const soldW = sold != null && scale > 0 ? Math.min(100, (sold / scale) * 100) : 0;
  const boughtW = bought != null && scale > 0 ? Math.min(100, (bought / scale) * 100) : 0;
  return (
    <div className={compact ? "flow-row flow-row-compact" : "flow-row"}>
      <span className="flow-read buy">
        <span className="flow-words">{compact ? name : `${name} bought`}</span>
        <span className="flow-dollars up">{moneyOr(bought)}</span>
      </span>
      <div className="track" aria-hidden>
        <span className="bought" style={{ width: `${boughtW}%` }} />
        <span className="sold" style={{ width: `${soldW}%` }} />
        <i />
      </div>
      <span className="flow-read sell">
        <span className="flow-dollars down">{moneyOr(sold)}</span>
        {compact ? null : <span className="flow-words">{name} sold</span>}
      </span>
      {compact ? null : (
        <>
          <div className="flow-hist buy">
            <History values={boughtHist} color="#00d166" max={histMax} />
          </div>
          <div className="flow-hist sell">
            <History values={soldHist} color="#f23645" max={histMax} />
          </div>
        </>
      )}
    </div>
  );
}

function pointsFromSpot(level: number | null, mark: number | null): string {
  const dist = wallDistance(level, mark);
  if (dist == null) return "—";
  if (Math.abs(dist) < 0.5) return "at spot";
  const pts = Math.abs(dist).toFixed(0);
  return dist > 0 ? `${pts} above spot` : `${pts} below spot`;
}

function LevelLine({
  name,
  tone,
  price,
  distance,
}: {
  name: string;
  tone: string;
  price: string;
  distance: string;
}) {
  return (
    <div className="level-line">
      <span className="level-line-name">{name}</span>
      <span className={`level-line-px num ${tone}`}>{price}</span>
      <span className="level-line-dist num">{distance}</span>
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
  return (
    <div className="pulse-cell">
      <span className="k">{symbol}</span>
      <b className="num">{last == null ? "—" : last.toFixed(2)}</b>
      <span className={`num ${signedClass(pct ?? null)}`}>{pct == null ? "day unavailable" : `${formatPct(pct)} day`}</span>
    </div>
  );
}

export default function GlancePage({ embedded = false }: { embedded?: boolean }) {
  const live = useGlanceLive();
  const spxQuote = useQuote("$SPX");
  const es = useQuote("/ES");
  const nq = useQuote("/NQ");
  const ym = useQuote("/YM");
  const vixPulse = useQuote("$VIX");
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
  const quoteChange = fixture ? dayPoints : (spxQuote.sessionChange.change ?? dayPoints);
  const quotePct = fixture ? dayPct : (spxQuote.sessionChange.changePct ?? dayPct);
  const quoteName = quoteTitle("$SPX", fixture ? "S&P 500" : spxQuote.data?.description);
  const quoteChangeColor = quoteChange == null || quoteChange === 0 ? PRICE_FLAT : quoteChange > 0 ? PRICE_UP : PRICE_DOWN;
  const high = fixture ? FIXTURE.high : live.high;
  const low = fixture ? FIXTURE.low : live.low;
  const vix = fixture ? FIXTURE.vix : live.vix;
  const vixOpen = fixture ? FIXTURE.vixOpen : live.vixOpen;
  const vixDelta = fromOpenPoints(vix, vixOpen);
  const vixPct = vix != null && vixOpen != null && vixOpen > 0 ? (100 * (vix - vixOpen)) / vixOpen : null;

  const flow1 = fixture ? FIXTURE.flow.m1 : live.flow1;
  const flow5 = fixture ? FIXTURE.flow.m5 : live.flow5;
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
  const flip = fixture ? FIXTURE.flip : (live.zones?.flip ?? null);
  const lowZone = fixture ? FIXTURE.lowZoneTop : live.lowZone;
  const highZone = fixture ? FIXTURE.highZoneBottom : live.highZone;
  const zonesInverted = lowZone != null && highZone != null && lowZone >= highZone;

  const tracePoints = fixture
    ? FIXTURE.closes.map((c, i) => ({ t: i * 60_000, c }))
    : live.traceBars.map((bar) => ({ t: bar.t, c: bar.c }));

  return (
    <div className={embedded ? "glance glance-embedded" : "glance"} data-testid="spx-glance" data-mode={mode}>
      <header className="cmd">
        <div className="cmd-id">
          {embedded ? null : (
            <div className="brand">
              ALPHA
              <em>TERMINAL</em>
            </div>
          )}
          <span className="cmd-quote-sym">{formatDisplaySymbol("$SPX")}</span>
          <span className="cmd-quote-name">{quoteName}</span>
        </div>
        <div className="cmd-spot" aria-label={formatDisplaySymbol("$SPX")}>
          <span
            className="cmd-quote-last num"
            data-at-spot-tick={fixture ? "flat" : spotTick.side}
            style={{ color: fixture ? "#fff" : spotTick.color }}
          >
            {spot == null ? "—" : `$${formatSpot(spot)}`}
          </span>
          <span className="cmd-quote-chg num" style={{ color: quoteChangeColor }}>
            {signedMoney(quoteChange)} {signedPctParen(quotePct)}
          </span>
        </div>
        <div className="cmd-trail">
          {embedded ? null : <Link href="/">Mobile</Link>}
          <button type="button" onClick={() => setPanel(panel === "settings" ? null : "settings")}>
            Settings
          </button>
          <button type="button" onClick={() => setPanel(panel === "details" ? null : "details")}>
            Details
          </button>
        </div>
      </header>

      <div className="glance-body">
        <div className="glance-at-col">
          <GlanceLadder spot={spot} callWall={callOi} putWall={putOi} flip={flip} />
          <section className="glance-flow-under" aria-label="1 minute flow">
            <FlowSide
              compact
              name="Calls"
              sold={flow1.cs}
              bought={flow1.cb}
              soldHist={hist.cs}
              boughtHist={hist.cb}
              scale={scale}
              histMax={histMax}
            />
            <FlowSide
              compact
              name="Puts"
              sold={flow1.ps}
              bought={flow1.pb}
              soldHist={hist.ps}
              boughtHist={hist.pb}
              scale={scale}
              histMax={histMax}
            />
          </section>
        </div>
        <div className="glance-desk">
          <section className="headline" aria-label="Market headline">
            <div>
              <span className="k">Session high</span>
              <div className="hl num">
                <span className="hl-px">{formatSpot(high)}</span>{" "}
                {fixture || live.highMinute ? (
                  <span className="when">{fixture ? FIXTURE.highMinute : live.highMinute}</span>
                ) : null}
              </div>
              <span className="k">Session low</span>
              <div className="hl num">
                <span className="hl-px">{formatSpot(low)}</span>{" "}
                {fixture || live.lowMinute ? (
                  <span className="when">{fixture ? FIXTURE.lowMinute : live.lowMinute}</span>
                ) : null}
              </div>
              {spot != null && high != null && low != null ? (
                <div className="support num">
                  {formatSignedPts(high - spot, 0)} points under the high · {formatSignedPts(spot - low, 0)} points above the low
                </div>
              ) : null}
            </div>
            <div>
              <span className="k">VIX</span>
              <div className="vix-px num">{vix == null ? "—" : vix.toFixed(2)}</div>
              <div className={`support num ${signedClass(vixDelta)}`}>
                {formatSignedPts(vixDelta)} · {formatPct(vixPct)} from open
              </div>
              <div className="support num">
                VIX low {fixture ? FIXTURE.vixLow.toFixed(2) : live.vixLow == null ? "—" : live.vixLow.toFixed(2)} · VIX high{" "}
                {fixture ? FIXTURE.vixHigh.toFixed(2) : live.vixHigh == null ? "—" : live.vixHigh.toFixed(2)}
              </div>
            </div>
          </section>
          <section className="block" aria-label="Flow">
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
                <div className="trend" style={{ color: "#a1a1aa" }}>
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
          </section>
        </div>
      </div>

      <section className="level-board" aria-label="Levels">
        <LevelLine
          name="Gamma flip"
          tone="flip"
          price={flip == null ? "—" : formatWall(flip)}
          distance={pointsFromSpot(flip, spot)}
        />
        <LevelLine
          name="Low zone top"
          tone=""
          price={lowZone == null ? "—" : formatSpot(lowZone)}
          distance={pointsFromSpot(lowZone, spot)}
        />
        <LevelLine
          name="High zone bottom"
          tone=""
          price={highZone == null ? "—" : formatSpot(highZone)}
          distance={pointsFromSpot(highZone, spot)}
        />
        {zonesInverted ? <div className="support">Zone pair invalid</div> : null}
      </section>

      <section className="pulse" aria-label="Market context">
        <PulseQuote symbol="ES" quote={es} />
        <PulseQuote symbol="NQ" quote={nq} />
        <PulseQuote symbol="YM" quote={ym} />
        <PulseQuote symbol="VIX" quote={vixPulse} />
      </section>

      <footer className="footer">
        <span>{fixture ? "Sample data is on" : spotCaption === "Last completed minute" ? `Completed minute ${live.lastCloseMinute ?? ""}`.trim() : ""}</span>
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
                <li>Flow now and the day row are 1-minute premium bars since 09:30 Eastern. Level 1 estimate is the separate streamer total.</li>
                <li>Call wall and put wall are the strikes with the largest open-interest gamma. The number is the strike, not a contract count.</li>
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
