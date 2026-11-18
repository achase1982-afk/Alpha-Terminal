import { memo, useMemo } from "react";
import { useActiveSymbol } from "@/components/dashboard/widgetSymbolContext";
import { WatchlistToggle } from "@/components/MetricsBar";
import { useQuote } from "@/hooks/useQuote";
import { useAtChromeStore } from "@/lib/active-trader/atChromeStore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GOLD, MONO, DIM, GRAY, WHITE } from "@/components/options/optionsTheme";
import { formatDisplaySymbol } from "@/lib/formatDisplaySymbol";

const HEADER_BG = "#0a0a0a";

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
  const { data: quote } = useQuote(symbol);

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

  const streamLive = quote?.last ?? quote?.regularLast ?? quote?.extendedLast ?? null;
  const changeStr =
    rawChange != null
      ? isUp
        ? `+$${fmtSpot(rawChange)}`
        : rawChange === 0
          ? "$0.00"
          : `\u2212$${fmtSpot(Math.abs(rawChange))}`
      : "\u2014";
  const changePctStr =
    rawPct != null ? `(${isUp ? "+" : isDown ? "\u2212" : ""}${fmtSpot(Math.abs(rawPct))}%)` : "(0.00%)";

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
          {expiryOptions.length > 0 && selectedExpiration ? (
            <Select value={selectedExpiration} onValueChange={pickAtExpiration}>
              <SelectTrigger
                data-at-expiry-pill
                className="h-5 max-w-[5.5rem] rounded-full px-1.5 text-[9px] font-normal shadow-none border [&>svg]:hidden"
                style={{
                  background: "transparent",
                  borderColor: "#3f3f46",
                  color: GRAY,
                  fontFamily: MONO,
                }}
                aria-label="Option expiration"
              >
                <SelectValue>{pillLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {expiryOptions.map((o) => (
                  <SelectItem key={o.expiration} value={o.expiration} style={{ fontSize: 12 }}>
                    {o.pillLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
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
          {expiryOptions.length > 0 && selectedExpiration ? (
            <Select value={selectedExpiration} onValueChange={pickAtExpiration}>
              <SelectTrigger
                data-at-expiry-pill
                className="h-6 max-w-full rounded-full px-2 text-[10px] font-normal shadow-none border [&>svg]:hidden"
                style={{
                  background: "transparent",
                  borderColor: "#3f3f46",
                  color: GRAY,
                  fontFamily: MONO,
                }}
                aria-label="Option expiration"
              >
                <SelectValue>{pillLabel}</SelectValue>
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
            <span
              className="text-[10px] tabular-nums px-2 py-0.5 rounded-full border"
              style={{ color: GRAY, borderColor: "#3f3f46" }}
            >
              {pillLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});