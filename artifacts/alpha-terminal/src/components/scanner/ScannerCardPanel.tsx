import type { ReactNode } from "react";
import { scannerNumericFontStyle } from "./scannerCard.utils";

export function ScannerCardPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-zinc-800/90 bg-zinc-950/40 p-2.5 min-h-0 flex flex-col gap-1.5">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 border-b border-zinc-800/80 pb-1">
        {title}
      </h4>
      <div className="grid grid-cols-1 gap-1 text-[11px] leading-tight" style={scannerNumericFontStyle}>
        {children}
      </div>
    </div>
  );
}

export function ScannerCardPanelRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 items-baseline">
      <span className="text-zinc-500 truncate">{label}</span>
      <span className={`tabular-nums text-right text-zinc-200 min-w-[3ch] ${valueClassName ?? ""}`}>{value}</span>
    </div>
  );
}
