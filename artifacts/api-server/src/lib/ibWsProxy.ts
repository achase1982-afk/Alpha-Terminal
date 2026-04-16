import { createServer, type Server, type Socket } from "net";
import WebSocket from "ws";
import { logger } from "./logger.js";

const LOCAL_PORT = 4002;
let proxyServer: Server | null = null;
let activeWs: WebSocket | null = null;
let activeTcpClient: Socket | null = null;

export function startIBWsProxy(wsUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    if (proxyServer) {
      resolve(LOCAL_PORT);
      return;
    }

    proxyServer = createServer((tcpClient: Socket) => {
      logger.info("IB-WsProxy: IB library connected to local proxy");

      if (activeWs && activeWs.readyState !== WebSocket.CLOSED && activeWs.readyState !== WebSocket.CLOSING) {
        logger.warn("IB-WsProxy: terminating previous WebSocket before opening new one");
        try { activeWs.terminate(); } catch {}
      }
      if (activeTcpClient && !activeTcpClient.destroyed) {
        logger.warn("IB-WsProxy: destroying previous TCP client");
        try { activeTcpClient.destroy(); } catch {}
      }

      activeTcpClient = tcpClient;
      const pendingData: Buffer[] = [];
      let wsOpen = false;

      const ws = new WebSocket(wsUrl);
      activeWs = ws;

      ws.on("open", () => {
        logger.info({ wsUrl, buffered: pendingData.length }, "IB-WsProxy: WebSocket connected to bridge");
        wsOpen = true;
        for (const chunk of pendingData) {
          ws.send(chunk);
        }
        pendingData.length = 0;
      });

      ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
        const buf = Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.from(data);
        tcpClient.write(buf);
      });

      tcpClient.on("data", (chunk: Buffer) => {
        if (wsOpen && ws.readyState === WebSocket.OPEN) {
          ws.send(chunk);
        } else {
          pendingData.push(Buffer.from(chunk));
          logger.info({ bytes: chunk.length, queued: pendingData.length }, "IB-WsProxy: buffering data until WS open");
        }
      });

      ws.on("error", (err) => {
        logger.error({ err: err.message }, "IB-WsProxy: WebSocket error");
        tcpClient.destroy();
      });

      ws.on("close", () => {
        logger.info("IB-WsProxy: WebSocket closed");
        if (activeWs === ws) activeWs = null;
        tcpClient.destroy();
      });

      tcpClient.on("error", (err) => {
        logger.error({ err: err.message }, "IB-WsProxy: TCP client error");
        ws.terminate();
      });

      tcpClient.on("close", () => {
        logger.info("IB-WsProxy: TCP client closed");
        if (activeTcpClient === tcpClient) activeTcpClient = null;
        ws.terminate();
      });
    });

    proxyServer.listen(LOCAL_PORT, "127.0.0.1", () => {
      logger.info({ port: LOCAL_PORT, wsUrl }, "IB-WsProxy: local TCP proxy listening");
      resolve(LOCAL_PORT);
    });

    proxyServer.on("error", (err) => {
      logger.error({ err: err.message }, "IB-WsProxy: server error");
      reject(err);
    });
  });
}
