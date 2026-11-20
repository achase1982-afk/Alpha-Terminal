import { formatDist, formatPremium, formatShift, formatStrike, pressurePercents } from "./format";
import { divergenceLabel, gammaBadge, tapePill, verdictHero, type IpadScenario } from "./scenarios";
import type { IpadMetric } from "./types";

function Pressure({ buy, sell }: { buy: number; sell: number }) {
  const { buyPct, sellPct } = pressurePercents(buy, sell);
  return (
    <div className="pressure" aria-hidden>
      <span className="buy" style={{ width: `${buyPct}%` }} />
      <span className="sell" style={{ width: `${sellPct}%` }} />
      <span className="notch" />
    </div>
  );
}

export function CommandStrip({
  scenario,
  metric,
  choppy,
  onChoppy,
  onJump,
}: {
  scenario: IpadScenario;
  metric: IpadMetric;
  choppy: boolean;
  onChoppy: () => void;
  onJump: (strike: number) => void;
}) {
  const { verdict, flow, levels, market } = scenario;
  const callNet = flow.calls.bought - flow.calls.sold;
  const putNet = flow.puts.bought - flow.puts.sold;
  const dayColor = flow.dayTone === "bearish" ? "var(--bear-red)" : "var(--bull-green)";
  const smoothClass = choppy ? "choppy" : verdict.control === "bears" ? "smooth-bear" : "smooth-bull";
  const tapeClass = verdict.divergence === "apart" ? "apart" : "aligned";

  return (
    <section id="zone2">
      <article className="card verdict" data-control={verdict.control}>
        <div className="card-h">
          <span className="kicker">MARKET CONTROL · 0DTE VERDICT</span>
          <span className="gamma-badge">{gammaBadge(verdict.gamma)}</span>
        </div>
        <div className="hero" data-control={verdict.control} data-testid="verdict-hero">
          {verdictHero(verdict.control)}
        </div>
        <div className="tug" role="img" aria-label={`Bears ${verdict.bearPct} percent, bulls ${verdict.bullPct} percent`}>
          <div className="tug-bear" style={{ width: `${verdict.bearPct}%` }}>
            BEARS {verdict.bearPct}%
          </div>
          <div className="tug-bull" style={{ width: `${verdict.bullPct}%` }}>
            BULLS {verdict.bullPct}%
          </div>
          <i className="tug-tick" />
        </div>
        <div className="pill-row">
          <button type="button" className={`pill ${smoothClass}`} onClick={onChoppy} aria-pressed={choppy}>
            {tapePill(verdict, choppy)}
          </button>
          <div className={`pill ${tapeClass}`}>{divergenceLabel(verdict)}</div>
        </div>
      </article>

      <article className="card surface">
        <div className="card-h">
          <span className="kicker flow">MONEY FLOW · LIVE 30s</span>
          <div className="flow-stats num">
            <span className="flow-day" style={{ color: dayColor }}>
              DAY {formatPremium(flow.dayNet, true)} {flow.dayTone === "bearish" ? "BEARISH" : "BULLISH"}
            </span>
            <span className="flow-win" style={{ color: "var(--bull-green)" }}>
              <span className="lbl">15m</span>
              {formatPremium(flow.m15, true)}
              {flow.m15Tag === "FLIP" ? <span className="flip-pill">FLIP</span> : null}
              {flow.m15Tag === "TREND" ? <span className="trend-pill">TREND</span> : null}
            </span>
            <span className="flow-win" style={{ color: "var(--bull-green)" }}>
              <span className="lbl">5m</span>
              {formatPremium(flow.m5, true)}
            </span>
          </div>
        </div>
        <div>
          <div className="flow-cols">
            <span />
            <span className="bought">Bought</span>
            <span className="mid">Buy vs sell pressure</span>
            <span className="sold">Sold</span>
          </div>
          <FlowRow label="CALL" bought={flow.calls.bought} sold={flow.calls.sold} />
          <FlowRow label="PUT" bought={flow.puts.bought} sold={flow.puts.sold} />
        </div>
        <div className="tape-strip num">
          <span style={{ color: callNet >= 0 ? "var(--bull-green)" : "var(--bear-red)" }}>
            NET CALL {formatPremium(callNet, true)}
          </span>
          <span style={{ color: putNet <= 0 ? "var(--bull-green)" : "var(--bear-red)" }}>
            NET PUT {formatPremium(putNet, true)} {putNet <= 0 ? "(PUTS SOLD)" : "(PUTS BOUGHT)"}
          </span>
          <span style={{ color: flow.tapeTone === "gold" ? "var(--brand-gold)" : "var(--bull-green)" }}>{flow.tape}</span>
        </div>
      </article>

      <article className="card surface">
        <div className="card-h">
          <span className="kicker flow">
            DEALER LEVELS
            <span className="metric-badge">{metric}</span>
          </span>
          <span className="zone-line num">
            Hi Zone <b>{formatStrike(levels.hiZone)}</b> · Lo Zone <b>{formatStrike(levels.loZone)}</b>
          </span>
        </div>
        <div className="wall-list">
          <WallButton
            name="CALL WALL"
            color="var(--brand-gold)"
            strike={levels.callWall.strike}
            spot={market.spot}
            shift={levels.callWall.prev != null ? formatShift(levels.callWall.prev, levels.callWall.strike) : ""}
            shiftColor={shiftColor(levels.callWall.prev, levels.callWall.strike)}
            onJump={onJump}
          />
          <WallButton
            name="PUT WALL"
            color="var(--putwall-teal)"
            strike={levels.putWall.strike}
            spot={market.spot}
            shift={levels.putWall.prev != null ? formatShift(levels.putWall.prev, levels.putWall.strike) : ""}
            shiftColor={shiftColor(levels.putWall.prev, levels.putWall.strike)}
            onJump={onJump}
          />
          <WallButton
            name="GAMMA FLIP"
            color="var(--gamma-purple)"
            strike={levels.gammaFlip.strike}
            spot={market.spot}
            shift={gammaBadge(verdict.gamma)}
            shiftColor="var(--gamma-purple)"
            onJump={onJump}
          />
        </div>
      </article>
    </section>
  );
}

