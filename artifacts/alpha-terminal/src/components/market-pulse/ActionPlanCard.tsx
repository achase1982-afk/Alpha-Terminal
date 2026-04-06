import type { ActionPlanItem, PulseBias } from "../../types/marketPulse";

const POSTURE_COLORS: Record<string, string> = {
  FULL: "#00d166",
  REDUCED: "#FFB800",
  QUARTER: "#FFB800",
  NO_TRADE: "#f23645",
};

const CONVICTION_COLORS: Record<string, string> = {
  HIGH: "#00d166",
  MODERATE: "#FFB800",
  LOW: "#71717a",
};

interface ActionPlanCardProps {
  items: ActionPlanItem[];
  bias: PulseBias;
}

export function ActionPlanCard({ items, bias }: ActionPlanCardProps) {
  if (bias === "NO_EDGE" || items.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800/50 overflow-hidden">
        <div className="px-4 py-2.5 flex items-center gap-2 border-b border-zinc-800/50">
          <span className="font-mono text-xs font-bold text-[#FFB800] tracking-wider">ACTION PLAN</span>
          <span className="font-mono text-xs font-bold text-zinc-500">NO EDGE</span>
        </div>
        <div className="px-4 py-3">
          <p className="font-mono text-sm text-zinc-400 leading-relaxed">
            {items[0]?.condition || "Conflicting signals or insufficient data. No clear edge. Stand aside."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800/50 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-zinc-800/50">
        <span className="font-mono text-xs font-bold text-[#FFB800] tracking-wider">ACTION PLAN</span>
      </div>
      <div className="divide-y divide-zinc-800/50">
        {items.map((item, i) => (
          <div key={i} className="px-4 py-3 space-y-2">
            <div className="font-mono text-sm text-[#FFB800] font-bold">{item.condition}</div>
            <div className="font-mono text-sm text-zinc-200 leading-snug">{item.strategy}</div>
            <div className="font-mono text-[12px] text-zinc-400 leading-relaxed">{item.rationale}</div>
            <div className="flex items-center gap-4">
              <span className="font-mono text-[11px] font-bold tracking-wider" style={{ color: POSTURE_COLORS[item.riskPosture] ?? "#71717a" }}>
                SIZE: {item.riskPosture}
              </span>
              <span className="font-mono text-[11px] font-bold tracking-wider" style={{ color: CONVICTION_COLORS[item.conviction] ?? "#71717a" }}>
                CONV: {item.conviction}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
