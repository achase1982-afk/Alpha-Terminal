import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Blotter } from "./Blotter";
import { CommandStrip } from "./CommandStrip";
import { formatEtClock } from "./clock";
import {
  applyLadderTap,
  inferStrategy,
  isCreditStrategy,
  legsFromPreset,
  naturalNet,
  stepLimit,
  stepQty,
  strategyLabel,
  type LadderTap,
} from "./economics";
import { formatOptionPx, formatPnl, formatStrike } from "./format";
import { HeaderBar } from "./HeaderBar";
import { IntradayChart } from "./IntradayChart";
import { quoteMid, quotePrice } from "./ladderBook";
import { LadderPane } from "./LadderPane";
import { OrderTicket } from "./OrderTicket";
import { chartStatusLabel, EXPIRIES, SCENARIOS } from "./scenarios";
import type {
  IpadBlotterTab,
  IpadFill,
  IpadMetric,
  IpadPosition,
  IpadScenarioId,
  IpadStagedLeg,
  IpadStrategy,
  IpadWorkingOrder,
} from "./types";
import "./ipad-cockpit.css";

interface Toast {
  id: number;
  tone: "good" | "bad" | "gold";
  text: string;
}

/** Width the cockpit is laid out at before it is scaled into the mobile shell. */
const FIT_REFERENCE_WIDTH_PX = 900;
const FIT_REFERENCE_HEIGHT_PX = 706;

function useFitScale(): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () => {
      const vv = window.visualViewport;
      const w = vv?.width ?? window.innerWidth;
      const h = vv?.height ?? window.innerHeight;
      const next = Math.min(1, w / FIT_REFERENCE_WIDTH_PX, h / FIT_REFERENCE_HEIGHT_PX);
      setScale(Number.isFinite(next) && next > 0 ? next : 1);
    };
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
  return scale;
}

function priceOf(book: (typeof SCENARIOS)["bear"]["book"], leg: { strike: number; right: "C" | "P"; side: "BUY" | "SELL" }) {
  const quote = book.get(leg.strike);
  return quote ? quotePrice(quote, leg) : 0.05;
}

function stagePreset(scenario: (typeof SCENARIOS)["bear"], strategy: IpadStrategy): IpadStagedLeg[] {
  return legsFromPreset((leg) => priceOf(scenario.book, leg), scenario.presets[strategy]);
}

function orderSummary(legs: readonly IpadStagedLeg[], qty: number, limit: number, credit: boolean, expiry: string): string {
  const strikes = [...legs]
    .sort((a, b) => b.strike - a.strike)
    .map((leg) => formatStrike(leg.strike))
    .join("/");
  const right = legs.every((leg) => leg.right === legs[0]?.right) ? legs[0]?.right ?? "" : "";
  return `${expiry} ${strikes}${right ? ` ${right}` : ""} · ${qty}x @ ${formatOptionPx(limit)} ${credit ? "CR" : "DR"}`;
}

