/**
 * Theme labels keyed by regex tested against `name + industry` (case-insensitive).
 * First match wins; tune here without code changes elsewhere.
 */
export const MOVERS_THEME_KEYWORDS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "Quantum Computing", pattern: /\bquantum\b/i },
  { label: "Nuclear", pattern: /\bnuclear\b/i },
  { label: "Space", pattern: /\b(space|aerospace|satellite|orbit)\b/i },
  { label: "GLP-1 / Obesity", pattern: /\b(glp-?1|obesity|weight.?loss|ozempic|wegovy)\b/i },
  { label: "AI / Data Center", pattern: /\b(artificial intelligence|\bai\b|data center|gpu)\b/i },
  { label: "Crypto / Bitcoin", pattern: /\b(crypto|bitcoin|blockchain|btc)\b/i },
];
