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
    <div className="sticky top-0 z-20 w-full border-b border-zinc-800/50 bg-[#0c0c0c] px-3 py-2 sm:px-4">
      <div className="flex w-full max-w-4xl min-h-[40px] max-h-11 items-center gap-2">
        <div className="min-w-0 flex-1 overflow-hidden">{universeSlot}</div>
        {scanSlot ? (
          <div className="flex shrink-0 flex-none items-center self-center">{scanSlot}</div>
        ) : (
          <div className="shrink-0 flex-none" aria-hidden />
        )}
      </div>
      {footerSlot}
    </div>
  );
}
