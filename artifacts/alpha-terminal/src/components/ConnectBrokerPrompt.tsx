import { Loader2 } from "lucide-react";
import { useBrokerConnect } from "../hooks/useBrokerConnect";

export function ConnectBrokerPrompt({ label, compact }: { label: string; compact?: boolean }) {
  const { oauthUrl, isNavigating, onClick } = useBrokerConnect();
  const disabled = !oauthUrl || isNavigating;

  return (
    <a
      href={oauthUrl ?? "#"}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        if (!oauthUrl) {
          e.preventDefault();
          return;
        }
        onClick();
      }}
      aria-disabled={disabled}
      role="button"
      className="font-mono tracking-wider text-center transition-all cursor-pointer hover:text-[#FFB800] active:scale-[0.98] flex items-center justify-center gap-2 mx-auto no-underline"
      style={{
        fontSize: compact ? 10 : 13,
        color: isNavigating ? "#FFB800" : "#71717a",
        textTransform: "uppercase",
        background: "rgba(17,17,19,0.92)",
        border: "none",
        padding: compact ? "10px 14px" : "14px 18px",
        borderRadius: 12,
        minWidth: compact ? 220 : 280,
        marginTop: compact ? 232 : 256,
        boxShadow: "none",
        opacity: disabled && !isNavigating ? 0.5 : 1,
        pointerEvents: disabled ? "none" : "auto",
        textDecoration: "none",
      }}
    >
      {isNavigating && <Loader2 className="w-3 h-3 animate-spin" />}
      <span>{isNavigating ? "OPENING BROKERAGE..." : label}</span>
    </a>
  );
}
