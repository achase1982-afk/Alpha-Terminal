import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { dashCell } from "./scannerCard.utils";

function TierDot({ score }: { score: number | null }) {
  if (score == null || !Number.isFinite(score)) {
    return <span className="inline-block h-2 w-2 rounded-full bg-zinc-600 shrink-0" aria-hidden title="Score pending" />;
  }
  let cls = "bg-zinc-500";
  if (score >= 75) cls = "bg-emerald-400 shadow-[0_0_6px_hsl(var(--terminal-success)/0.5)]";
  else if (score >= 50) cls = "bg-amber-400";
  else if (score >= 25) cls = "bg-zinc-400";
  else cls = "bg-red-400";
  return <span className={cn("inline-block h-2 w-2 rounded-full shrink-0", cls)} aria-hidden />;
}

export function ScannerCardScore({ data }: { data: ScannerCardData }) {
  const sc = data.scoreComponents;
  const rows: { label: string; value: number | null }[] = [
    { label: "Liquidity", value: sc?.liquidity ?? null },
    { label: "Volatility", value: sc?.volContext ?? null },
    { label: "Catalyst", value: sc?.catalyst ?? null },
    { label: "Flow", value: sc?.flow ?? null },
    { label: "Technical", value: sc?.technical ?? null },
  ];

  const composite = data.score;
  const barPct =
    composite != null && Number.isFinite(composite) ? Math.min(100, Math.max(0, composite)) : 0;

  return (
    <div className="space-y-1.5 text-sm min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 w-full min-w-0">
        <span className="text-sm font-medium text-white shrink-0">Composite</span>
        <TierDot score={composite} />
        {composite != null && Number.isFinite(composite) ? (
          <span className="text-base font-mono font-bold tabular-nums text-white shrink-0">{Math.round(composite)}/100</span>
        ) : null}
        <div className="flex-1 min-w-[100px] basis-[40%]">
          <Progress value={barPct} className="h-1.5 bg-zinc-800 [&>div]:bg-primary" />
        </div>
      </div>

      <div className="grid grid-cols-5 gap-px sm:gap-0.5 w-full min-w-0 rounded border border-zinc-800/80 overflow-hidden bg-zinc-800/40">
        {rows.map((r) => {
          const cell = r.value != null && Number.isFinite(r.value) ? String(Math.round(r.value)) : dashCell();
          const isDash = cell === dashCell();
          return (
            <div
              key={r.label}
              className="flex flex-col items-center justify-center gap-0.5 min-w-0 bg-zinc-950/50 px-0.5 py-1.5 text-center"
            >
              <span
                className="w-full text-xs uppercase tracking-wider text-white leading-none truncate"
                title={r.label}
              >
                {r.label}
              </span>
              <span
                className={cn(
                  "text-base font-mono font-semibold tabular-nums leading-none",
                  isDash ? "text-gray-400" : "text-white",
                )}
              >
                {cell}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between gap-2 items-baseline border-t border-zinc-800/60 pt-0.5">
        <span className="text-xs uppercase tracking-wider text-white shrink-0">Preset</span>
        <span
          className={cn(
            "text-sm font-mono tabular-nums text-right min-w-0 max-w-[70%] truncate",
            !data.preset?.trim() ? "text-gray-400" : "text-white",
          )}
          title={data.preset?.trim() || undefined}
        >
          {data.preset?.trim() || dashCell()}
        </span>
      </div>
    </div>
  );
}
