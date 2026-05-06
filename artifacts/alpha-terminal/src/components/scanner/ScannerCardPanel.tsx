import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

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
          "text-sm font-semibold uppercase tracking-wide text-white border-b border-zinc-800/80",
          dense ? "pb-0.5" : "pb-1",
        )}
      >
        {title}
      </h4>
      <div className={cn("grid grid-cols-1 leading-snug text-sm", dense ? "gap-0.5" : "gap-1")}>{children}</div>
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
      <span className="text-sm text-white truncate font-sans" title={label}>
        {label}
      </span>
      <span
        className={cn(
          "text-sm font-mono tabular-nums text-right min-w-0 max-w-[min(9rem,48vw)] truncate sm:max-w-none",
          isPlaceholderDash ? "text-gray-400" : "text-white",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}
