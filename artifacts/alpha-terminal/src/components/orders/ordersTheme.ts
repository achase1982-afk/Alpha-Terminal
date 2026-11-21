export const ordersFont =
  `'Inter','SF Pro Text',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;

/** Aligned with terminal `bg-background` / portfolio chrome tokens. */
export const ordersChrome = {
  bg: "hsl(var(--background))",
  surface: "hsl(var(--secondary))",
  border: "#27272a",
  borderHi: "#3f3f46",
  text: "#e4e4e7",
  textMuted: "#d4d4d8",
  textDim: "#a1a1aa",
  dim: "#71717a",
  gold: "#FFB800",
  green: "#00d166",
  red: "#dc2626",
} as const;

export function fmtCurrency(n: number): string {
  const abs = Math.abs(n);
  const str = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${str}` : `$${str}`;
}

export function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function formatOptionSymbol(sym: string, includeUnderlying = true): string {
  const match = sym.trim().match(/^(\w+)\s+(\d{6})([CP])(\d{8})$/);
  if (!match) return sym.trim();
  const [, underlying, dateStr, pc, strikeRaw] = match;
  const strike = parseInt(strikeRaw, 10) / 1000;
  const strikeStr = strike % 1 === 0 ? String(strike) : strike.toFixed(1);
  const prefix = includeUnderlying ? `${underlying} ` : "";
  return `${prefix}${dateStr.slice(0, 2)}/${dateStr.slice(2, 4)}/${dateStr.slice(4, 6)} ${strikeStr}${pc}`;
}

export function statusColor(status: string): string {
  switch (status) {
    case "FILLED":
      return ordersChrome.green;
    case "CANCELED":
    case "REJECTED":
    case "EXPIRED":
      return ordersChrome.red;
    case "WORKING":
    case "PENDING_ACTIVATION":
      return ordersChrome.gold;
    default:
      return ordersChrome.textDim;
  }
}