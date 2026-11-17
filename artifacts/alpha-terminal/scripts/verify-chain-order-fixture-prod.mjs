#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MARKERS = [
  "CHAIN_ORDER_FIXTURE_SPX_DEV_ONLY",
  "TICKET_BASELINE_FIXTURE_DEV_ONLY",
];
const dist = join(process.cwd(), "dist");

function walk(dir, hits, marker) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) walk(p, hits, marker);
    else if (/\.(js|css|html|map)$/i.test(name.name)) {
      const text = readFileSync(p, "utf8");
      if (text.includes(marker)) hits.push({ path: p, marker });
    }
  }
}

const hits = [];
try {
  for (const marker of MARKERS) {
    walk(dist, hits, marker);
  }
} catch (err) {
  console.error("verify-chain-order-fixture-prod: dist/ missing — run vite build first");
  process.exit(1);
}

if (hits.length > 0) {
  console.error("verify-chain-order-fixture-prod: dev fixture marker(s) in production build:");
  for (const h of hits) console.error(`  [${h.marker}] ${h.path}`);
  process.exit(1);
}

console.log("verify-chain-order-fixture-prod: OK (no dev fixture markers in dist/)");