import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import type { ServerResponse } from "http";
import type { Socket } from "net";

type NodeResponseWithFlush = ServerResponse & {
  flushHeaders?: () => void;
  flush?: () => void;
  socket?: Socket & { uncork?: () => void };
};

function asNodeResponseWithFlush(res: ServerResponse): NodeResponseWithFlush {
  return res as NodeResponseWithFlush;
}


const rawPort = process.env.PORT ?? "3000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  define: {
    "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(
      process.env.CLERK_PUBLISHABLE_KEY ?? "",
    ),
    "import.meta.env.VITE_ADMIN_API_KEY": JSON.stringify(
      process.env.VITE_ADMIN_API_KEY ?? "",
    ),
    // react-draggable (via react-grid-layout) gates its debug logger on
    // process.env.DRAGGABLE_DEBUG; without this define the bare `process`
    // reference throws in the browser and aborts every grid resize/drag start.
    "process.env.DRAGGABLE_DEBUG": "false",
  },
  plugins: [
    react(),
    tailwindcss(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        secure: false,
        ws: true,
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes, _req, res) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              const nodeRes = asNodeResponseWithFlush(res);
              nodeRes.flushHeaders?.();
              proxyRes.on("data", () => {
                if (typeof nodeRes.flush === "function") nodeRes.flush();
                nodeRes.socket?.uncork?.();
              });
            }
          });
        },
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
