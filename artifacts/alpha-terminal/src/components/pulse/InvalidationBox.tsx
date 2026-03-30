import { AlertTriangle, MapPin } from "lucide-react";
import type { PulseInvalidation } from "../../types/marketPulse";

interface InvalidationBoxProps {
  invalidation: PulseInvalidation;
}

export function InvalidationBox({ invalidation }: InvalidationBoxProps) {
  return (
    <div className="rounded-xl border border-[#2A2A2C] overflow-hidden" style={{ background: "#111113" }}>
      <div
        className="px-4 py-2.5 border-b border-[#2A2A2C] flex items-center gap-2"
        style={{ background: "#151517" }}
      >
        <AlertTriangle className="w-3.5 h-3.5 text-[#f23645]" />
        <span className="font-mono text-xs font-bold text-[#e4e4e7]">INVALIDATION</span>
      </div>

      <div className="p-4 space-y-4">
        {invalidation.conditions.length > 0 && (
          <div className="space-y-1.5">
            <span className="font-mono text-[10px] text-[#71717a] uppercase tracking-widest">
              Thesis Breaks If
            </span>
            {invalidation.conditions.map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="font-mono text-[10px] text-[#f23645] mt-0.5">✕</span>
                <span className="font-sans text-xs text-[#a1a1aa]">{c}</span>
              </div>
            ))}
          </div>
        )}

        {invalidation.keyLevels.length > 0 && (
          <div className="space-y-2">
            <span className="font-mono text-[10px] text-[#71717a] uppercase tracking-widest">
              Key Levels
            </span>
            <div className="space-y-1">
              {invalidation.keyLevels.map((lvl, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg border border-[#2A2A2C]"
                  style={{ background: "#0c0c0c" }}
                >
                  <MapPin className="w-3 h-3 text-[#FFB800] shrink-0" />
                  <span className="font-mono text-xs text-[#e4e4e7] font-bold tabular-nums w-16 shrink-0">
                    {lvl.instrument}
                  </span>
                  <span className="font-mono text-xs text-[#FFB800] font-bold tabular-nums w-20 shrink-0">
                    {lvl.level}
                  </span>
                  <span className="font-sans text-[11px] text-[#71717a] flex-1">{lvl.significance}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
