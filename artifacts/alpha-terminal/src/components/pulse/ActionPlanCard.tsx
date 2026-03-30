import { Crosshair, Shield, Target, ArrowRight } from "lucide-react";
import type { PulseActionPlan } from "../../types/marketPulse";

const DIRECTION_COLORS = {
  BULLISH: "#00d166",
  BEARISH: "#f23645",
  NEUTRAL: "#FFB800",
};

interface ActionPlanCardProps {
  plan: PulseActionPlan;
}

export function ActionPlanCard({ plan }: ActionPlanCardProps) {
  const dirColor = DIRECTION_COLORS[plan.direction];

  return (
    <div className="rounded-xl border border-[#2A2A2C] overflow-hidden" style={{ background: "#111113" }}>
      <div
        className="px-4 py-2.5 border-b border-[#2A2A2C] flex items-center gap-2"
        style={{ background: "#151517" }}
      >
        <Crosshair className="w-4 h-4" style={{ color: dirColor }} />
        <span className="font-mono text-xs font-bold text-[#e4e4e7]">ACTION PLAN</span>
        <span
          className="ml-auto px-2 py-0.5 rounded-full font-mono text-[9px] font-bold tracking-wider"
          style={{
            background: `${dirColor}15`,
            color: dirColor,
          }}
        >
          {plan.direction}
        </span>
      </div>

      <div className="p-4 space-y-4">
        <div
          className="rounded-lg px-3 py-2.5 border flex items-start gap-2"
          style={{ background: `${dirColor}08`, borderColor: `${dirColor}30` }}
        >
          <ArrowRight className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: dirColor }} />
          <span className="font-mono text-xs" style={{ color: dirColor }}>
            {plan.primaryTrade}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-[#2A2A2C] p-3 flex flex-col gap-1" style={{ background: "#0c0c0c" }}>
            <div className="flex items-center gap-1.5">
              <Crosshair className="w-3 h-3 text-[#FFB800]" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-[#71717a]">Entry</span>
            </div>
            <span className="font-mono text-sm font-bold text-[#e4e4e7] tabular-nums">{plan.entry}</span>
          </div>
          <div className="rounded-lg border border-[#2A2A2C] p-3 flex flex-col gap-1" style={{ background: "#0c0c0c" }}>
            <div className="flex items-center gap-1.5">
              <Shield className="w-3 h-3 text-[#f23645]" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-[#71717a]">Stop</span>
            </div>
            <span className="font-mono text-sm font-bold text-[#e4e4e7] tabular-nums">{plan.stop}</span>
          </div>
          <div className="rounded-lg border border-[#2A2A2C] p-3 flex flex-col gap-1" style={{ background: "#0c0c0c" }}>
            <div className="flex items-center gap-1.5">
              <Target className="w-3 h-3 text-[#00d166]" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-[#71717a]">Target</span>
            </div>
            <span className="font-mono text-sm font-bold text-[#e4e4e7] tabular-nums">{plan.target}</span>
          </div>
        </div>

        <div className="font-sans text-xs text-[#a1a1aa] leading-relaxed">
          {plan.rationale}
        </div>

        {plan.alternativePlays.length > 0 && (
          <div className="border-t border-[#2A2A2C] pt-3">
            <span className="font-mono text-[10px] text-[#71717a] uppercase tracking-widest block mb-2">
              Alternative Plays
            </span>
            <div className="space-y-1.5">
              {plan.alternativePlays.map((play, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="font-mono text-[10px] text-[#FFB800] mt-0.5">→</span>
                  <span className="font-sans text-xs text-[#a1a1aa]">{play}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
