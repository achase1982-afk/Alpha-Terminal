import { Loader2 } from "lucide-react";
import { useBrokerConnect } from "../hooks/useBrokerConnect";

export function ConnectBrokerPrompt({ label, compact }: { label: string; compact?: boolean }) {
  const { connect, isNavigating } = useBrokerConnect();

  return (
    <button
      type="button"
      onClick={connect}
      disabled={isNavigating}
      className="font-mono tracking-wider text-center transition-colors cursor-pointer hover:text-[#FFB800] flex items-center gap-2"
      style={{
        fontSize: compact ? 10 : 12,
        color: isNavigating ? "#FFB800" : "#71717a",
        textTransform: "uppercase",
        background: "none",
        border: "none",
        padding: 0,
      }}
    >
      {isNavigating && <Loader2 className="w-3 h-3 animate-spin" />}
      {label}
    </button>
  );
}
