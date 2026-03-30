import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
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

  httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== WS_PATH) {
      socket.destroy();
      return;
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

    const hb = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, HEARTBEAT_MS);

    ws.on("close", () => {
      clearInterval(hb);
      clients.delete(ws);
      logger.info({ total: clients.size }, "WS price client disconnected");
    });

    ws.on("error", (err) => {
      clearInterval(hb);
      clients.delete(ws);
      logger.warn({ err }, "WS client error");
    });
  });

  logger.info("WebSocket price server initialized at " + WS_PATH);
}
