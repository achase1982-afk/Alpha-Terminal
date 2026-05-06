import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { scannerNumericFontStyle } from "./scannerCard.utils";

export function ScannerCardPanel({
  title,
  children,
  dense,
}: {
  title: string;
  children: ReactNode;
  /** Tighter padding and type for 2×2 expanded grid on mobile */
  dense?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-zinc-800/90 bg-zinc-950/40 min-h-0 flex flex-col",
        dense ? "p-1.5 gap-1" : "p-2.5 gap-1.5",
      )}
    >
      <h4
        className={cn(
          "font-bold uppercase tracking-wider text-muted-foreground border-b border-zinc-800/80",
          dense ? "text-[10px] pb-0.5" : "text-xs pb-1",
        )}
      >
        {title}
      </h4>
      <div
        className={cn(
          "grid grid-cols-1 leading-snug",
          dense ? "gap-0.5 text-[10px] sm:text-[11px]" : "gap-1 text-sm",
        )}
        style={scannerNumericFontStyle}
      >
        {children}
      </div>
    </div>
  );
}

export function ScannerCardPanelRow({
  label,
  value,
  valueClassName,
  dense,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
  dense?: boolean;
}) {
  const isPlaceholderDash = typeof value === "string" && value.trim() === "-";
  return (
    <div
      className={cn(
        "grid items-baseline min-w-0",
        dense ? "grid-cols-[minmax(0,1.1fr)_auto] gap-x-1" : "grid-cols-[minmax(0,1fr)_auto] gap-x-2",
      )}
    >
      <span className="text-muted-foreground truncate" title={label}>
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums text-right min-w-0 max-w-[min(9rem,48vw)] truncate sm:max-w-none",
          isPlaceholderDash ? "text-muted-foreground" : "text-foreground",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}
