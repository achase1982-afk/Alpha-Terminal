import { Clock, Radio, RefreshCw } from "lucide-react";
import type { MarketPulseData } from "../../types/marketPulse";

interface PulseStatusHeaderProps {
  data: MarketPulseData;
  isRefreshing: boolean;
  onRefresh: () => void;
  disabled?: boolean;
}

export function PulseStatusHeader({ data, isRefreshing, onRefresh, disabled }: PulseStatusHeaderProps) {
  const age = Date.now() - data.generatedAt;
  const ageMinutes = Math.floor(age / 60_000);
  const ageLabel =
    ageMinutes < 1
      ? "Just now"
      : ageMinutes < 60
        ? `${ageMinutes}m ago`
        : `${Math.floor(ageMinutes / 60)}h ${ageMinutes % 60}m ago`;

  const isStale = ageMinutes > 15;

  return (
    <div className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-[#2A2A2C]" style={{ background: "#111113" }}>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Radio
            className="w-3 h-3"
            style={{ color: isStale ? "#f23645" : "#00d166" }}
          />
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#71717a]">
            {data.session}
          </span>
        </div>
        <span className="text-[#2A2A2C]">|</span>
        <div className="flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-[#71717a]" />
          <span className={`font-mono text-[10px] tracking-wider ${isStale ? "text-[#f23645]" : "text-[#71717a]"}`}>
            {ageLabel}
          </span>
          {isStale && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FFB800] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#FFB800]" />
            </span>
          )}
        </div>
        <span className="text-[#2A2A2C]">|</span>
        <span className="font-mono text-[10px] text-[#71717a] tracking-wider">
          {data.instrumentCount} instruments
        </span>
      </div>

      <button
        onClick={onRefresh}
        disabled={disabled || isRefreshing}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-[10px] uppercase tracking-wider text-[#71717a] hover:text-[#e4e4e7] hover:bg-[#1a1a1a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ transform: isRefreshing ? undefined : "scale(1)" }}
      >
        <RefreshCw
          className="w-3 h-3"
          style={isRefreshing ? { animation: "spin 1s linear infinite" } : undefined}
        />
        {isRefreshing ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
