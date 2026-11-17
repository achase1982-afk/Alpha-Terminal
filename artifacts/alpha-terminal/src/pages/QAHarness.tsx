import { useEffect, useMemo } from "react";
import { useTerminalStore } from "@/lib/store";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import { OptionsTab } from "@/components/OptionsTab";
import { OrderTicket } from "@/components/OrderTicket";
import { StrategyBuilder, type StrategyLeg } from "@/components/StrategyBuilder";
import { useOptionsStreamStore } from "@/lib/options-stream-store";

/** Schwab OSI key for 0DTE 5900C (must match e2e `spxChain` fixture). */
const SPX_ATM_CALL_SYMBOL = "SPX   261118C05900000";

const SPX_5910_CALL = "SPX   261118C05910000";

const DEBIT_VERTICAL_LEGS: StrategyLeg[] = [
  {
    id: "qa-buy",
    optionType: "CALL",
    direction: "BUY_TO_OPEN",
    strike: 5900,
    expiration: "2026-11-18",
    quantity: 1,
    schwabSymbol: SPX_ATM_CALL_SYMBOL,
  },
  {
    id: "qa-sell",
    optionType: "CALL",
    direction: "SELL_TO_OPEN",
    strike: 5910,
    expiration: "2026-11-18",
    quantity: 1,
    schwabSymbol: SPX_5910_CALL,
  },
];

type QaScreen =
  | "chain"
  | "option-open"
  | "option-close"
  | "option-fail"
  | "debit-vertical"
  | "stock"
  | "review";

function readScreen(): QaScreen {
  const raw = new URLSearchParams(window.location.search).get("screen") ?? "chain";
  if (
    raw === "option-open"
    || raw === "option-close"
    || raw === "option-fail"
    || raw === "stock"
    || raw === "review"
    || raw === "debit-vertical"
  ) {
    return raw;
  }
  return "chain";
}

declare global {
  interface Window {
    __qaMergeOptionTick?: (tick: import("@/lib/options-stream-store").OptionTick) => void;
  }
}

export default function QAHarness() {
  useEffect(() => {
    if (import.meta.env.DEV) {
      window.__qaMergeOptionTick = useOptionsStreamStore.getState().mergeTick;
    }
  }, []);
  const setTokens = useTerminalStore((s) => s.setTokens);
  const setSymbol = useTerminalStore((s) => s.setSymbol);
  const screen = useMemo(() => readScreen(), []);

  useEffect(() => {
    if (!import.meta.env.DEV || import.meta.env.VITE_QA_HARNESS !== "true") return;
    setTokens("mock-qa-access-token", "mock-qa-refresh-token");
    const schwab = useSchwabAccountStore.getState();
    schwab.setOrderTicketAccountHash("qa-hash-1");
    schwab.setDefaultTradingAccountHash("qa-hash-1");
    void schwab.refreshAccounts();
    if (screen === "stock") {
      setSymbol("AAPL");
    } else {
      setSymbol("SPX");
    }
  }, [setTokens, setSymbol, screen]);

  const ticketProps = useMemo(() => {
    if (screen === "option-open" || screen === "review") {
      return {
        optionSymbol: SPX_ATM_CALL_SYMBOL,
        optionInstruction: "BUY_TO_OPEN" as const,
        initialSide: "BUY" as const,
        isCloseOrder: false,
      };
    }
    if (screen === "option-close") {
      return {
        optionSymbol: SPX_ATM_CALL_SYMBOL,
        optionInstruction: "SELL_TO_CLOSE" as const,
        initialSide: "SELL" as const,
        isCloseOrder: true,
      };
    }
    if (screen === "option-fail") {
      return {
        optionSymbol: SPX_ATM_CALL_SYMBOL,
        optionInstruction: "BUY_TO_OPEN" as const,
        initialSide: "BUY" as const,
        isCloseOrder: false,
      };
    }
    return undefined;
  }, [screen]);

  const label =
    screen === "chain"
      ? "SPX options chain (crossed ATM)"
      : screen === "stock"
        ? "AAPL stock ticket"
        : screen === "debit-vertical" || screen === "review"
          ? "Strategy builder · debit vertical"
          : `Order ticket · ${screen}`;

  return (
    <div style={{ minHeight: "100vh", background: "#000000" }}>
      <div
        style={{
          padding: "12px 20px",
          background: "#0a0a0a",
          borderBottom: "1px solid #1a1a1a",
          color: "#fbbf24",
          fontFamily: "monospace",
          fontSize: "11px",
          letterSpacing: "0.5px",
        }}
      >
        QA HARNESS · {label}
      </div>
      {screen === "chain" ? (
        <OptionsTab subscribeOptionSymbols={async () => {}} />
      ) : screen === "debit-vertical" || screen === "review" ? (
        <StrategyBuilder
          isOpen
          onClose={() => {}}
          initialLegs={DEBIT_VERTICAL_LEGS}
          subscribeOptionSymbols={async () => {}}
        />
      ) : screen === "stock" ? (
        <OrderTicket isOpen onClose={() => {}} subscribeOptionSymbols={async () => {}} />
      ) : ticketProps ? (
        <OrderTicket
          isOpen
          onClose={() => {}}
          subscribeOptionSymbols={async () => {}}
          {...ticketProps}
        />
      ) : null}
    </div>
  );
}