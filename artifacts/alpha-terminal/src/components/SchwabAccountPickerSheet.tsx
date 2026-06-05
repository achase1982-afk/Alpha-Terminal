import { Eye, EyeOff, Star, Check } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import { aggregateSchwabAccounts, formatSchwabAccountType } from "@/lib/schwabAccountAggregate";
import type { SchwabAccountSummary } from "@/lib/schwab-account-types";

const C = {
  text: "#f4f4f5",
  dim: "#71717a",
  gold: "#FFB800",
  red: "#ff4d4d",
  green: "#00d166",
  border: "#2a2a2c",
  bg: "#111113",
};

function fmtCurrency(n: number, hidden: boolean): string {
  if (hidden) return "••••••";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function dayPlLine(acct: SchwabAccountSummary, hidden: boolean) {
  const liq = acct.balances.liquidationValue ?? 0;
  const day = acct.dayPL ?? 0;
  const prev = liq - day;
  const pct = prev > 0 ? (day / prev) * 100 : 0;
  const color = day >= 0 ? C.green : C.red;
  const sign = day >= 0 ? "+" : "";
  if (hidden) return <span style={{ fontSize: 12, color: C.dim }}>••••</span>;
  return (
    <span style={{ fontSize: 12, color }}>
      {sign}
      {day.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })} (
      {pct >= 0 ? "+" : ""}
      {pct.toFixed(2)}%)
    </span>
  );
}

export function SchwabAccountPickerSheet() {
  const open = useSchwabAccountStore((s) => s.pickerOpen);
  const setOpen = useSchwabAccountStore((s) => s.setPickerOpen);
  const accounts = useSchwabAccountStore((s) => s.accounts);
  const viewSelection = useSchwabAccountStore((s) => s.viewSelection);
  const defaultHash = useSchwabAccountStore((s) => s.defaultTradingAccountHash);
  const hideBalances = useSchwabAccountStore((s) => s.hideBalances);
  const setViewSelection = useSchwabAccountStore((s) => s.setViewSelection);
  const setDefaultHash = useSchwabAccountStore((s) => s.setDefaultTradingAccountHash);
  const setHideBalances = useSchwabAccountStore((s) => s.setHideBalances);

  const allAgg = aggregateSchwabAccounts(accounts);

  const select = (hash: string | "all") => {
    setViewSelection(hash);
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl border-zinc-800 p-0 max-h-[85vh] overflow-hidden"
        style={{ background: C.bg }}
      >
        <SheetHeader className="px-4 pt-4 pb-2 border-b border-zinc-800 flex flex-row items-center justify-between space-y-0">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-sm font-medium"
            style={{ color: C.gold }}
          >
            Cancel
          </button>
          <SheetTitle className="text-base font-semibold text-white m-0">Select Account</SheetTitle>
          <button
            type="button"
            onClick={() => setHideBalances(!hideBalances)}
            className="p-1"
            aria-label={hideBalances ? "Show balances" : "Hide balances"}
          >
            {hideBalances ? (
              <EyeOff className="w-5 h-5 text-zinc-400" />
            ) : (
              <Eye className="w-5 h-5 text-zinc-400" />
            )}
          </button>
        </SheetHeader>

        <div className="overflow-y-auto px-3 pb-8" style={{ maxHeight: "calc(85vh - 56px)" }}>
          {allAgg && (
            <button
              type="button"
              onClick={() => select("all")}
              className="w-full flex items-center justify-between py-3 px-2 border-b border-zinc-800/80 text-left"
            >
              <div>
                <div className="text-[15px] font-medium text-white">All Accounts</div>
                <div className="mt-0.5">{dayPlLine(allAgg, hideBalances)}</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <div className="text-[15px] font-semibold text-white tabular-nums">
                    {fmtCurrency(allAgg.balances.liquidationValue, hideBalances)}
                  </div>
                </div>
                {viewSelection === "all" ? (
                  <Check className="w-5 h-5 shrink-0" style={{ color: C.gold }} />
                ) : (
                  <span className="w-5" />
                )}
              </div>
            </button>
          )}

          {accounts.map((acct) => {
            const hash = acct.hashValue;
            if (!hash) return null;
            const selected = viewSelection === hash;
            const isDefault = defaultHash === hash;
            return (
              <button
                key={hash}
                type="button"
                onClick={() => select(hash)}
                className="w-full flex items-center justify-between py-3 px-2 border-b border-zinc-800/80 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-medium text-white">{acct.accountNumber}</span>
                    {isDefault && (
                      <span className="text-[10px] uppercase tracking-wide text-zinc-300">Default</span>
                    )}
                  </div>
                  <div className="text-[12px] text-zinc-500 mt-0.5">
                    {formatSchwabAccountType(acct.type)}
                  </div>
                  <div className="mt-0.5">{dayPlLine(acct, hideBalances)}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <div className="text-right">
                    <div className="text-[15px] font-semibold text-white tabular-nums">
                      {fmtCurrency(acct.balances.liquidationValue, hideBalances)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDefaultHash(hash);
                    }}
                    className="p-1"
                    aria-label="Set as default trading account"
                  >
                    <Star
                      className="w-4 h-4"
                      style={{
                        color: isDefault ? C.gold : C.dim,
                        fill: isDefault ? C.gold : "transparent",
                      }}
                    />
                  </button>
                  {selected ? (
                    <Check className="w-5 h-5 shrink-0" style={{ color: C.gold }} />
                  ) : (
                    <span className="w-5" />
                  )}
                </div>
              </button>
            );
          })}

          <p className="text-[11px] text-zinc-600 text-center mt-4 px-2">
            Star an account to set the default for orders and the Orders tab when viewing All Accounts.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
