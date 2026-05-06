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
      className="flex flex-wrap items-center justify-end gap-1.5 border-t border-zinc-800/80 pt-1.5"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => {
          // TODO: emit scanner_v3_card_* telemetry once frontend telemetry plumbing is established.
          onAction("mute");
        }}
        className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0c0c]"
      >
        Mute today
      </button>
      <button
        type="button"
        onClick={() => {
          // TODO: emit scanner_v3_card_* telemetry once frontend telemetry plumbing is established.
          onAction("watchlist");
        }}
        className="rounded-md border border-zinc-600 bg-zinc-900 px-3 py-1.5 text-sm font-bold text-zinc-200 transition-colors hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0c0c]"
      >
        + Watchlist
      </button>
      <button
        type="button"
        onClick={() => {
          // TODO: emit scanner_v3_card_* telemetry once frontend telemetry plumbing is established.
          onAction("analyze");
        }}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground transition-colors hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0c0c]"
      >
        Analyze in Strategist
      </button>
      <span className="sr-only">for {symbol}</span>
    </div>
  );
}