function shiftColor(prev: number | undefined, strike: number): string {
  if (prev == null) return "var(--text-secondary)";
  return strike - prev >= 0 ? "var(--bull-green)" : "var(--bear-red)";
}

function FlowRow({ label, bought, sold }: { label: string; bought: number; sold: number }) {
  return (
    <div className="flow-row">
      <span className="flow-side">{label}</span>
      <span className="flow-amt buy num">{formatPremium(bought)}</span>
      <Pressure buy={bought} sell={sold} />
      <span className="flow-amt sell num">{formatPremium(sold)}</span>
    </div>
  );
}

function WallButton({
  name,
  color,
  strike,
  spot,
  shift,
  shiftColor: deltaColor,
  onJump,
}: {
  name: string;
  color: string;
  strike: number;
  spot: number;
  shift: string;
  shiftColor: string;
  onJump: (strike: number) => void;
}) {
  const migrated = shift.startsWith("was ");
  return (
    <button type="button" className="wall-row" onClick={() => onJump(strike)}>
      <span className="wall-name" style={{ color }}>
        {name}
      </span>
      <span className="wall-strike num">{formatStrike(strike)}</span>
      <span className="wall-dist num">{formatDist(strike, spot)}</span>
      {migrated ? (
        <span className="wall-shift num">
          {shift.slice(0, shift.lastIndexOf(" "))}
          <span className="delta" style={{ color: deltaColor }}>
            {shift.slice(shift.lastIndexOf(" ") + 1)}
          </span>
        </span>
      ) : (
        <span className="wall-shift" style={{ color: deltaColor, fontWeight: 800 }}>
          {shift}
        </span>
      )}
    </button>
  );
}
