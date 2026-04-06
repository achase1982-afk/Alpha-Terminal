import type { ActionPlanItem, PulseBias } from "../../types/marketPulse";

const POSTURE_COLORS: Record<string, string> = {
  FULL: "#22c55e",
  REDUCED: "#fbbf24",
  QUARTER: "#fbbf24",
  NO_TRADE: "#ef4444",
};

const CONVICTION_COLORS: Record<string, string> = {
  HIGH: "#22c55e",
  MODERATE: "#fbbf24",
  LOW: "#52525b",
};

interface ActionPlanCardProps {
  items: ActionPlanItem[];
  bias: PulseBias;
}

export function ActionPlanCard({ items, bias }: ActionPlanCardProps) {
  if (bias === "NO_EDGE" || items.length === 0) {
    return (
      <div style={{ background: "#000", border: "1px solid #1a1a1a" }}>
        <div className="px-4 py-2 flex items-center gap-2" style={{ borderBottom: "1px solid #1a1a1a" }}>
          <span className="font-mono text-[10px] font-bold text-[#fbbf24] tracking-widest">ACTION PLAN</span>
          <span className="font-mono text-[10px] font-bold text-[#52525b]">NO EDGE</span>
        </div>
        <div className="px-4 py-3">
          <p className="font-mono text-[11px] text-[#71717a] leading-[1.6]">
            {items[0]?.condition || "Conflicting signals or insufficient data. No clear edge. Stand aside."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#000", border: "1px solid #1a1a1a" }}>
      <div className="px-4 py-2" style={{ borderBottom: "1px solid #1a1a1a" }}>
        <span className="font-mono text-[10px] font-bold text-[#fbbf24] tracking-widest">ACTION PLAN</span>
      </div>
      <div className="divide-y divide-[#1a1a1a]">
        {items.map((item, i) => (
          <div key={i} className="px-4 py-3 space-y-2">
            <div className="font-mono text-[11px] text-[#fbbf24] font-bold">{item.condition}</div>
            <div className="font-mono text-[11px] text-[#e4e4e7] leading-[1.5]">{item.strategy}</div>
            <div className="font-mono text-[10px] text-[#52525b] leading-[1.6]">{item.rationale}</div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[9px] font-bold tracking-wider" style={{ color: POSTURE_COLORS[item.riskPosture] ?? "#52525b" }}>
                SIZE: {item.riskPosture}
              </span>
              <span className="font-mono text-[9px] font-bold tracking-wider" style={{ color: CONVICTION_COLORS[item.conviction] ?? "#52525b" }}>
                CONV: {item.conviction}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
