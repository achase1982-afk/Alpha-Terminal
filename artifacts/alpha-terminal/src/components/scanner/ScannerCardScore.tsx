import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { dashCell, scannerNumericFontStyle } from "./scannerCard.utils";

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
    <div className="space-y-2 text-[11px]" style={scannerNumericFontStyle}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-zinc-500 font-medium">Composite</span>
        <TierDot score={composite} />
        {composite != null && Number.isFinite(composite) ? (
          <span className="text-zinc-200 font-bold tabular-nums">{Math.round(composite)}/100</span>
        ) : null}
        <div className="flex-1 min-w-[120px] max-w-[220px]">
          <Progress value={barPct} className="h-1.5 bg-zinc-800 [&>div]:bg-primary" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-2 tabular-nums">
            <span className="text-zinc-500">{r.label}</span>
            <span className="text-zinc-200 text-right min-w-[2ch]">
              {r.value != null && Number.isFinite(r.value) ? Math.round(r.value) : dashCell()}
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-between gap-2 text-[10px] uppercase tracking-wide text-zinc-500 pt-0.5 border-t border-zinc-800/60">
        <span>Preset</span>
        <span className="text-zinc-300 font-mono normal-case tracking-normal">
          {data.preset?.trim() || dashCell()}
        </span>
      </div>
    </div>
  );
}
