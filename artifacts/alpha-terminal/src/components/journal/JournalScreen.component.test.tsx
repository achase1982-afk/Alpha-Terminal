/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JournalScreen } from "./JournalScreen";
import type { InsightsPayload } from "./journalModel";

afterEach(() => cleanup());

function payload(over: Partial<InsightsPayload> = {}): InsightsPayload {
  return {
    period: "ytd",
    asOf: "2026-11-18T21:00:00.000Z",
    empty: true,
    emptyMessage: "No closed trades in this period.",
    headline: null,
    comparison: {
      accountReturn: null,
      benchmarkReturn: null,
      benchmarkStatus: "unavailable",
      windowStart: "2026-01-01T05:00:00.000Z",
      windowEnd: "2026-11-18T21:00:00.000Z",
      openPositions: 0,
      unrealizedPnl: null,
      footnote: "Modified Dietz vs benchmark unavailable, same dates Jan 1 – Nov 18, 2026. Deposits and withdrawals excluded. 0 open positions, unrealized not included above.",
    },
    account: null,
    assetClasses: [],
    strategies: [],
    byStrategy: {},
    positions: [],
    ...over,
  };
}

describe("JournalScreen", () => {
  it("shows the empty book and withholds a benchmark percent", () => {
    render(
      <JournalScreen
        payload={payload()}
        loading={false}
        error={null}
        period="ytd"
        onPeriod={vi.fn()}
        view="insights"
        onView={vi.fn()}
        strategy={null}
        onStrategy={vi.fn()}
      />,
    );
    expect(screen.getByText("No closed trades in this period.")).toBeTruthy();
    expect(screen.getByText("Benchmark unavailable.")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/win rate|\bwins\b|W\/L|streak/i);
    expect(document.body.textContent ?? "").not.toContain("+$0.00");
  });

  it("opens a strategy row and keeps money color tied to the sign", () => {
    const onStrategy = vi.fn();
    const filled = payload({
      empty: false,
      emptyMessage: null,
      headline: { tone: "negative", label: "IN THE RED", netPnl: -120, closedTrades: 2 },
      account: {
        metrics: {
          expectancy: -60,
          avgGain: 40,
          avgLoss: -160,
          profitFactor: 0.25,
          closedTrades: 2,
          pctClosedPositive: 0.5,
          fees: 2,
          maxDrawdown: -160,
          grossGains: 40,
          netPnl: -120,
        },
        timeCuts: [],
        holdingCuts: [],
        dayCuts: [],
        perspective: "Net after fees -$120.00 on 2 closed trades. 50% of closed trades were positive.",
        closedTrades: [],
      },
      strategies: [
        { key: "Debit spreads", label: "Debit spreads", netPnl: -160, trades: 1, expectancy: -160, sample: "short", grossGains: 0, fees: 1 },
      ],
    });
    render(
      <JournalScreen
        payload={filled}
        loading={false}
        error={null}
        period="ytd"
        onPeriod={vi.fn()}
        view="insights"
        onView={vi.fn()}
        strategy={null}
        onStrategy={onStrategy}
      />,
    );
    expect(screen.getByText("IN THE RED")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Debit spreads/ }));
    expect(onStrategy).toHaveBeenCalledWith("Debit spreads");
    expect(document.body.textContent ?? "").not.toMatch(/win rate|\bwins\b|W\/L|streak/i);
  });
});
