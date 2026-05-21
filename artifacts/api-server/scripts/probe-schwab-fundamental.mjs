import fs from "node:fs";
import path from "node:path";

const tokenPath = path.join(process.cwd(), ".data", "schwab-tokens.json");
let tok = "";
try {
  const j = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  tok = j.market?.accessToken ?? "";
} catch {
  console.log("no token file");
  process.exit(0);
}
if (!tok) {
  console.log("no market token");
  process.exit(0);
}
for (const sym of ["AMD", "IBM"]) {
  const r = await fetch(
    `https://api.schwabapi.com/marketdata/v1/quotes?symbols=${sym}&fields=quote,fundamental,reference`,
    { headers: { Authorization: `Bearer ${tok}` } },
  );
  const j = await r.json();
  const f = j[sym]?.fundamental ?? {};
  console.log("\n---", sym, r.status, "---");
  const pick = [
    "buyRatings",
    "holdRatings",
    "sellRatings",
    "strongBuyRatings",
    "strongSellRatings",
    "targetMeanPrice",
    "targetHighPrice",
    "targetLowPrice",
    "numAnalysts",
  ];
  for (const k of pick) {
    if (f[k] != null) console.log(k, f[k]);
  }
  console.log("all keys:", Object.keys(f).sort().join(", "));
}
