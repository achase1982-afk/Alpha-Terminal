import { ChevronDown } from "lucide-react";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";

const C = {
  text: "#f4f4f5",
  dim: "#71717a",
  gold: "#FFB800",
};

interface SchwabAccountHeaderProps {
  /** Optional compact mode for non-portfolio surfaces */
  compact?: boolean;
}

/**
 * Thinkorswim-style account selector row. Opens bottom sheet to pick All Accounts or one sub-account.
 */
export function SchwabAccountHeader({ compact = false }: SchwabAccountHeaderProps) {
  const label = useSchwabAccountStore((s) => s.headerLabel());
  const setPickerOpen = useSchwabAccountStore((s) => s.setPickerOpen);
  const accounts = useSchwabAccountStore((s) => s.accounts);

  if (accounts.length <= 1 && accounts[0]) {
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
            fontSize: compact ? 13 : 15,
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
