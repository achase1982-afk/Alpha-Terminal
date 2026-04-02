import { Crosshair } from "lucide-react";
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
      <div className="rounded-xl border border-[#FFB800]/30 p-4" style={{ background: "rgba(255,184,0,0.06)" }}>
        <div className="flex items-center gap-2 mb-2">
          <Crosshair className="w-4 h-4 text-[#FFB800]" />
          <span className="font-mono text-xs font-bold text-[#FFB800]">NO EDGE</span>
        </div>
        <p className="font-sans text-sm text-[#a1a1aa]">
          {items[0]?.condition || "Conflicting signals or insufficient data. No clear edge. Stand aside."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <Crosshair className="w-4 h-4 text-[#FFB800]" />
        <span className="font-mono text-xs font-bold text-[#e4e4e7] tracking-wider">ACTION PLAN</span>
      </div>
      {items.map((item, i) => (
        <div key={i} className="rounded-xl border border-[#2A2A2C] overflow-hidden" style={{ background: "#111113" }}>
          <div className="p-4 space-y-3">
            <div className="font-mono text-xs text-[#FFB800] font-bold">{item.condition}</div>
            <div className="font-mono text-xs text-[#e4e4e7]">{item.strategy}</div>
            <div className="font-sans text-[11px] text-[#71717a] leading-relaxed">{item.rationale}</div>
            <div className="flex items-center gap-2">
              <span
                className="px-2 py-0.5 rounded-full font-mono text-[9px] font-bold tracking-wider"
                style={{
                  color: POSTURE_COLORS[item.riskPosture] ?? "#71717a",
                }}
              >
                {item.riskPosture}
              </span>
              <span
                className="px-2 py-0.5 rounded-full font-mono text-[9px] font-bold tracking-wider"
                style={{
                  color: CONVICTION_COLORS[item.conviction] ?? "#71717a",
                }}
              >
                {item.conviction}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
