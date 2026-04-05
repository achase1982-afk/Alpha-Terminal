import { MapPin } from "lucide-react";
import type { LevelToWatch } from "../../types/marketPulse";

interface LevelsToWatchProps {
  levels: LevelToWatch[];
}

export function LevelsToWatch({ levels }: LevelsToWatchProps) {
  if (!levels.length) return null;

  return (
    <div className="rounded-xl border border-[#2A2A2C] overflow-hidden" style={{ background: "#111113" }}>
      <div
        className="px-4 py-2.5 border-b border-[#2A2A2C] flex items-center gap-2"
        style={{ background: "#151517" }}
      >
        <MapPin className="w-3.5 h-3.5 text-[#FFB800]" />
        <span className="font-mono text-xs font-light text-[#e4e4e7] tracking-wider">LEVELS TO WATCH</span>
      </div>
      <div className="p-3 space-y-1">
        {levels.map((lvl, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-3 py-2 rounded-lg border border-[#2A2A2C]"
            style={{ background: "#0c0c0c" }}
          >
            <span className="font-mono text-xs text-[#e4e4e7] font-light tabular-nums w-14 shrink-0">
              {lvl.symbol}
            </span>
            <span className="font-mono text-xs text-[#FFB800] font-light tabular-nums w-16 shrink-0">
              {typeof lvl.level === "number" ? lvl.level.toFixed(2) : lvl.level}
            </span>
            <span
              className="font-mono text-[9px] font-light tracking-wider px-1.5 py-0.5 rounded shrink-0"
              style={{
                color: lvl.direction === "ABOVE" ? "#f23645" : "#00d166",
                background: lvl.direction === "ABOVE" ? "rgba(242,54,69,0.1)" : "rgba(0,209,102,0.1)",
              }}
            >
              {lvl.direction}
            </span>
            <span className="font-sans text-[11px] text-[#71717a] flex-1 truncate">{lvl.significance}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
