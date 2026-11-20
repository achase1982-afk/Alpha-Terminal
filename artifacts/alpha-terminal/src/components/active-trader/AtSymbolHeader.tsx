import { memo } from "react";
import { useActiveSymbol } from "@/components/dashboard/widgetSymbolContext";
import { WatchlistToggle } from "@/components/MetricsBar";
import { useQuote } from "@/hooks/useQuote";
import { AtExpirySelect } from "@/components/active-trader/AtExpirySelect";
import { GOLD, MONO, DIM, WHITE } from "@/components/options/optionsTheme";
import { formatDisplaySymbol } from "@/lib/formatDisplaySymbol";
import { APP_SURFACE } from "@/lib/theme/appSurface";

const HEADER_BG = APP_SURFACE;

function fmtSpot(n: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "\u2014";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatIndexSubtitle(symbol: string, description?: string): string {
  const sym = symbol.replace(/^\$/, "").toUpperCase();
  if (description?.trim()) {
    return description
      .split(",")[0]
      .trim()
      .toUpperCase()
      .replace(/\s*&\s*/g, " & ");
  }
  if (sym === "SPX") return "S & P 500 INDEX";
  return "";
}

export const AtSymbolHeader = memo(function AtSymbolHeader({ compact }: { compact?: boolean }) {
  const symbol = useActiveSymbol();
  const { data: quote, sessionChange } = useQuote(symbol);

  const rawChange = sessionChange.change;
  const rawPct = sessionChange.changePct;
  const isUp = rawChange !== null && rawChange > 0;
  const isDown = rawChange !== null && rawChange < 0;

  const streamLive = quote?.last ?? quote?.regularLast ?? quote?.extendedLast ?? null;
  const changeStr =
    rawChange != null
      ? isUp
        ? `+$${fmtSpot(rawChange)}`
        : rawChange < 0
          ? `\u2212$${fmtSpot(Math.abs(rawChange))}`
          : "$0.00"
      : "\u2014";
  const changePctStr =
    rawPct != null
      ? `(${isUp ? "+" : isDown ? "\u2212" : ""}${fmtSpot(Math.abs(rawPct))}%)`
      : "";

  const displaySym = formatDisplaySymbol(quote?.symbol ?? symbol);
  const subtitle = formatIndexSubtitle(displaySym, quote?.description ?? undefined);

  if (compact) {
    return (
      <div
        data-at-symbol-header
        className="w-full border-b border-zinc-800/70 px-2 py-0.5 shrink-0"
        style={{ background: HEADER_BG, fontFamily: MONO, minHeight: 28 }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-white tracking-tight shrink-0">{displaySym}</span>
          <span
            className="tabular-nums text-sm font-medium"
            data-ui-audit="at-header-last"
            style={{ color: WHITE, fontVariantNumeric: "tabular-nums" }}
          >
            {streamLive != null ? fmtSpot(streamLive) : "\u2014"}
          </span>
          <span
            className="tabular-nums text-[10px] font-normal whitespace-nowrap min-w-0 truncate"
            style={{ color: isUp ? "#22c55e" : isDown ? "#f87171" : DIM }}
          >
            {changeStr} {changePctStr}
          </span>
          <div className="flex-1" />
          <AtExpirySelect compact />
        </div>
      </div>
    );
  }

  return (
    <div
      data-at-symbol-header
      className="w-full border-b border-zinc-800/70 px-3 py-2 shrink-0"
      style={{ background: HEADER_BG, fontFamily: MONO }}
    >
      <div className="grid items-center gap-2" style={{ gridTemplateColumns: "minmax(0,1.1fr) auto minmax(0,1fr)" }}>
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-0.5 leading-none">
            <span className="text-lg font-semibold text-white tracking-tight shrink-0">{displaySym}</span>
            {displaySym ? <WatchlistToggle symbol={displaySym} /> : null}
          </span>
          {subtitle ? (
            <span className="text-[10px] font-medium tracking-wide uppercase leading-tight truncate" style={{ color: GOLD }}>
              {subtitle}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col items-center justify-center min-w-0 px-1">
          <span
            className="tabular-nums leading-none"
            data-ui-audit="at-header-last"
            style={{ fontSize: 22, fontWeight: 400, color: WHITE, fontVariantNumeric: "tabular-nums" }}
          >
            {streamLive != null ? fmtSpot(streamLive) : "\u2014"}
          </span>
          <span className="tabular-nums text-[10px] font-normal mt-0.5 whitespace-nowrap" style={{ color: DIM }}>
            {changeStr} {changePctStr}
          </span>
        </div>
        <div className="flex justify-end min-w-0">
          <AtExpirySelect />
        </div>
      </div>
    </div>
  );
});