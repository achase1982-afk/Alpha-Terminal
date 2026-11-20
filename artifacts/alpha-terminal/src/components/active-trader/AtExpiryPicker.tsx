import { memo, useMemo } from "react";
import { useAtChromeStore } from "@/lib/active-trader/atChromeStore";
import {
  formatAtExpiryPickerButton,
  formatAtExpiryPickerListRow,
} from "@/lib/active-trader/atExpiryPill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GRAY, MONO } from "@/components/options/optionsTheme";
import { AT_HEADER_BG } from "@/lib/active-trader/atChromeContrast";

export const AtExpiryPicker = memo(function AtExpiryPicker({ loading }: { loading?: boolean }) {
  const expiryOptions = useAtChromeStore((s) => s.atExpiryOptions);
  const selectedExpiration = useAtChromeStore((s) => s.atSelectedExpiration);
  const pickAtExpiration = useAtChromeStore((s) => s.pickAtExpiration);

  const buttonLabel = useMemo(() => {
    if (!selectedExpiration) return loading ? "…" : "—";
    return formatAtExpiryPickerButton(selectedExpiration);
  }, [loading, selectedExpiration]);

  const listRows = useMemo(
    () =>
      expiryOptions.map((o) => ({
        ...o,
        listLabel: formatAtExpiryPickerListRow(o.expiration, o.dte),
      })),
    [expiryOptions],
  );

  return (
    <Select
      value={selectedExpiration ?? undefined}
      onValueChange={pickAtExpiration}
      disabled={!selectedExpiration && expiryOptions.length === 0}
    >
      <SelectTrigger
        data-testid="at-expiry-picker"
        data-at-expiry-selected={selectedExpiration ?? ""}
        className="h-7 max-w-[7.25rem] rounded-md px-1 text-[10px] font-medium shadow-none border-0 outline-none ring-0 focus:ring-0 focus-visible:ring-0 focus:ring-offset-0 [&>svg]:ml-0.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:opacity-80"
        style={{
          background: AT_HEADER_BG,
          border: "none",
          boxShadow: "none",
          outline: "none",
          color: GRAY,
          fontFamily: MONO,
        }}
        aria-label="Option expiration"
      >
        <SelectValue placeholder={buttonLabel}>{buttonLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent data-testid="at-expiry-picker-list">
        {listRows.map((o) => (
          <SelectItem key={o.expiration} value={o.expiration} style={{ fontSize: 12, fontFamily: MONO }}>
            {o.listLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
});