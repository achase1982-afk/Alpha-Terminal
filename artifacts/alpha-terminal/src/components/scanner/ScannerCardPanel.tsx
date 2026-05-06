import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Matches `ClusterCard`: bg `#0c0c0c`, border `1px solid rgba(63,63,70,0.5)`, `rounded-lg`. */
const CLUSTER_SURFACE =
  "overflow-hidden rounded-lg bg-[#0c0c0c] border border-[rgba(63,63,70,0.5)]";

export function ScannerCardPanel({
  title,
  children,
  dense,
}: {
  title: string;
  children: ReactNode;
  /** Tighter padding for expanded 2×2 grid (spacing only; typography matches cluster body scale). */
  dense?: boolean;
}) {
  return (
    <div className={cn(CLUSTER_SURFACE, "min-h-0 flex flex-col")}>
      <div
        className={cn(
          "flex items-center border-b border-zinc-800/50",
          dense ? "px-2 py-1" : "px-3 py-2",
        )}
      >
        <h4 className="font-mono text-xs font-bold text-zinc-200 tracking-wider">{title}</h4>
      </div>
      <div
        className={cn(
          "font-mono text-[11px] leading-tight text-zinc-300",
          dense ? "space-y-0.5 px-2 py-1.5" : "space-y-2 px-3 py-2.5",
        )}
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
        "grid items-baseline min-w-0 leading-tight",
        dense ? "grid-cols-[minmax(0,1.1fr)_auto] gap-x-1" : "grid-cols-[minmax(0,1fr)_auto] gap-x-2",
      )}
    >
      <span className="truncate text-zinc-500" title={label}>
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums text-right min-w-0 max-w-[min(9rem,48vw)] truncate sm:max-w-none text-zinc-200",
          isPlaceholderDash && "text-zinc-600",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}
