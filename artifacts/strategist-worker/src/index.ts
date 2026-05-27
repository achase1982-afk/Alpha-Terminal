import "dotenv/config";

const CLAIM_POLL_INTERVAL_MS = 1_500;
const WORKER_ID =
  process.env.WORKER_ID ??
  `${process.env.HOSTNAME ?? "local"}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

let shuttingDown = false;

function log(message: string, extra?: Record<string, unknown>) {
  const line = { ts: new Date().toISOString(), workerId: WORKER_ID, message, ...extra };
  console.log(JSON.stringify(line));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Phase 1: empty claim loop. Phase 2 adds SELECT FOR UPDATE SKIP LOCKED + pipeline.
 */
async function runClaimLoop(): Promise<void> {
  log("strategist-worker started (Phase 1 — no job claims yet)");
  while (!shuttingDown) {
    await sleep(CLAIM_POLL_INTERVAL_MS);
  }
  log("strategist-worker claim loop stopped");
}

function installSignalHandlers(): void {
  const onStop = (signal: string) => {
    log(`received ${signal}, draining`);
    shuttingDown = true;
  };
  process.on("SIGTERM", () => onStop("SIGTERM"));
  process.on("SIGINT", () => onStop("SIGINT"));
}

installSignalHandlers();

runClaimLoop().catch((err) => {
  console.error("[strategist-worker] fatal", err);
  process.exit(1);
});
