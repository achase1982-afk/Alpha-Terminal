import "../src/loadEnv.js";
import { backfillAnalystEstimates } from "../src/lib/fmpBackfill.js";

void (async () => {
  const r = await backfillAnalystEstimates();
  console.log(JSON.stringify(r, null, 2));
})();
