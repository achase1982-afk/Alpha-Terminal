import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { scannerNumericFontStyle } from "./scannerCard.utils";

export function ScannerCardPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-zinc-800/90 bg-zinc-950/40 p-2.5 min-h-0 flex flex-col gap-1.5">
      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-zinc-800/80 pb-1">
        {title}
      </h4>
      <div className="grid grid-cols-1 gap-1 text-sm leading-snug" style={scannerNumericFontStyle}>
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
  const isPlaceholderDash = typeof value === "string" && value.trim() === "-";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 items-baseline">
      <span className="text-muted-foreground truncate">{label}</span>
      <span
        className={cn(
          "tabular-nums text-right min-w-[3ch]",
          isPlaceholderDash ? "text-muted-foreground" : "text-foreground",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}
