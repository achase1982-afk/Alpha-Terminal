import type { TuningWatchlist } from "@/lib/tuningWatchlistUi";
import { WATCHLIST_LABELS, WATCHLIST_SIZES } from "@/lib/tuningWatchlistUi";

const ORDER: TuningWatchlist[] = ["mega_cap_core", "active_trade", "cyclicals_macro"];

export function TuningWatchlistBar(props: {
  value: TuningWatchlist;
  onChange: (v: TuningWatchlist) => void;
  lastScanLabel: string | null;
  onScanWatchlist: () => void;
  scanDisabled: boolean;
}) {
  const { value, onChange, lastScanLabel, onScanWatchlist, scanDisabled } = props;
  const count = WATCHLIST_SIZES[value];
  const label = WATCHLIST_LABELS[value];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-800/60 bg-zinc-900/40 px-2 py-1.5 text-[11px]">
      <span className="shrink-0 font-mono uppercase tracking-wide text-zinc-500">Tuning</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as TuningWatchlist)}
        className="max-w-[min(100%,220px)] rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-100"
        aria-label="Tuning watchlist"
      >
        {ORDER.map((k) => (
          <option key={k} value={k}>
            {WATCHLIST_LABELS[k]} ({WATCHLIST_SIZES[k]})
          </option>
        ))}
      </select>
      <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-zinc-300">{count} names</span>
      {lastScanLabel ? (
        <span className="text-zinc-500">
          Last scan <span className="text-zinc-400">{lastScanLabel}</span>
        </span>
      ) : (
        <span className="text-zinc-600">No watchlist scan yet</span>
      )}
      <button
        type="button"
        onClick={onScanWatchlist}
        disabled={scanDisabled}
        className="ml-auto shrink-0 rounded border border-primary/60 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-30"
      >
        Scan {label}
      </button>
    </div>
  );
}