export default function IpadCockpitPage() {
  const fitScale = useFitScale();
  const [scenarioId, setScenarioId] = useState<IpadScenarioId>("bear");
  const scenario = SCENARIOS[scenarioId];
  const [expiryIdx, setExpiryIdx] = useState(0);
  const [metric, setMetric] = useState<IpadMetric>("OI");
  const [choppy, setChoppy] = useState(false);
  const [step, setStep] = useState<5 | 10>(5);
  const [strategy, setStrategy] = useState<IpadStrategy>(scenario.defaultStrategy);
  const [legs, setLegs] = useState<IpadStagedLeg[]>(scenario.openingLegs);
  const [qty, setQty] = useState(1);
  const [limit, setLimit] = useState(scenario.openingLimit);
  const [oco, setOco] = useState(true);
  const [positions, setPositions] = useState<IpadPosition[]>(scenario.positions);
  const [working, setWorking] = useState<IpadWorkingOrder[]>(scenario.working);
  const [fills, setFills] = useState<IpadFill[]>(scenario.fills);
  const [dayPnl, setDayPnl] = useState(scenario.dayPnl);
  const [tab, setTab] = useState<IpadBlotterTab>("positions");
  const [jump, setJump] = useState<{ strike: number; nonce: number } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const seq = useRef(10);
  const expiry = EXPIRIES[expiryIdx] ?? EXPIRIES[0]!;

  useEffect(() => {
    const previous = document.title;
    document.title = "Alpha Terminal · iPad 0DTE";
    return () => {
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  function showToast(next: Omit<Toast, "id">) {
    seq.current += 1;
    setToast({ ...next, id: seq.current });
  }

  function applyScenario(id: IpadScenarioId) {
    const next = SCENARIOS[id];
    const staged = stagePreset(next, next.defaultStrategy);
    setScenarioId(id);
    setChoppy(false);
    setStrategy(next.defaultStrategy);
    setLegs(staged);
    setQty(1);
    setLimit(naturalNet(staged, next.defaultStrategy));
    setOco(true);
    setPositions(next.positions);
    setWorking(next.working);
    setFills(next.fills);
    setDayPnl(next.dayPnl);
    setTab("positions");
    setJump(null);
    setToast(null);
  }

  function onLadderTap(tap: LadderTap) {
    const nextLegs = applyLadderTap(legs, tap);
    const nextStrategy = inferStrategy(nextLegs);
    setLegs(nextLegs);
    setStrategy(nextStrategy);
    setLimit(naturalNet(nextLegs, nextStrategy));
  }

  function onStrategy(next: IpadStrategy) {
    const staged = stagePreset(scenario, next);
    setStrategy(next);
    setLegs(staged);
    setLimit(naturalNet(staged, next));
  }

  function onSnap(kind: "mid" | "nat") {
    if (kind === "nat") {
      setLimit(naturalNet(legs, strategy));
      return;
    }
    const repriced = legs.map((leg) => {
      const quote = scenario.book.get(leg.strike);
      return quote ? { ...leg, price: quoteMid(quote, leg.right) } : leg;
    });
    setLimit(naturalNet(repriced, strategy));
  }

  function onSend() {
    if (legs.length === 0) return;
    const credit = isCreditStrategy(strategy, legs);
    seq.current += 1;
    const order: IpadWorkingOrder = {
      id: `w-${seq.current}`,
      status: oco ? "OCO WORK" : "WORKING",
      summary: orderSummary(legs, qty, limit, credit, expiry.leg),
    };
    setWorking((orders) => [order, ...orders]);
    setTab("working");
    showToast({
      tone: "good",
      text: `Order Sent · ${strategyLabel(strategy)} ${qty}x @ ${formatOptionPx(limit)} ${credit ? "CR" : "DR"}`,
    });
  }

  function onClear() {
    setLegs([]);
    setStrategy("single");
    setQty(1);
    setLimit(0.05);
  }

  function onClose(position: IpadPosition) {
    seq.current += 1;
    const clock = formatEtClock(new Date()).replace(" ET", "");
    setPositions((rows) => rows.filter((row) => row.id !== position.id));
    setDayPnl((pnl) => pnl + position.pnl);
    setFills((rows) => [
      {
        id: `f-${seq.current}`,
        time: clock,
        description: `CLOSE ${position.title}`,
        price: position.mark,
        pnl: position.pnl,
      },
      ...rows,
    ]);
    showToast({
      tone: position.pnl >= 0 ? "good" : "bad",
      text: `Position Closed · ${formatPnl(position.pnl)}`,
    });
  }

  function onCancel(id: string) {
    setWorking((orders) => orders.filter((order) => order.id !== id));
    showToast({ tone: "gold", text: "Order Canceled" });
  }

  function onJump(strike: number) {
    const label =
      strike === scenario.levels.callWall.strike
        ? "Call Wall"
        : strike === scenario.levels.putWall.strike
          ? "Put Wall"
          : "Gamma Flip";
    seq.current += 1;
    setJump({ strike, nonce: seq.current });
    showToast({ tone: "gold", text: `Jumped to ${label} ${formatStrike(strike)}` });
  }

  return (
    <div
      className="ipad-cockpit"
      data-testid="ipad-cockpit"
      data-scenario={scenarioId}
      data-fit-scale=""
      style={{ "--cockpit-scale": fitScale } as CSSProperties}
    >
      <HeaderBar
        scenario={scenario}
        expiry={expiry}
        metric={metric}
        onExpiry={() => setExpiryIdx((index) => (index + 1) % EXPIRIES.length)}
        onMetric={setMetric}
        onScenario={() => applyScenario(scenarioId === "bear" ? "bull" : "bear")}
      />
      <CommandStrip
        scenario={scenario}
        metric={metric}
        choppy={choppy}
        onChoppy={() => setChoppy((value) => !value)}
        onJump={onJump}
      />
      <div id="zone3">
        <LadderPane
          key={scenarioId}
          scenario={scenario}
          step={step}
          expiryShort={expiry.short}
          legs={legs}
          qty={qty}
          jump={jump}
          onStep={setStep}
          onTap={onLadderTap}
          onJump={onJump}
        />
        <div id="paneRight">
          <IntradayChart
            geometry={scenario.chart}
            status={chartStatusLabel(scenario.verdict)}
            statusTone={scenario.verdict.divergence}
          />
          <OrderTicket
            expiryLeg={expiry.leg}
            strategy={strategy}
            legs={legs}
            qty={qty}
            limit={limit}
            oco={oco}
            onStrategy={onStrategy}
            onQty={(dir) => setQty((value) => stepQty(value, dir))}
            onLimit={(dir) => setLimit((value) => stepLimit(value, dir))}
            onSnap={onSnap}
            onOco={() => setOco((value) => !value)}
            onSend={onSend}
            onClear={onClear}
          />
          <Blotter
            tab={tab}
            onTab={setTab}
            dayPnl={dayPnl}
            positions={positions}
            working={working}
            fills={fills}
            onClose={onClose}
            onCancel={onCancel}
          />
        </div>
      </div>
      {toast ? (
        <div key={toast.id} className="ipad-toast" data-tone={toast.tone} data-testid="ipad-toast" role="status">
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}
