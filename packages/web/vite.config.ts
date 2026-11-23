import { fileURLToPath } from "node:url";
import type { IncomingMessage } from "node:http";
import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import { galleyMock } from "./mock/plugin.ts";

const src = fileURLToPath(new URL("./src", import.meta.url));
const brand = fileURLToPath(new URL("../../brand", import.meta.url));
const server = process.env.GALLEY_SERVER ?? "http://127.0.0.1:4400";
const mock = process.env.GALLEY_MOCK === "1";

const isEventStream = (req: IncomingMessage) => (req.headers.accept ?? "").includes("text/event-stream");

/**
 * The dev proxy in front of the real server. Server-Sent Events must not be
 * buffered or timed out, and the server checks `Origin` on state-changing
 * requests, so the browser's dev origin is presented as the server's own.
 */
const apiProxy: ProxyOptions = {
  target: server,
  // The server checks Origin against its own Host; both must name the server.
  changeOrigin: true,
  timeout: 0,
  proxyTimeout: 0,
  configure(proxy) {
    proxy.on("proxyReq", (proxyReq, req) => {
      if (req.headers.origin) proxyReq.setHeader("origin", new URL(server).origin);
      if (isEventStream(req)) proxyReq.setHeader("connection", "keep-alive");
    });
    proxy.on("proxyRes", (proxyRes, req) => {
      if (!isEventStream(req)) return;
      proxyRes.headers["cache-control"] = "no-cache, no-transform";
      proxyRes.headers["x-accel-buffering"] = "no";
      delete proxyRes.headers["content-length"];
    });
  },
};

export default defineConfig({
  plugins: [react(), mock ? galleyMock() : null],
  resolve: {
    alias: { "@": src, "@brand": brand },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: mock ? undefined : { "/api": apiProxy },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2023",
    rolldownOptions: {
      output: {
        // CodeMirror loads only with an editor on screen; its language packs ride separately so neither chunk is huge.
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            { name: "codemirror-languages", test: /[\\/]node_modules[\\/].*(@codemirror[\\/](lang-[^\\/]+|autocomplete)|@lezer[\\/](javascript|html|css|markdown|yaml|json))[\\/]/, priority: 2 },
            { name: "codemirror", test: /[\\/]node_modules[\\/].*(@codemirror|@lezer|[\\/]codemirror|style-mod|w3c-keyname|crelt|@marijn)[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
});
