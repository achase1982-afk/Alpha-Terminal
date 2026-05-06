import { Radar } from "lucide-react";

type ScannerIdleEmptyStateProps = {
  onRunScan: () => void;
  runDisabled: boolean;
};

/**
 * Flat idle empty state (no card chrome) — mirrors Company → Technical Analysis pattern.
 */
export function ScannerIdleEmptyState({ onRunScan, runDisabled }: ScannerIdleEmptyStateProps) {
  return (
    <div className="py-8 text-center">
      <div className="mx-auto mb-5 max-w-xs pb-3">
        <h2 className="font-mono text-sm font-bold tracking-wider text-zinc-200">SCANNER</h2>
        <p className="mt-1 font-mono text-[11px] tracking-widest text-zinc-500">Market candidates</p>
      </div>
      <div className="relative mx-auto mb-4 flex h-10 w-10 items-center justify-center">
        <Radar className="h-8 w-8 text-primary opacity-50" aria-hidden />
      </div>
      <p className="mb-6 font-mono text-xs text-zinc-500">No scan run yet</p>
      <button
        type="button"
        onClick={onRunScan}
        disabled={runDisabled}
        className="inline-flex items-center justify-center rounded-lg border border-primary/80 bg-transparent px-5 py-2 font-mono text-sm font-semibold tracking-wide text-primary transition-colors hover:bg-primary/10 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Run Scan
      </button>
    </div>
  );
}
