import { memo } from "react";
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
  return (
    <div
      data-at-filter-strip
      className={embedded ? "px-3 py-1.5 space-y-1" : "sticky z-[37] px-3 py-1.5 space-y-1"}
      style={{
        ...(embedded ? {} : { top: stickyTop }),
        background: BG_EXP_BAR,
        borderBottom: `1px solid ${BORDER}`,
        fontFamily: MONO,
      }}
    >
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1"
        style={{ fontSize: 11, fontWeight: FW_LIGHT }}
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
                textDecoration: on ? "none" : "none",
                opacity: on ? 1 : 0.55,
              }}
              onClick={() => onToggle(c.key)}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2" style={{ fontSize: 10, color: DIM }}>
        <span>
          Classified contracts · {windowLabel}
          {classifiedPct != null ? ` · ${Math.round(classifiedPct * 100)}% classified (L1 inference)` : ""}
        </span>
        <div className="flex items-center gap-2">
          <span className="flex items-center">
            <LegendBadge color={UP}>B</LegendBadge> buy-led
          </span>
          <span className="flex items-center">
            <LegendBadge color={DOWN}>S</LegendBadge> sell-led
          </span>
          <span className="flex items-center">
            <LegendBadge color={GRAY}>=</LegendBadge> even
          </span>
        </div>
      </div>
    </div>
  );
});