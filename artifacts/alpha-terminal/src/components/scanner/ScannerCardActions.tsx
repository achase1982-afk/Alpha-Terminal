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
      className="flex flex-wrap items-stretch gap-2 border-t border-zinc-900 bg-black pt-2"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => {
          onAction("mute");
        }}
        className="flex-1 rounded-md border border-zinc-700 bg-black px-3 py-2 text-sm font-semibold text-white transition-colors hover:border-zinc-500 hover:bg-zinc-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD100]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      >
        Mute today
      </button>
      <button
        type="button"
        onClick={() => {
          onAction("watchlist");
        }}
        className="flex-1 rounded-md border border-zinc-700 bg-black px-3 py-2 text-sm font-semibold text-white transition-colors hover:border-zinc-500 hover:bg-zinc-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD100]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      >
        + Watchlist
      </button>
      <button
        type="button"
        onClick={() => {
          onAction("analyze");
        }}
        className="flex-1 rounded-md bg-[#FFD100] px-3 py-2 text-sm font-bold text-black transition-colors hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD100] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      >
        Analyze
      </button>
      <span className="sr-only">for {symbol}</span>
    </div>
  );
}
