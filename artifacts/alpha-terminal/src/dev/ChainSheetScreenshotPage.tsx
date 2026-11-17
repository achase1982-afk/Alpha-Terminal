import { useEffect, useMemo, useRef, useState } from "react";
import { OptionsChainOrderSheet } from "@/components/OptionsChainOrderSheet";
import type { StrategyLeg } from "@/components/StrategyBuilder";

const scenarios: Record<string, StrategyLeg[]> = {
  "1-leg": [
    {
      id: "l1",
      optionType: "CALL",
      direction: "BUY_TO_OPEN",
      strike: 600,
      expiration: "2026-12-19",
      quantity: 1,
      bid: 3.75,
      ask: 3.8,
      schwabSymbol: "SPY   261219C00600000",
    },
  ],
  vertical: [
    {
      id: "l1",
      optionType: "CALL",
      direction: "BUY_TO_OPEN",
      strike: 600,
      expiration: "2026-12-19",
      quantity: 1,
      bid: 3.75,
      ask: 3.8,
      schwabSymbol: "SPY   261219C00600000",
    },
    {
      id: "l2",
      optionType: "CALL",
      direction: "SELL_TO_OPEN",
      strike: 605,
      expiration: "2026-12-19",
      quantity: 1,
      bid: 1.2,
      ask: 1.25,
      schwabSymbol: "SPY   261219C00605000",
    },
  ],
  "iron-condor": [
    { id: "l1", optionType: "PUT", direction: "BUY_TO_OPEN", strike: 580, expiration: "2026-12-19", quantity: 1, bid: 0.9, ask: 0.95, schwabSymbol: "SPY   261219P00580000" },
    { id: "l2", optionType: "PUT", direction: "SELL_TO_OPEN", strike: 585, expiration: "2026-12-19", quantity: 1, bid: 1.9, ask: 1.95, schwabSymbol: "SPY   261219P00585000" },
    { id: "l3", optionType: "CALL", direction: "SELL_TO_OPEN", strike: 615, expiration: "2026-12-19", quantity: 1, bid: 1.8, ask: 1.85, schwabSymbol: "SPY   261219C00615000" },
    { id: "l4", optionType: "CALL", direction: "BUY_TO_OPEN", strike: 620, expiration: "2026-12-19", quantity: 1, bid: 0.85, ask: 0.9, schwabSymbol: "SPY   261219C00620000" },
  ],
};

export default function ChainSheetScreenshotPage() {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const scenario = params.get("scenario") ?? "1-leg";
  const confirm = params.get("confirm") === "1";
  const legs = useMemo(() => scenarios[scenario] ?? scenarios["1-leg"], [scenario]);
  const [collapsed, setCollapsed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => {
      const btn = rootRef.current?.querySelector('[data-testid="chain-sheet-review"]') as HTMLButtonElement | null;
      btn?.click();
    }, 400);
    return () => clearTimeout(t);
  }, [confirm, legs]);

  return (
    <div ref={rootRef} style={{ width: 440, height: 956, background: "#000", position: "relative", margin: "0 auto" }}>
      <div style={{ height: 120, padding: 12, color: "#52525b", fontFamily: "monospace", fontSize: 10 }}>
        OPTIONS CHAIN (fixture) · {scenario}
      </div>
      <OptionsChainOrderSheet
        legs={legs}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        onClearAll={() => {}}
        onLegQuantityChange={() => {}}
        onRemoveLeg={() => {}}
        demoFixture
      />
    </div>
  );
}