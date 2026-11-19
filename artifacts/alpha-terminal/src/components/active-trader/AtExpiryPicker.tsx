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

export const AtExpiryPicker = memo(function AtExpiryPicker({ loading }: { loading?: boolean }) {
  const expiryOptions = useAtChromeStore((s) => s.atExpiryOptions);
  const selectedExpiration = useAtChromeStore((s) => s.atSelectedExpiration);
  const pickAtExpiration = useAtChromeStore((s) => s.pickAtExpiration);

  const buttonLabel = useMemo(() => {
    if (!selectedExpiration) return loading ? "Expiry …" : "Expiry —";
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
        className="h-7 max-w-[9.5rem] rounded-md px-1.5 text-[10px] font-medium shadow-none border [&>svg]:ml-0.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:opacity-80"
        style={{
          background: "rgba(255,255,255,0.04)",
          borderColor: "#3f3f46",
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