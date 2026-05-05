import type { ScannerCardAction } from "./scannerCard.types";

export function ScannerCardActions({
  symbol,
  onAction,
}: {
  symbol: string;
  onAction: (action: ScannerCardAction) => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-800/80"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => {
          // TODO: emit scanner_v3_card_* telemetry once frontend telemetry plumbing is established.
          onAction("analyze");
        }}
        className="rounded-md px-3 py-1.5 text-[11px] font-bold bg-primary text-primary-foreground hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0c0c]"
      >
        Analyze in Strategist
      </button>
      <button
        type="button"
        onClick={() => {
          // TODO: emit scanner_v3_card_* telemetry once frontend telemetry plumbing is established.
          onAction("watchlist");
        }}
        className="rounded-md px-3 py-1.5 text-[11px] font-bold border border-zinc-600 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0c0c]"
      >
        + Watchlist
      </button>
      <button
        type="button"
        onClick={() => {
          // TODO: emit scanner_v3_card_* telemetry once frontend telemetry plumbing is established.
          onAction("mute");
        }}
        className="rounded-md px-3 py-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0c0c]"
      >
        Mute today
      </button>
      <span className="sr-only">for {symbol}</span>
    </div>
  );
}
