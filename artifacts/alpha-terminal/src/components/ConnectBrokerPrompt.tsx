import { Loader2 } from "lucide-react";
import { useBrokerConnect } from "../hooks/useBrokerConnect";

export function ConnectBrokerPrompt({ label, compact }: { label: string; compact?: boolean }) {
  const { connect, isNavigating } = useBrokerConnect();

  return (
    <button
      type="button"
      onClick={connect}
      disabled={isNavigating}
      className="font-mono tracking-wider text-center transition-all cursor-pointer hover:text-[#FFB800] active:scale-[0.98] flex items-center justify-center gap-2 mx-auto"
      style={{
        fontSize: compact ? 10 : 13,
        color: isNavigating ? "#FFB800" : "#71717a",
        textTransform: "uppercase",
        background: "rgba(17,17,19,0.92)",
        border: "none",
        padding: compact ? "10px 14px" : "14px 18px",
        borderRadius: 12,
        minWidth: compact ? 220 : 280,
        marginTop: compact ? 136 : 160,
        boxShadow: "none",
      }}
    >
      {isNavigating && <Loader2 className="w-3 h-3 animate-spin" />}
      <span>{isNavigating ? "OPENING BROKERAGE..." : label}</span>
    </button>
  );
}
