import { useState } from "react";
import { ChevronDown, FileText, Database, SlidersHorizontal, Cpu } from "lucide-react";

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
    <div className="rounded-xl overflow-hidden" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors"
        style={{ background: open ? "#151517" : "transparent" }}
      >
        <span className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: "rgba(255,184,0,0.08)" }}>
            <FileText className="w-3 h-3 text-[#FFB800]/60" />
          </div>
          <span className="font-mono text-[10px] font-bold text-[#52525b] uppercase tracking-widest">Audit Trail</span>
          <span className="font-mono text-[9px] px-2 py-0.5 rounded-full"
            style={{ background: "rgba(255,184,0,0.08)", color: "#FFB800", border: "1px solid rgba(255,184,0,0.15)" }}>
            {audit.symbol}
          </span>
        </span>
        <ChevronDown
          className="w-3.5 h-3.5 text-[#3f3f46] transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {open && (
        <div className="animate-in fade-in slide-in-from-top-1 duration-200">
          <AuditSection
            icon={<Database className="w-3 h-3" />}
            title="Underlying Data"
          >
            <AuditRow label="Symbol" value={audit.symbol} />
            <AuditRow label="Price" value={`$${fmtNum(audit.price)}`} highlight />
            <AuditRow label="Change" value={audit.change !== null ? `${audit.change >= 0 ? "+" : ""}${fmtNum(audit.change)}` : "—"}
              color={audit.change !== null ? (audit.change >= 0 ? "#00d166" : "#f23645") : undefined} />
            <AuditRow label="Change %" value={audit.changePct !== null ? `${audit.changePct >= 0 ? "+" : ""}${fmtNum(audit.changePct)}%` : "—"}
              color={audit.changePct !== null ? (audit.changePct >= 0 ? "#00d166" : "#f23645") : undefined} />
            <AuditRow label="Volume" value={audit.volume !== null ? audit.volume.toLocaleString() : "—"} />
          </AuditSection>

          <AuditSection
            icon={<SlidersHorizontal className="w-3 h-3" />}
            title="Strategy Constraints"
          >
            <AuditRow label="Mode" value={audit.autopilot ? "Autopilot" : "Manual"}
              color={audit.autopilot ? "#FFB800" : undefined}
              badge={audit.autopilot} />
            <AuditRow label="Max Risk" value={`$${audit.maxRisk.toLocaleString()}`} />
            {!audit.autopilot && (
              <>
                <AuditRow label="Min PoP" value={`${audit.minPoP}%`} />
                <AuditRow label="Min R:R" value={audit.minRR} />
                <AuditRow label="Bias" value={audit.bias === "auto" ? "Auto-Detect" : audit.bias.charAt(0).toUpperCase() + audit.bias.slice(1)} />
                <AuditRow label="Premium" value={audit.premium === "any" ? "Any" : audit.premium.charAt(0).toUpperCase() + audit.premium.slice(1)} />
              </>
            )}
            <AuditRow label="Avoid Earnings" value={audit.avoidEarnings ? "Yes" : "No"}
              color={audit.avoidEarnings ? "#FFB800" : "#3f3f46"} />
          </AuditSection>

          <AuditSection
            icon={<Cpu className="w-3 h-3" />}
            title="Chain & Model"
            isLast
          >
            <AuditRow label="Calls Scanned" value={String(audit.chainCallCount)} />
            <AuditRow label="Puts Scanned" value={String(audit.chainPutCount)} />
            <AuditRow label="Model" value={audit.model} mono />
            <AuditRow label="Temperature" value={String(audit.temperature)} />
            <AuditRow label="Generated" value={new Date(audit.timestamp).toLocaleTimeString()} />
          </AuditSection>
        </div>
      )}
    </div>
  );
}

function AuditSection({ icon, title, children, isLast }: {
  icon: React.ReactNode; title: string; children: React.ReactNode; isLast?: boolean;
}) {
  return (
    <div className="px-4 py-3" style={{ borderTop: "1px solid #1f1f22", borderBottom: isLast ? "none" : undefined }}>
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="text-[#3f3f46]">{icon}</span>
        <span className="font-mono text-[9px] text-[#3f3f46] uppercase tracking-widest font-bold">{title}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        {children}
      </div>
    </div>
  );
}

function AuditRow({ label, value, color, highlight, badge, mono }: {
  label: string; value: string; color?: string; highlight?: boolean; badge?: boolean; mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[9px] text-[#3f3f46] uppercase tracking-wider">{label}</span>
      <span className={`font-mono text-[10px] tabular-nums ${mono ? "text-[#71717a]" : ""}`}
        style={{
          color: color ?? (highlight ? "#FFB800" : "#a1a1aa"),
          fontWeight: highlight ? 700 : 500,
        }}>
        {badge && (
          <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 -mt-px" style={{ background: color ?? "#FFB800" }} />
        )}
        {value}
      </span>
    </div>
  );
}
