import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { TELEMETRY_COPY_LAYER_Z } from "@/lib/telemetryCopyLayer";

export interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Bottom sheet portaled to `document.body` with explicit `fixed` stacking — no Vaul/Radix Drawer.
 * Nesting Vaul inside an extra `createPortal` caused sheet content to reconcile into the Telemetry
 * scroll container (checkboxes appeared at the bottom of the list and scrolled with it).
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description = "",
  children,
  className,
}: BottomSheetProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  React.useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: TELEMETRY_COPY_LAYER_Z }}>
      <button
        type="button"
        className="absolute inset-0 bg-black/80"
        aria-label="Dismiss"
        onClick={() => onOpenChange(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="telemetry-bottom-sheet-title"
        aria-describedby="telemetry-bottom-sheet-desc"
        className={cn(
          "absolute inset-x-0 bottom-0 flex max-h-[90vh] flex-col rounded-t-[10px] border border-zinc-700 bg-zinc-950 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-zinc-100 shadow-xl outline-none",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="telemetry-bottom-sheet-title" className="sr-only">
          {title}
        </h2>
        <p id="telemetry-bottom-sheet-desc" className="sr-only">
          {description || title}
        </p>
        <div
          className="mx-auto mb-3 h-1.5 w-12 shrink-0 rounded-full bg-zinc-600"
          aria-hidden
        />
        <div className="flex min-h-0 flex-1 flex-col px-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
