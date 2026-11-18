import { memo, useState } from "react";
import { Info } from "lucide-react";
import { BG_EXP_BAR, BORDER, DIM, GRAY, MONO, FW_LIGHT, UP, DOWN, WHITE } from "@/components/options/optionsTheme";

export type LaneFilterKey = "call_buy" | "call_sell" | "put_buy" | "put_sell";

const CHIPS: { key: LaneFilterKey; label: string }[] = [
  { key: "call_buy", label: "Call buys ↑" },
  { key: "call_sell", label: "Call sells ↓" },
  { key: "put_buy", label: "Put buys ↓" },
  { key: "put_sell", label: "Put sells ↑" },
];

interface FilterStripProps {
  accentHex: string;
  filters: Record<LaneFilterKey, boolean>;
  onToggle: (key: LaneFilterKey) => void;
  classifiedPct: number | null;
  windowLabel: string;
  stickyTop?: number;
  embedded?: boolean;
}

function LegendBadge({ children, color }: { children: string; color: string }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded"
      style={{ width: 14, height: 14, fontSize: 9, color, background: `${color}26`, marginRight: 4 }}
    >
      {children}
    </span>
  );
}

export const FilterStrip = memo(function FilterStrip({
  filters,
  onToggle,
  classifiedPct,
  windowLabel,
  stickyTop,
  embedded,
}: FilterStripProps) {
  const [legendOpen, setLegendOpen] = useState(false);
  const pct =
    classifiedPct != null ? `${Math.round(classifiedPct * 100)}% classified` : "— classified";

  return (
    <div
      data-at-filter-strip
      className={embedded ? "px-3 py-0.5" : "sticky z-[37] px-3 py-0.5"}
      style={{
        ...(embedded ? {} : { top: stickyTop }),
        background: BG_EXP_BAR,
        borderBottom: `1px solid ${BORDER}`,
        fontFamily: MONO,
        minHeight: 22,
      }}
    >
      <div className="flex items-center gap-2 min-h-[20px]">
        <div
          className="flex flex-1 flex-wrap items-center gap-x-2 gap-y-0 min-w-0"
          style={{ fontSize: 10, fontWeight: FW_LIGHT }}
        >
          {CHIPS.map((c) => {
            const on = filters[c.key];
            return (
              <button
                key={c.key}
                type="button"
                className="shrink-0 bg-transparent border-0 p-0 cursor-pointer"
                style={{
                  color: on ? WHITE : "#52525b",
                  opacity: on ? 1 : 0.55,
                }}
                onClick={() => onToggle(c.key)}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        <span className="shrink-0 tabular-nums truncate max-w-[38%]" style={{ fontSize: 9, color: DIM }}>
          {windowLabel} · {pct}
        </span>
        <button
          type="button"
          aria-label="Flow legend"
          className="shrink-0 p-0"
          style={{ color: legendOpen ? WHITE : DIM }}
          onClick={() => setLegendOpen((v) => !v)}
        >
          <Info className="w-3 h-3" />
        </button>
      </div>
      {legendOpen ? (
        <div className="flex flex-wrap items-center gap-2 pb-0.5" style={{ fontSize: 9, color: DIM }}>
          <span className="flex items-center">
            <LegendBadge color={UP}>B</LegendBadge> buy-led
          </span>
          <span className="flex items-center">
            <LegendBadge color={DOWN}>S</LegendBadge> sell-led
          </span>
          <span className="flex items-center">
            <LegendBadge color={GRAY}>=</LegendBadge> even
          </span>
          <span>L1 inference</span>
        </div>
      ) : null}
    </div>
  );
});