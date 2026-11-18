export type AtGlanceMode = "index" | "stock" | "futures";

const INDEX = new Set(["SPX", "SPXW", "$SPX"]);

export function resolveAtGlanceMode(symbol: string): AtGlanceMode {
  const raw = symbol.trim();
  if (raw.startsWith("/")) return "futures";
  const bare = raw.replace(/^\$/, "").toUpperCase();
  if (INDEX.has(raw.toUpperCase()) || INDEX.has(bare)) return "index";
  return "stock";
}

export function isIndexSymbol(symbol: string): boolean {
  return resolveAtGlanceMode(symbol) === "index";
}