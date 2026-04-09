import { Loader2 } from "lucide-react";
import { useBrokerConnect } from "../hooks/useBrokerConnect";

export function ConnectBrokerPrompt({ label, compact }: { label: string; compact?: boolean }) {
  const { connect, isNavigating } = useBrokerConnect();

  return (
    <button
      type="button"
      onClick={connect}
      disabled={isNavigating}
      className="font-mono tracking-wider text-center transition-all cursor-pointer hover:border-[#FFB800] hover:text-[#FFB800] active:scale-[0.98] flex items-center justify-center gap-2 mx-auto"
      style={{
        fontSize: compact ? 10 : 13,
        color: isNavigating ? "#FFB800" : "#71717a",
        textTransform: "uppercase",
        background: "rgba(17,17,19,0.92)",
        border: "1px solid rgba(255,184,0,0.22)",
        padding: compact ? "10px 14px" : "14px 18px",
        borderRadius: 12,
        minWidth: compact ? 220 : 280,
        boxShadow: isNavigating ? "0 0 0 1px rgba(255,184,0,0.15) inset" : "none",
      }}
    >
      {isNavigating && <Loader2 className="w-3 h-3 animate-spin" />}
      <span>{isNavigating ? "OPENING BROKERAGE..." : label}</span>
    </button>
  );
}
