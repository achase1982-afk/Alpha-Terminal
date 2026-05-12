import { ScannerCardRow } from "./ScannerCardRow";
import { ScannerCardDetail } from "./ScannerCardDetail";
import type { ScannerCardProps } from "./scannerCard.types";

export function ScannerCard({ data, expanded, onToggle, onAction }: ScannerCardProps) {
  const sym = data.symbol;

  return (
    <article className="overflow-hidden bg-black">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`Scanner card ${sym}${expanded ? ", expanded" : ", collapsed"}`}
        className="w-full cursor-pointer text-left transition-colors hover:bg-zinc-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#FFB800]/50"
        onClick={() => {
          // TODO: emit scanner_v3_card_* telemetry once frontend telemetry plumbing is established.
          onToggle();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            // TODO: emit scanner_v3_card_* telemetry once frontend telemetry plumbing is established.
            onToggle();
          }
        }}
      >
        <ScannerCardRow data={data} expanded={expanded} />
      </div>
      {expanded ? <ScannerCardDetail data={data} onAction={onAction} /> : null}
    </article>
  );
}
