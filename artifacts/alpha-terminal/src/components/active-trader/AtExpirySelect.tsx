import { memo, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAtChromeStore } from "@/lib/active-trader/atChromeStore";
import { BORDER, GRAY, MONO } from "@/components/options/optionsTheme";

export const AtExpirySelect = memo(function AtExpirySelect({ compact }: { compact?: boolean }) {
  const expiryOptions = useAtChromeStore((s) => s.atExpiryOptions);
  const selectedExpiration = useAtChromeStore((s) => s.atSelectedExpiration);
  const pickAtExpiration = useAtChromeStore((s) => s.pickAtExpiration);
  const pillLabel = useMemo(() => {
    if (!selectedExpiration) return "\u2014";
    return expiryOptions.find((o) => o.expiration === selectedExpiration)?.pillLabel ?? "\u2014";
  }, [expiryOptions, selectedExpiration]);

  if (!selectedExpiration) return null;

  const triggerClass = compact
    ? "h-5 max-w-[7.5rem] shrink-0 rounded-full px-1.5 text-[9px] font-normal shadow-none border [&>svg]:hidden"
    : "h-6 max-w-full rounded-full px-2 text-[10px] font-normal shadow-none border [&>svg]:hidden";

  if (expiryOptions.length === 0) {
    return (
      <span
        data-at-expiry-pill
        className={`${triggerClass} inline-flex items-center`}
        style={{ color: GRAY, borderColor: BORDER, fontFamily: MONO }}
      >
        {pillLabel}
      </span>
    );
  }

  return (
    <Select value={selectedExpiration} onValueChange={pickAtExpiration}>
      <SelectTrigger
        data-at-expiry-pill
        className={triggerClass}
        style={{
          background: "transparent",
          borderColor: BORDER,
          color: GRAY,
          fontFamily: MONO,
        }}
        aria-label="Option expiration"
      >
        <SelectValue>{pillLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {expiryOptions.map((o) => (
          <SelectItem key={o.expiration} value={o.expiration} style={{ fontSize: 12 }}>
            {o.pillLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
});
