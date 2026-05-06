import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { dashCell, scannerScoreTierDotClassName } from "./scannerCard.utils";

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
    <div className="space-y-1 text-sm min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="inline-flex shrink-0 items-center gap-0.5">
          <span className="text-sm font-medium text-zinc-200">Composite</span>
          <span className={scannerScoreTierDotClassName(composite, "md")} aria-hidden />
        </span>
        {composite != null && Number.isFinite(composite) ? (
          <span className="shrink-0 font-mono text-base font-bold tabular-nums text-zinc-100">
            {Math.round(composite)}/100
          </span>
        ) : (
          <span className="shrink-0 font-mono text-base font-bold tabular-nums text-zinc-600">{dashCell()}</span>
        )}
        <div className="min-w-[72px] flex-1 basis-[35%]">
          <Progress value={barPct} className="h-1.5 bg-zinc-800 [&>div]:bg-primary" />
        </div>
      </div>

      <div className="grid w-full min-w-0 grid-cols-5 gap-px overflow-hidden rounded border border-zinc-800/80 bg-zinc-800/40 sm:gap-0.5">
        {rows.map((r) => {
          const cell = r.value != null && Number.isFinite(r.value) ? String(Math.round(r.value)) : dashCell();
          const isDash = cell === dashCell();
          return (
            <div
              key={r.label}
              className="flex min-w-0 flex-col items-center justify-center gap-0.5 bg-zinc-950/50 px-0.5 py-1 text-center"
            >
              <span
                className="inline-flex w-full min-w-0 items-center justify-center gap-0.5"
                title={r.label}
              >
                <span className={scannerScoreTierDotClassName(r.value, "md")} aria-hidden />
                <span className="min-w-0 truncate font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-200 leading-none sm:text-xs">
                  {r.label}
                </span>
              </span>
              <span
                className={cn(
                  "font-mono text-base font-semibold tabular-nums leading-none",
                  isDash ? "text-zinc-600" : "text-zinc-100",
                )}
              >
                {cell}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-baseline justify-between gap-2 border-t border-zinc-800/60 pt-0.5">
        <span className="shrink-0 font-mono text-xs font-bold uppercase tracking-wider text-zinc-200">Preset</span>
        <span
          className={cn(
            "max-w-[70%] min-w-0 truncate text-right font-mono text-sm tabular-nums",
            !data.matchedPreset?.trim() ? "text-zinc-600" : "text-amber-400/90",
          )}
          title={data.matchedPreset?.trim() || undefined}
        >
          {data.matchedPreset?.trim() || dashCell()}
        </span>
      </div>
    </div>
  );
}
