import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { verifyToken } from "@clerk/express";
import { logger } from "./logger.js";
import { getSnapshot, getStreamerStatus, registerWsBroadcast } from "./schwabStreamer.js";

const WS_PATH = "/api/ws/prices";
const HEARTBEAT_MS = 25_000;
const clients = new Set<WebSocket>();

function broadcastToClients(event: string, data: unknown) {
  if (clients.size === 0) return;
  const msg = JSON.stringify({ event, data });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

export function initWsServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  registerWsBroadcast(broadcastToClients);

  httpServer.on("upgrade", async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }

    const isDev = process.env.NODE_ENV !== "production";

    if (!isDev) {
      const token = url.searchParams.get("clerk_token");
      if (!token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      try {
        const secretKey = process.env["CLERK_SECRET_KEY"];
        if (!secretKey) throw new Error("CLERK_SECRET_KEY not set");

        await verifyToken(token, {
          secretKey,
          authorizedParties: undefined,
        });
      } catch (err) {
        logger.warn({ err }, "WS auth failed");
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

    ws.send(JSON.stringify({ event: "snapshot", data: { quotes: snapshot, status } }));

    const hb = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: "heartbeat", data: { ts: Date.now() } }));
      }
    }, HEARTBEAT_MS);

    ws.on("close", () => {
      clients.delete(ws);
      clearInterval(hb);
      logger.info({ total: clients.size }, "WS price client disconnected");
    });

    ws.on("error", (err) => {
      logger.warn({ err }, "WS price client error");
      clients.delete(ws);
      clearInterval(hb);
    });
  });

  logger.info("WebSocket price server initialized at %s", WS_PATH);
}
