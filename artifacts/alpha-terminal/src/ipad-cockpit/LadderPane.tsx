import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LadderTap } from "./economics";
import { formatSignedPts, formatSpot, formatStrike } from "./format";
import { quotePrice, railVisibility, strikeAboveSpot, visibleStrikes } from "./ladderBook";
import { gammaRail, type IpadScenario } from "./scenarios";
import type { IpadLadderQuote, IpadStagedLeg } from "./types";

const WALL_COLOR = {
  call: "#F5B82E",
  put: "#2DD4BF",
  gamma: "#C084FC",
} as const;

export function LadderPane({
  scenario,
  step,
  expiryShort,
  legs,
  qty,
  jump,
  onStep,
  onTap,
  onJump,
}: {
  scenario: IpadScenario;
  step: 5 | 10;
  expiryShort: string;
  legs: readonly IpadStagedLeg[];
  qty: number;
  jump: { strike: number; nonce: number } | null;
  onStep: (step: 5 | 10) => void;
  onTap: (tap: LadderTap) => void;
  onJump: (strike: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const didAnchor = useRef(false);
  const [rails, setRails] = useState({ top: false, bottom: false });
  const preserve = [
    scenario.levels.callWall.strike,
    scenario.levels.putWall.strike,
    scenario.levels.gammaFlip.strike,
    scenario.atm,
    ...legs.map((leg) => leg.strike),
  ];
  const strikes = visibleStrikes(step, preserve);
  const divider = strikeAboveSpot(strikes, scenario.market.spot);
  let maxVol = 1;
  for (const strike of strikes) {
    const quote = scenario.book.get(strike);
    if (!quote) continue;
    maxVol = Math.max(maxVol, quote.callVol, quote.putVol);
  }

  const updateStickyWallRails = useCallback(() => {
    const scroller = scrollRef.current;
    const callRow = scroller?.querySelector<HTMLElement>("[data-wall='call']");
    const gammaRow = scroller?.querySelector<HTMLElement>("[data-wall='gamma']");
    if (!scroller || !callRow || !gammaRow) return;
    const next = railVisibility({
      callWallTop: callRow.offsetTop,
      callWallHeight: callRow.offsetHeight,
      gammaTop: gammaRow.offsetTop,
      scrollTop: scroller.scrollTop,
      clientHeight: scroller.clientHeight,
    });
    setRails((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next));
  }, []);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const anchorOnce = () => {
      if (didAnchor.current) return;
      const anchor = scroller.querySelector<HTMLElement>(`[data-strike="${scenario.anchor}"]`);
      if (!anchor || scroller.clientHeight < 1) return;
      scroller.scrollTop = anchor.offsetTop;
      if (anchor.offsetTop === 0 || scroller.scrollTop > 0) didAnchor.current = true;
    };
    anchorOnce();
    if (!didAnchor.current && typeof requestAnimationFrame === "function") {
      frame = requestAnimationFrame(anchorOnce);
    }
    updateStickyWallRails();
    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
  });

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onScroll = () => updateStickyWallRails();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => updateStickyWallRails());
      observer.observe(scroller);
    }
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [updateStickyWallRails]);

  useEffect(() => {
    if (!jump) return;
    const scroller = scrollRef.current;
    const row = scroller?.querySelector<HTMLElement>(`[data-strike="${jump.strike}"]`);
    if (!scroller || !row) return;
    const top = Math.max(0, row.offsetTop - 4);
    if (typeof scroller.scrollTo === "function") scroller.scrollTo({ top, behavior: "smooth" });
    else scroller.scrollTop = top;
  }, [jump]);

  function centerAtm() {
    const scroller = scrollRef.current;
    const row = scroller?.querySelector<HTMLElement>(`[data-strike="${scenario.atm}"]`);
    if (!scroller || !row) return;
    const top = row.offsetTop - (scroller.clientHeight - row.offsetHeight) / 2;
    const next = Math.max(0, top);
    if (typeof scroller.scrollTo === "function") scroller.scrollTo({ top: next, behavior: "smooth" });
    else scroller.scrollTop = next;
  }

  const callWall = scenario.levels.callWall;
  const gamma = scenario.levels.gammaFlip.strike;
  const callDist = formatSignedPts(callWall.strike - scenario.market.spot);
  const gammaDist = formatSignedPts(gamma - scenario.market.spot);
  const callShift =
    callWall.prev != null
      ? ` · was ${formatStrike(callWall.prev)} ${callWall.strike - callWall.prev > 0 ? "▲" : "▼"}${Math.abs(callWall.strike - callWall.prev).toLocaleString("en-US")}`
      : "";

  return (
    <section id="paneLeft" className="mod" aria-label="Options ladder">
      <div className="ladder-bar">
        <div className="ladder-side">
          <span className="calls-h">CALLS</span>
          <span className="tap-hint">TAP BID=SELL · ASK=BUY</span>
        </div>
        <div className="ladder-center">
          <span className="step-label">STRIKE STEP:</span>
          <div className="seg step" role="group" aria-label="Strike step">
            <button type="button" aria-pressed={step === 5} onClick={() => onStep(5)}>
              5pt
            </button>
            <button type="button" aria-pressed={step === 10} onClick={() => onStep(10)}>
              10pt
            </button>
          </div>
          <button type="button" className="center-btn" onClick={centerAtm}>
            CENTER ATM
          </button>
        </div>
        <div className="ladder-side">
          <span className="expiry-sub hide-narrow">{expiryShort}</span>
          <span className="puts-h">PUTS</span>
        </div>
      </div>
      <div className="col-head">
        <span className="r">CALL 30s</span>
        <span className="c call">BID</span>
        <span className="c call">ASK</span>
        <span className="c strike-h">STRIKE</span>
        <span className="c put">BID</span>
        <span className="c put">ASK</span>
        <span className="l">PUT 30s</span>
      </div>
      <button
        id="railTopWall"
        type="button"
        className={`rail top${rails.top ? " show" : ""}`}
        onClick={() => onJump(callWall.strike)}
      >
        <span>
          ▲ CALL WALL ABOVE: {formatStrike(callWall.strike)} ({callDist} pts){callShift}
        </span>
        <em>TAP TO JUMP</em>
      </button>
      <div id="ladderScroll" ref={scrollRef}>
        {strikes.map((strike) => {
          const quote = scenario.book.get(strike);
          if (!quote) return null;
          const wall =
            strike === scenario.levels.callWall.strike
              ? "call"
              : strike === scenario.levels.putWall.strike
                ? "put"
                : strike === scenario.levels.gammaFlip.strike
                  ? "gamma"
                  : null;
          return (
            <div
              key={strike}
              className={`ladder-row${divider === strike ? " has-spot" : ""}`}
              data-strike={strike}
              data-wall={wall ?? undefined}
            >
              <VolCell side="call" vol={quote.callVol} maxVol={maxVol} itm={strike < scenario.market.spot} />
              <QuoteCell
                quote={quote}
                right="C"
                side="SELL"
                legs={legs}
                qty={qty}
                itm={strike < scenario.market.spot}
                onTap={onTap}
              />
              <QuoteCell
                quote={quote}
                right="C"
                side="BUY"
                legs={legs}
                qty={qty}
                itm={strike < scenario.market.spot}
                onTap={onTap}
              />
              <div className={`strike-cell${strike === scenario.atm ? " atm" : ""}`}>
                {wall ? (
                  <span className="strike-badge" style={{ color: strike === scenario.atm ? "#090B0E" : WALL_COLOR[wall] }}>
                    {wall === "call" ? "CALL WALL" : wall === "put" ? "PUT WALL" : "GAMMA FLIP"}
                  </span>
                ) : null}
                <span className="strike-px num">{formatStrike(strike)}</span>
              </div>
              <QuoteCell
                quote={quote}
                right="P"
                side="SELL"
                legs={legs}
                qty={qty}
                itm={strike > scenario.market.spot}
                onTap={onTap}
              />
              <QuoteCell
                quote={quote}
                right="P"
                side="BUY"
                legs={legs}
                qty={qty}
                itm={strike > scenario.market.spot}
                onTap={onTap}
              />
              <VolCell side="put" vol={quote.putVol} maxVol={maxVol} itm={strike > scenario.market.spot} />
              {wall ? <div className="wall-ring" style={{ boxShadow: `inset 0 0 0 2px ${WALL_COLOR[wall]}` }} /> : null}
              {divider === strike ? (
                <div className="spot-rule">
                  <span className="spot-pill num">SPOT {formatSpot(scenario.market.spot)}</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <button
        id="railBottomWall"
        type="button"
        className={`rail bot${rails.bottom ? " show" : ""}`}
        onClick={() => onJump(gamma)}
      >
        <span>
          ▼ GAMMA FLIP BELOW: {formatStrike(gamma)} ({gammaDist} pts) · {gammaRail(scenario.verdict.gamma)}
        </span>
        <em>TAP TO JUMP</em>
      </button>
    </section>
  );
}

function VolCell({
  side,
  vol,
  maxVol,
  itm,
}: {
  side: "call" | "put";
  vol: number;
  maxVol: number;
  itm: boolean;
}) {
  const width = Math.max(0, Math.min(100, (vol / maxVol) * 100));
  return (
    <div className={`vol ${side}${itm ? (side === "call" ? " itm-call" : " itm-put") : ""}`}>
      <span className="heat" style={{ width: `${width}%` }} />
      <span className="vol-n num">{vol.toLocaleString("en-US")}</span>
    </div>
  );
}

function QuoteCell({
  quote,
  right,
  side,
  legs,
  qty,
  itm,
  onTap,
}: {
  quote: IpadLadderQuote;
  right: "C" | "P";
  side: "BUY" | "SELL";
  legs: readonly IpadStagedLeg[];
  qty: number;
  itm: boolean;
  onTap: (tap: LadderTap) => void;
}) {
  const price = quotePrice(quote, { right, side });
  const staged = legs.some((leg) => leg.strike === quote.strike && leg.right === right && leg.side === side);
  const tick = right === "C" ? quote.callTick : quote.putTick;
  const itmClass = itm ? (right === "C" ? " itm-call" : " itm-put") : "";
  const stagedClass = staged ? (side === "SELL" ? " staged-sell" : " staged-buy") : "";
  return (
    <button
      type="button"
      className={`qcell${itmClass}${stagedClass}`}
      data-testid={`ladder-${quote.strike}-${right}-${side}`}
      onClick={() => onTap({ strike: quote.strike, right, side, price })}
    >
      {staged ? <em className={`leg-badge ${side === "SELL" ? "sell" : "buy"}`}>{side === "SELL" ? "S" : "B"}{qty}</em> : null}
      <span className="px num">
        <i className={`tick ${tick}`}>{tick === "up" ? "▲" : "▼"}</i>
        {price.toFixed(2)}
      </span>
    </button>
  );
}
