import app from "./app";
import { logger } from "./lib/logger";
import { initTokenStore, setTokenRefreshCallback, getAccessToken } from "./lib/tokenStore";
import { startStreamer, isConnected, injectExternalQuote } from "./lib/schwabStreamer";
import { initWsServer, broadcastToClients } from "./lib/wsServer";
import { connectIB, registerQuoteCacheInjector, registerIBBroadcast } from "./lib/ibStreamer";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function boot() {
  await initTokenStore();

  setTokenRefreshCallback((kind, newAccessToken) => {
    if (kind === "trader" || (kind === "market" && !getAccessToken("trader"))) {
      if (isConnected()) {
        logger.info("TokenStore: %s token refreshed — updating streamer", kind);
        void startStreamer(newAccessToken, []);
      }
    }
  });

  const server = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });

  server.timeout = 120_000;
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 125_000;

  initWsServer(server);

  registerQuoteCacheInjector(injectExternalQuote);
  registerIBBroadcast(broadcastToClients);

  if (process.env.IB_HOST) {
    logger.info("IB_HOST configured — auto-connecting to IB Gateway");
    connectIB().catch((err) => logger.warn({ err }, "IB auto-connect failed (will retry)"));
  }
}

boot().catch((err) => {
  logger.error({ err }, "Failed to boot server");
  process.exit(1);
});
