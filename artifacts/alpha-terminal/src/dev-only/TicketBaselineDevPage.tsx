import { useMemo, useRef, useState } from "react";
import { OrderTicket } from "@/components/OrderTicket";
import { OptionsChainOrderSheet } from "@/components/OptionsChainOrderSheet";
import type { StrategyLeg } from "@/components/StrategyBuilder";
import { getTicketBaselineFixtureOverride } from "@/lib/dev-only/ticketBaselineFixtureBridge";
import { registerTicketBaselineFixtureFromLocation } from "./ticket-baseline/registerTicketBaselineFixture";
import { FIXTURE_SPY_CALL_600 } from "./ticket-baseline/spyChainOrderFixture";

function OrderTicketFixtureView() {
  const boot = getTicketBaselineFixtureOverride()?.terminal;
  if (!boot?.orderOpen) return null;
  return (
    <div style={{ minHeight: "100dvh", background: "#000" }}>
      <OrderTicket
        isOpen
        onClose={() => {}}
        initialSide={boot.orderSide}
        optionSymbol={boot.orderOptionSymbol}
        optionInstruction={boot.orderOptionInstruction}
        isCloseOrder={boot.orderIsClose}
        subscribeOptionSymbols={async () => undefined}
      />
    </div>
  );
}

function ChainSheetFixtureView() {
  const scene = getTicketBaselineFixtureOverride()?.scene;
  const [collapsed, setCollapsed] = useState(scene === "chain-1-leg-collapsed");
  const openReviewOnMount = scene === "chain-confirm";
  const legs = useMemo((): StrategyLeg[] => {
    return [
      {
        id: "spy-call-600",
        optionType: "CALL",
        direction: "BUY_TO_OPEN",
        strike: 600,
        expiration: "2026-12-19",
        quantity: 1,
        bid: 3.72,
        ask: 3.8,
        delta: 0.52,
        gamma: 0.04,
        theta: -0.08,
        vega: 0.15,
        iv: 0.22,
        schwabSymbol: FIXTURE_SPY_CALL_600,
      },
    ];
  }, []);

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "linear-gradient(180deg, #0a0a0a 0%, #000 40%)",
        position: "relative",
      }}
    >
      <OptionsChainOrderSheet
        legs={legs}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        onClearAll={() => {}}
        onLegQuantityChange={() => {}}
        onRemoveLeg={() => {}}
        subscribeOptionSymbols={async () => undefined}
        demoFixture
        openReviewOnMount={openReviewOnMount}
      />
    </div>
  );
}

export default function TicketBaselineDevPage() {
  const registered = useRef(false);
  if (!registered.current) {
    registerTicketBaselineFixtureFromLocation();
    registered.current = true;
  }

  const scene = getTicketBaselineFixtureOverride()?.scene ?? "stock-buy";
  const chain =
    scene === "chain-1-leg-collapsed" ||
    scene === "chain-1-leg-expanded" ||
    scene === "chain-confirm";

  return chain ? <ChainSheetFixtureView /> : <OrderTicketFixtureView />;
}