import type { ReactNode } from "react";

type ScannerChromeBarProps = {
  /** Universe selector control (already wired). */
  universeSlot: ReactNode;
  /** Primary scan / loading control; omit when `showScan` is false (idle, no scan yet). */
  scanSlot?: ReactNode;
  /** Optional row below chrome (e.g. connect broker). */
  footerSlot?: ReactNode;
};

/**
 * Scanner page chrome: compact height, sticky at top of scroll, background matches page
 * so list rows do not show through while scrolling.
 */
export function ScannerChromeBar({ universeSlot, scanSlot, footerSlot }: ScannerChromeBarProps) {
  return (
    <div className="sticky top-0 z-20 w-full border-b border-zinc-800/50 bg-[#0c0c0c] py-2">
      <div className="flex max-h-11 min-h-[40px] max-w-4xl items-center justify-between gap-3">
        <div className="min-w-0 shrink">{universeSlot}</div>
        {scanSlot ? <div className="shrink-0">{scanSlot}</div> : <div className="shrink-0" aria-hidden />}
      </div>
      {footerSlot}
    </div>
  );
}
