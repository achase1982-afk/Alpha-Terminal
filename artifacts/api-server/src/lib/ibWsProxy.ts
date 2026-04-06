import { createServer, type Server, type Socket } from "net";
import WebSocket from "ws";
import { logger } from "./logger.js";

const LOCAL_PORT = 4002;
let proxyServer: Server | null = null;

export function startIBWsProxy(wsUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    if (proxyServer) {
      resolve(LOCAL_PORT);
      return;
    }

    proxyServer = createServer((tcpClient: Socket) => {
      logger.info("IB-WsProxy: IB library connected to local proxy");

      const ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        logger.info({ wsUrl }, "IB-WsProxy: WebSocket connected to bridge");
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
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(chunk);
        }
      });

      ws.on("error", (err) => {
        logger.error({ err: err.message }, "IB-WsProxy: WebSocket error");
        tcpClient.destroy();
      });

      ws.on("close", () => {
        logger.info("IB-WsProxy: WebSocket closed");
        tcpClient.destroy();
      });

      tcpClient.on("error", (err) => {
        logger.error({ err: err.message }, "IB-WsProxy: TCP client error");
        ws.close();
      });

      tcpClient.on("close", () => {
        logger.info("IB-WsProxy: TCP client closed");
        ws.close();
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
