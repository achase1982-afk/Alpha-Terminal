#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MARKER = "CHAIN_ORDER_FIXTURE_SPX_DEV_ONLY";
const dist = join(process.cwd(), "dist");

function walk(dir, hits) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) walk(p, hits);
    else if (/\.(js|css|html|map)$/i.test(name.name)) {
      const text = readFileSync(p, "utf8");
      if (text.includes(MARKER)) hits.push(p);
    }
  }
}

const hits = [];
try {
  walk(dist, hits);
} catch (err) {
  console.error("verify-chain-order-fixture-prod: dist/ missing — run vite build first");
  process.exit(1);
}

if (hits.length > 0) {
  console.error(`verify-chain-order-fixture-prod: found ${MARKER} in production build:`);
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}

console.log("verify-chain-order-fixture-prod: OK (no dev fixture marker in dist/)");