import { SP_COMPOSITE_1500_SYMBOL_STRINGS } from "../../data/spComposite1500Symbols.js";

const SP1500 = new Set(SP_COMPOSITE_1500_SYMBOL_STRINGS.map((s) => s.toUpperCase()));

/** Display-only tag; does not gate Catalysts inclusion. */
export function isSpComposite1500Member(symbol: string): boolean {
  return SP1500.has(symbol.toUpperCase().trim());
}
