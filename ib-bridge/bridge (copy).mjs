#!/usr/bin/env node
import { Socket } from "net";
import { WebSocketServer } from "ws";

const IB_HOST = process.env.IB_HOST || "127.0.0.1";
const IB_PORT = Number(process.env.IB_PORT || "4001");
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT || "7497");

const wss = new WebSocketServer({ port: BRIDGE_PORT });

console.log(`[IB-Bridge] WebSocket server listening on port ${BRIDGE_PORT}`);
console.log(`[IB-Bridge] Proxying to IB Gateway at ${IB_HOST}:${IB_PORT}`);
console.log(`[IB-Bridge] Waiting for connections...`);

wss.on("connection", (ws, req) => {
  console.log(`[IB-Bridge] Incoming WebSocket from ${req.socket.remoteAddress}`);

  const tcp = new Socket();

  tcp.connect(IB_PORT, IB_HOST, () => {
    console.log(`[IB-Bridge] Connected to IB Gateway ${IB_HOST}:${IB_PORT}`);
  });

  tcp.on("data", (chunk) => {
    if (ws.readyState === 1) ws.send(chunk);
  });

  ws.on("message", (msg) => {
    tcp.write(Buffer.isBuffer(msg) ? msg : Buffer.from(msg));
  });

  tcp.on("error", (err) => {
    console.error(`[IB-Bridge] TCP error: ${err.message}`);
    ws.close();
  });

  tcp.on("close", () => {
    console.log("[IB-Bridge] TCP closed");
    ws.close();
  });

  ws.on("close", () => {
    console.log("[IB-Bridge] WebSocket closed");
    tcp.destroy();
  });

  ws.on("error", (err) => {
    console.error(`[IB-Bridge] WS error: ${err.message}`);
    tcp.destroy();
  });
});
