/**
 * Schwab LEVELONE_OPTIONS stream `key` format (OCC-style) for US equity options.
 * @see schwabStreamer `processOptionTick` — `item["key"]` must match for cache lookup.
 */
export function buildSchwabOptionStreamerKey(
  underlyingRoot: string,
  expirationYmd: string,
  strike: number,
  optionType: string,
): string | null {
  const root = underlyingRoot.toUpperCase().replace(/^\$/, "").slice(0, 6).padEnd(6, " ");
  let yy = "";
  let mmdd = "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(expirationYmd)) {
    const [y, m, d] = expirationYmd.split("-");
    yy = y!.slice(-2);
    mmdd = `${m}${d}`;
  } else if (/^\d{8}$/.test(expirationYmd)) {
    yy = expirationYmd.slice(2, 4);
    mmdd = expirationYmd.slice(4, 8);
  } else {
    return null;
  }
  const cp =
    optionType === "CALL" || optionType === "call" || optionType === "C"
      ? "C"
      : "P";
  const strikeTicks = Math.round(strike * 1000);
  const strikeStr = String(strikeTicks).padStart(8, "0");
  return `${root}${yy}${mmdd}${cp}${strikeStr}`;
}
