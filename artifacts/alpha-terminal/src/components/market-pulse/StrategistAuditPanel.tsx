import { useState } from "react";
import { ChevronDown, FileText } from "lucide-react";

export interface StrategistAuditData {
  symbol: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  autopilot: boolean;
  maxRisk: number;
  minPoP: number;
  minRR: string;
  bias: string;
  premium: string;
  avoidEarnings: boolean;
  chainCallCount: number;
  chainPutCount: number;
  model: string;
  temperature: number;
  timestamp: number;
}

function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function StrategistAuditPanel({ audit }: { audit: StrategistAuditData }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-[#2A2A2C] overflow-hidden" style={{ background: "#111113" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#1C1C1E] transition-colors"
      >
        <span className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-[#FFB800]" />
          <span className="font-mono text-[10px] font-bold text-[#a1a1aa] uppercase tracking-widest">Strategist Audit</span>
          <span className="font-mono text-[9px] text-[#52525b]">{audit.symbol}</span>
        </span>
        <ChevronDown
          className="w-3.5 h-3.5 text-[#52525b] transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {open && (
        <div className="border-t border-[#2A2A2C] animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="px-3 py-3">
            <div className="font-mono text-[9px] text-[#52525b] uppercase tracking-widest mb-2 px-1">Underlying Data Fed to Gemini</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-1">
              <AuditRow label="Symbol" value={audit.symbol} />
              <AuditRow label="Price" value={`$${fmtNum(audit.price)}`} />
              <AuditRow label="Change" value={audit.change !== null ? `${audit.change >= 0 ? "+" : ""}${fmtNum(audit.change)}` : "—"} color={audit.change !== null ? (audit.change >= 0 ? "#00d166" : "#f23645") : undefined} />
              <AuditRow label="Change %" value={audit.changePct !== null ? `${audit.changePct >= 0 ? "+" : ""}${fmtNum(audit.changePct)}%` : "—"} color={audit.changePct !== null ? (audit.changePct >= 0 ? "#00d166" : "#f23645") : undefined} />
              <AuditRow label="Volume" value={audit.volume !== null ? audit.volume.toLocaleString() : "—"} />
            </div>
          </div>

          <div className="px-3 py-3 border-t border-[#2A2A2C]">
            <div className="font-mono text-[9px] text-[#52525b] uppercase tracking-widest mb-2 px-1">Strategy Constraints</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-1">
              <AuditRow label="Mode" value={audit.autopilot ? "Autopilot" : "Manual"} color={audit.autopilot ? "#FFB800" : "#a1a1aa"} />
              <AuditRow label="Max Risk" value={`$${audit.maxRisk}`} />
              {!audit.autopilot && (
                <>
                  <AuditRow label="Min PoP" value={`${audit.minPoP}%`} />
                  <AuditRow label="Min R:R" value={audit.minRR} />
                  <AuditRow label="Bias" value={audit.bias === "auto" ? "Auto-Detect" : audit.bias} />
                  <AuditRow label="Premium" value={audit.premium === "any" ? "Any" : audit.premium} />
                </>
              )}
              <AuditRow label="Avoid Earnings" value={audit.avoidEarnings ? "Yes" : "No"} />
            </div>
          </div>

          <div className="px-3 py-3 border-t border-[#2A2A2C]">
            <div className="font-mono text-[9px] text-[#52525b] uppercase tracking-widest mb-2 px-1">Chain & Model</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-1">
              <AuditRow label="Calls" value={String(audit.chainCallCount)} />
              <AuditRow label="Puts" value={String(audit.chainPutCount)} />
              <AuditRow label="Model" value={audit.model} />
              <AuditRow label="Temperature" value={String(audit.temperature)} />
              <AuditRow label="Generated" value={new Date(audit.timestamp).toLocaleTimeString()} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AuditRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[9px] text-[#52525b] uppercase tracking-wider">{label}</span>
      <span className="font-mono text-[10px] tabular-nums font-medium" style={{ color: color ?? "#e4e4e7" }}>{value}</span>
    </div>
  );
}
