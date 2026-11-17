const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Parse YYYY-MM-DD (and optional time suffix) without UTC day shift. */
export function parseContractExpiration(exp: string): { y: number; m: number; d: number } | null {
  if (!exp) return null;
  const clean = exp.split(":")[0].trim();
  const m = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return { y: parseInt(m[1], 10), m: parseInt(m[2], 10) - 1, d: parseInt(m[3], 10) };
}

export function formatOptionExpirationHuman(exp: string, style: "header" | "leg" | "confirm" = "header"): string {
  const p = parseContractExpiration(exp);
  if (!p) return exp;
  if (style === "leg") {
    return `${MONTHS_LONG[p.m]} ${p.d}, ${p.y}`;
  }
  if (style === "confirm") {
    return `${MONTHS_LONG[p.m]} ${p.d}, ${p.y}`;
  }
  return `${MONTHS_LONG[p.m]} ${p.d}, ${p.y} expiry`;
}