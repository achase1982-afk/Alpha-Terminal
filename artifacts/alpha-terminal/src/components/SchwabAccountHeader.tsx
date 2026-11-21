import { ChevronDown } from "lucide-react";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";

const C = {
  text: "#f4f4f5",
  dim: "#71717a",
  gold: "#FFB800",
};

interface SchwabAccountHeaderProps {
  /** Compact spacing is retained for embedded portfolio variants. */
  compact?: boolean;
}

/**
 * Portfolio account selector row. Opens the shared brokerage-account sheet.
 */
export function SchwabAccountHeader({ compact = false }: SchwabAccountHeaderProps) {
  const label = useSchwabAccountStore((s) => s.headerLabel());
  const setPickerOpen = useSchwabAccountStore((s) => s.setPickerOpen);
  const accounts = useSchwabAccountStore((s) => s.accounts);

  if (accounts.length <= 1) {
    return null;
  }

  return (
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="w-full flex items-center gap-1 text-left"
        style={{
          padding: compact ? "6px 12px" : "10px 12px 4px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: C.text,
            letterSpacing: -0.2,
          }}
        >
          {label}
        </span>
        <ChevronDown className="w-4 h-4 shrink-0" style={{ color: C.dim }} />
      </button>
  );
}
