#!/usr/bin/env node
/**
 * Regenerate artifacts/api-server/src/data/spComposite1500Symbols.ts
 *
 * Sources:
 * - S&P 500: artifacts/api-server/src/data/universes.json
 * - S&P 400 / S&P 600: Wikipedia constituent tables (NyseSymbol/NasdaqSymbol templates)
 *
 * Usage: node scripts/generate-sp1500-symbols.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const universesPath = join(root, "artifacts/api-server/src/data/universes.json");
const outPath = join(root, "artifacts/api-server/src/data/spComposite1500Symbols.ts");

const UA = "AlphaTerminal/1.0 (sp1500-maint; +https://github.com)";

async function fetchWikiSymbols(page) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Wikipedia ${page}: HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.parse?.wikitext?.["*"] ?? "";
  const re = /\{\{(?:Nyse|Nasdaq|NYSE|NASDAQ)Symbol\|([A-Z0-9.]+)\}\}/gi;
  const syms = new Set();
  let m;
  while ((m = re.exec(text)) !== null) syms.add(m[1].toUpperCase());
  return [...syms].sort();
}

function chunkLines(symbols, perLine = 12) {
  const lines = [];
  for (let i = 0; i < symbols.length; i += perLine) {
    const chunk = symbols.slice(i, i + perLine);
    lines.push(`  ${chunk.map((s) => `"${s}"`).join(", ")},`);
  }
  return lines.join("\n");
}

const sp500 = JSON.parse(readFileSync(universesPath, "utf8")).sp500.symbols.map((s) => s.toUpperCase());
const sp400 = await fetchWikiSymbols("List_of_S&P_400_companies");
const sp600 = await fetchWikiSymbols("List_of_S&P_600_companies");
const composite = [...new Set([...sp500, ...sp400, ...sp600])].sort();

const ts = `/**
 * S&P Composite 1500 — S&P 500 + S&P 400 MidCap + S&P 600 SmallCap (deduplicated).
 *
 * Maintained via \`node scripts/generate-sp1500-symbols.mjs\` (Wikipedia constituent tables
 * + repo \`universes.json\` S&P 500). Refresh on index reconstitution only.
 *
 * Verification: generated ${composite.length} symbols (sp500=${sp500.length}, sp400=${sp400.length}, sp600=${sp600.length}).
 */
export const SP_COMPOSITE_1500_SYMBOL_STRINGS: readonly string[] = [
${chunkLines(composite)}
] as const;

export const SP_COMPOSITE_1500_COUNT = SP_COMPOSITE_1500_SYMBOL_STRINGS.length;
`;

writeFileSync(outPath, ts);
console.log(`Wrote ${outPath} (${composite.length} symbols)`);
