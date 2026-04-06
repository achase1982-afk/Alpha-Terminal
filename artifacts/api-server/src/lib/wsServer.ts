import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { verifyToken } from "@clerk/express";
import { logger } from "./logger.js";
import { getSnapshot, getStreamerStatus, registerWsBroadcast } from "./schwabStreamer.js";
import {
  registerPortfolioBroadcast,
  onPortfolioSubscribe,
  onPortfolioUnsubscribe,
  getLastPortfolioSnapshot,
} from "./portfolioPoller.js";

const WS_PATH = "/api/ws/prices";
const HEARTBEAT_MS = 25_000;
const DEV_BYPASS = process.env.DEV_BYPASS_AUTH === "true";
const clients = new Set<WebSocket>();
const portfolioSubscribers = new Set<WebSocket>();

export function broadcastToClients(event: string, data: unknown) {
  if (clients.size === 0) return;

  const isPortfolio = event === "portfolioAccount" || event === "portfolioOrders";
  const targets = isPortfolio ? portfolioSubscribers : clients;
  if (targets.size === 0) return;

  const msg = JSON.stringify({ event, data });
  for (const ws of targets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

export function initWsServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  registerWsBroadcast(broadcastToClients);
  registerPortfolioBroadcast(broadcastToClients);

  httpServer.on("upgrade", async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }

    if (!DEV_BYPASS) {
      const token = url.searchParams.get("clerk_token");
      if (!token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      try {
        await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY! });
      } catch (err) {
        logger.warn({ err }, "WS Clerk token verification failed");
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    clients.add(ws);
    logger.info({ total: clients.size }, "WS price client connected");

    const snapshot = getSnapshot();
    const status = getStreamerStatus();

    if (status) {
      ws.send(JSON.stringify({ event: "streamerStatus", data: status }));
    }
    if (snapshot && Object.keys(snapshot).length > 0) {
      ws.send(JSON.stringify({ event: "snapshot", data: snapshot }));
    }

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.action === "subscribePortfolio") {
          if (!portfolioSubscribers.has(ws)) {
            portfolioSubscribers.add(ws);
            onPortfolioSubscribe();
            logger.info({ total: portfolioSubscribers.size }, "WS portfolio subscriber added");
            const snap = getLastPortfolioSnapshot();
            if (snap) {
              if (snap.account) ws.send(JSON.stringify({ event: "portfolioAccount", data: snap.account }));
              if (snap.orders) ws.send(JSON.stringify({ event: "portfolioOrders", data: snap.orders }));
            }
          }
        } else if (msg.action === "unsubscribePortfolio") {
          if (portfolioSubscribers.has(ws)) {
            portfolioSubscribers.delete(ws);
            onPortfolioUnsubscribe();
            logger.info({ total: portfolioSubscribers.size }, "WS portfolio subscriber removed");
          }
        }
      } catch {}
    });

    const hb = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, HEARTBEAT_MS);

    ws.on("close", () => {
      clearInterval(hb);
      clients.delete(ws);
      if (portfolioSubscribers.has(ws)) {
        portfolioSubscribers.delete(ws);
        onPortfolioUnsubscribe();
      }
      logger.info({ total: clients.size }, "WS price client disconnected");
    });

    ws.on("error", (err) => {
      clearInterval(hb);
      clients.delete(ws);
      if (portfolioSubscribers.has(ws)) {
        portfolioSubscribers.delete(ws);
        onPortfolioUnsubscribe();
      }
      logger.warn({ err }, "WS client error");
    });
  });

  logger.info("WebSocket price server initialized at " + WS_PATH);
}
