import type { FilteredName } from "@workspace/movers-types";
import { PRICE_FLOOR } from "./moversConfig.js";

const LEV_TOKEN =
  /(\b\d(?:\.\d)?x\b|\bultra(?:pro)?\b|\bbull\s*\d?x\b|\bbear\b|\bleveraged\b|\binverse\b|daily\s+target)/i;
const LEV_ISSUER =
  /(direxion|graniteshares|proshares|microsectors|defiance|tradr|t-?rex|leverage\s*shares|kurv|axs|tidal)/i;

export function stripMover(m: { name: string; price: number }): {
  keep: boolean;
  reason?: FilteredName["reason"];
} {
  const n = m.name ?? "";
  if (LEV_TOKEN.test(n) || LEV_ISSUER.test(n)) return { keep: false, reason: "LEVERAGED_ETF" };
  if (m.price < PRICE_FLOOR) return { keep: false, reason: "SUB_5" };
  return { keep: true };
}
