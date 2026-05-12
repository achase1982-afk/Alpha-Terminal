import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Scanner reference cells — true black canvas to match UAI mockup. */
const PANEL_SURFACE =
  "overflow-hidden rounded-lg border border-zinc-800 bg-black shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]";

export function ScannerCardPanel({
  title,
  children,
  dense,
}: {
  title: string;
  children: ReactNode;
  dense?: boolean;
}) {
  return (
    <div className={cn(PANEL_SURFACE, "flex min-h-0 flex-col")}>
      <div
        className={cn(
          "flex items-center border-b border-primary/20 border-zinc-800/50",
          dense ? "px-3 py-2" : "px-3 py-2.5",
        )}
      >
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{title}</h4>
      </div>
      <div
        className={cn(
          "font-mono text-[11px] leading-relaxed text-zinc-300",
          dense ? "divide-y divide-zinc-800/35 px-3 py-3" : "space-y-2 px-3 py-3",
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
        "grid min-w-0 items-baseline",
        dense ? "grid-cols-[minmax(0,1.1fr)_auto] gap-x-2 py-1.5" : "grid-cols-[minmax(0,1fr)_auto] gap-x-2 py-1",
      )}
    >
      <span className="truncate text-zinc-500" title={label}>
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 max-w-[min(9rem,48vw)] truncate text-right tabular-nums text-zinc-200 sm:max-w-none",
          isPlaceholderDash && "text-zinc-600",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}
