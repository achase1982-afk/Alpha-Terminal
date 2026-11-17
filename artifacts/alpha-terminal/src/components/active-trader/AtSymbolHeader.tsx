import { memo, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { useActiveSymbol } from "@/components/dashboard/widgetSymbolContext";
import { WatchlistToggle } from "@/components/MetricsBar";
import { useQuote } from "@/hooks/useQuote";
import { useTickColor } from "@/hooks/useTickColor";
import { useAtChromeStore } from "@/lib/active-trader/atChromeStore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const HEADER_BG = "#0a0a0a";
const UP_COLOR = "#00d166";
const DOWN_COLOR = "#f23645";
const FLAT_COLOR = "#9CA3AF";
const SUBTITLE_GOLD = "#FFB800";

function fmtPrice(n: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "\u2014";
  return n.toFixed(digits);
}

export const AtSymbolHeader = memo(function AtSymbolHeader() {
  const symbol = useActiveSymbol();
  const { data: quote } = useQuote(symbol);
  const tickColor = useTickColor(symbol, quote?.last ?? null);

  const expiryOptions = useAtChromeStore((s) => s.atExpiryOptions);
  const selectedExpiration = useAtChromeStore((s) => s.atSelectedExpiration);
  const pickAtExpiration = useAtChromeStore((s) => s.pickAtExpiration);

  const pillLabel = useMemo(() => {
    if (!selectedExpiration) return "\u2014";
    return expiryOptions.find((o) => o.expiration === selectedExpiration)?.pillLabel ?? "\u2014";
  }, [expiryOptions, selectedExpiration]);

  const rawChange = quote?.change ?? null;
  const rawPct = quote?.changePct ?? null;
  const isUp = rawChange !== null && rawChange > 0;
  const isDown = rawChange !== null && rawChange < 0;
  const priceColor = isDown ? DOWN_COLOR : isUp ? UP_COLOR : FLAT_COLOR;

  const streamLive = quote?.last ?? quote?.regularLast ?? quote?.extendedLast ?? null;
  const lastStr = streamLive != null ? `$${fmtPrice(streamLive)}` : "\u2014";
  const changeStr =
    rawChange != null
      ? isUp
        ? `+$${fmtPrice(rawChange)}`
        : rawChange === 0
          ? "$0.00"
          : `\u2212$${fmtPrice(Math.abs(rawChange))}`
      : "\u2014";
  const changePctStr =
    rawPct != null ? `(${isUp ? "+" : isDown ? "\u2212" : ""}${fmtPrice(Math.abs(rawPct))}%)` : "(—%)";

  const displaySym = quote?.symbol ?? symbol.replace(/^\$/, "");
  const subtitle = quote?.description?.split(",")[0]?.trim() ?? quote?.description?.trim() ?? "";

  return (
    <div
      data-at-symbol-header
      className="w-full border-b border-card-border px-3 py-2 shrink-0"
      style={{ background: HEADER_BG }}
    >
      <div className="grid items-center gap-2" style={{ gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)" }}>
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-0.5 leading-none">
            <span className="text-sm font-semibold text-white tracking-tight shrink-0">{displaySym}</span>
            {displaySym ? <WatchlistToggle symbol={displaySym} /> : null}
          </span>
          {subtitle ? (
            <span
              className="text-[10px] font-medium tracking-wide uppercase leading-snug truncate"
              style={{ color: SUBTITLE_GOLD }}
            >
              {subtitle}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col items-center justify-center min-w-0">
          <span
            className="tabular-nums text-lg font-medium leading-none"
            style={{ color: tickColor }}
            data-ui-audit="at-header-last"
          >
            {lastStr}
          </span>
          <span className="tabular-nums text-[10px] font-medium mt-0.5 whitespace-nowrap" style={{ color: priceColor }}>
            {changeStr} {changePctStr}
          </span>
        </div>
        <div className="flex justify-end min-w-0">
          {expiryOptions.length > 0 && selectedExpiration ? (
            <Select value={selectedExpiration} onValueChange={pickAtExpiration}>
              <SelectTrigger
                data-at-expiry-pill
                className="h-7 max-w-full border rounded-full px-2.5 gap-1 text-white shadow-none"
                style={{ fontSize: 10, background: "#141414", borderColor: "#2a2a2a" }}
                aria-label="Option expiration"
              >
                <SelectValue>{pillLabel}</SelectValue>
                <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
              </SelectTrigger>
              <SelectContent>
                {expiryOptions.map((o) => (
                  <SelectItem key={o.expiration} value={o.expiration} style={{ fontSize: 12 }}>
                    {o.pillLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-[10px] text-zinc-600 tabular-nums">{pillLabel}</span>
          )}
        </div>
      </div>
    </div>
  );
});