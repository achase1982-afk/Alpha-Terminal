import { memo } from "react";
import { useQuote } from "@/hooks/useQuote";
import { BG, BORDER, DIM, DOWN, MONO, UP, WHITE } from "@/components/options/optionsTheme";

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "\u2014";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtSize(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "\u2014";
  return String(Math.round(n));
}

interface AtFuturesLiveQuoteProps {
  symbol: string;
  layout?: "inline" | "fill";
}

export const AtFuturesLiveQuote = memo(function AtFuturesLiveQuote({ symbol, layout = "inline" }: AtFuturesLiveQuoteProps) {
  const { data: quote } = useQuote(symbol);
  const change = quote?.change ?? null;
  const changePct = quote?.changePct ?? null;
  const changeColor = change == null ? DIM : change > 0 ? UP : change < 0 ? DOWN : DIM;

  const fill = layout === "fill";

  return (
    <div
      className={`px-4 font-mono ${fill ? "flex flex-col flex-1 py-6" : "py-4 border-b"}`}
      style={{
        background: BG,
        borderColor: BORDER,
        fontFamily: MONO,
        ...(fill ? { minHeight: "min(100%, 480px)" } : {}),
      }}
      data-ui-audit="at-futures-live-quote"
    >
      <p className="text-[10px] tracking-widest uppercase mb-4" style={{ color: DIM }}>
        Live quote · {symbol.toUpperCase()}
      </p>
      <div
        className={`grid gap-3 ${fill ? "flex-1 content-center" : ""}`}
        style={{ gridTemplateColumns: "1fr 1fr" }}
      >
        <div>
          <div className="text-[9px] uppercase tracking-wide" style={{ color: DIM }}>Last</div>
          <div className="text-xl tabular-nums" style={{ color: WHITE }}>{fmt(quote?.last)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wide" style={{ color: DIM }}>Change</div>
          <div className="text-sm tabular-nums" style={{ color: changeColor }}>
            {change != null ? `${change >= 0 ? "+" : ""}${fmt(change)}` : "\u2014"}
            {changePct != null ? ` (${changePct >= 0 ? "+" : ""}${fmt(changePct)}%)` : ""}
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wide" style={{ color: DIM }}>Bid</div>
          <div className="text-sm tabular-nums" style={{ color: WHITE }}>
            {fmt(quote?.bid)} <span style={{ color: DIM }}>x {fmtSize(quote?.bidSize)}</span>
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wide" style={{ color: DIM }}>Ask</div>
          <div className="text-sm tabular-nums" style={{ color: WHITE }}>
            {fmt(quote?.ask)} <span style={{ color: DIM }}>x {fmtSize(quote?.askSize)}</span>
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wide" style={{ color: DIM }}>Volume</div>
          <div className="text-sm tabular-nums" style={{ color: WHITE }}>{fmt(quote?.volume, 0)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wide" style={{ color: DIM }}>High / Low</div>
          <div className="text-sm tabular-nums" style={{ color: WHITE }}>
            {fmt(quote?.high)} / {fmt(quote?.low)}
          </div>
        </div>
      </div>
      <p className="text-[10px] mt-4 leading-relaxed shrink-0" style={{ color: DIM }}>
        Streaming quotes only — no Schwab options chain on this symbol.
      </p>
    </div>
  );
});