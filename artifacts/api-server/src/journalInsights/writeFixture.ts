import { writeFileSync } from "node:fs";
import { buildJournalFixtures } from "./fixtureBook.js";

const target = new URL("../../../alpha-terminal/src/dev-only/journalFixture.json", import.meta.url);
const data = buildJournalFixtures();
writeFileSync(target, JSON.stringify(data));
console.log(JSON.stringify({
  net: data.insights.headline?.netPnl,
  label: data.insights.headline?.label,
  strategies: data.insights.strategies.map((row) => ({
    key: row.key,
    trades: row.trades,
    sample: row.sample,
    net: row.netPnl,
  })),
  accountReturn: data.insights.comparison.accountReturn,
  benchmark: data.insights.comparison.benchmarkReturn,
  open: data.insights.comparison.openPositions,
  unrealized: data.insights.comparison.unrealizedPnl,
}));
