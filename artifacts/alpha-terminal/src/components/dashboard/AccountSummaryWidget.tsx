import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import { SchwabAccountHeader } from "@/components/SchwabAccountHeader";

function money(n: number, hide: boolean): string {
  if (hide) return "••••••";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function pl(n: number, hide: boolean): { text: string; color: string } {
  if (hide) return { text: "••••••", color: "#a1a1aa" };
  const sign = n > 0 ? "+" : "";
  return {
    text: `${sign}${n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`,
    color: n > 0 ? "#00d166" : n < 0 ? "#f23645" : "#a1a1aa",
  };
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0 flex-1 basis-28 rounded-md border border-zinc-800/60 bg-[#111113] px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="truncate font-mono text-sm font-bold tabular-nums" style={{ color: color ?? "#fafafa" }}>
        {value}
      </p>
    </div>
  );
}

/**
 * Compact account strip for the dashboard: totals aggregated across all
 * Schwab sub-accounts from the live portfolio stream. Respects the
 * hide-balances privacy preference.
 */
export function AccountSummaryWidget() {
  const accounts = usePortfolioStreamStore((s) => s.accounts);
  const hideBalances = useSchwabAccountStore((s) => s.hideBalances);

  if (accounts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <p className="text-center font-mono text-xs tracking-wider text-zinc-600">
          CONNECT BROKERAGE TO VIEW ACCOUNT SUMMARY
        </p>
      </div>
    );
  }

  const totals = accounts.reduce(
    (acc, a) => ({
      liq: acc.liq + (a.balances?.liquidationValue ?? 0),
      cash: acc.cash + (a.balances?.cashBalance ?? 0),
      buyingPower: acc.buyingPower + (a.balances?.buyingPower ?? 0),
      dayPL: acc.dayPL + (a.dayPL ?? 0),
      totalPL: acc.totalPL + (a.totalPL ?? 0),
      positions: acc.positions + (a.positions?.length ?? 0),
    }),
    { liq: 0, cash: 0, buyingPower: 0, dayPL: 0, totalPL: 0, positions: 0 },
  );

  const day = pl(totals.dayPL, hideBalances);
  const total = pl(totals.totalPL, hideBalances);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SchwabAccountHeader compact />
      <div className="flex flex-wrap gap-2 overflow-y-auto p-2">
        <Stat label="Net Liq" value={money(totals.liq, hideBalances)} />
        <Stat label="Day P/L" value={day.text} color={day.color} />
        <Stat label="Total P/L" value={total.text} color={total.color} />
        <Stat label="Buying Power" value={money(totals.buyingPower, hideBalances)} />
        <Stat label="Cash" value={money(totals.cash, hideBalances)} />
        <Stat label="Positions" value={String(totals.positions)} />
      </div>
    </div>
  );
}
