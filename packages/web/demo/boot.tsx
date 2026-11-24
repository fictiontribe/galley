/**
 * Starts the demo once the globals are in: the mock server, the shims that
 * answer the app from it, the bridge the preview frames read the working
 * copy through, then the app (hash routing: a static host has no fallback
 * for /demo/sites/…) and the demo's own layer beside it.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "@/app/App";
import { mimeOf } from "../mock/site.ts";
import { StaticFile } from "./shim/buffer";
import { installAssetUrls, type AssetAnswer } from "./shim/assets";
import { demoEventSource, demoFetch } from "./shim/transport";
import { createDemoServer } from "./server";
import { installBridge } from "./bridge";
import { DemoLayer } from "./layer/DemoLayer";
import { restoreSession, startSaving } from "./persist";
import { applySampleData } from "./sample";

const blobs = new WeakMap<Uint8Array, string>();

function blobUrl(bytes: Uint8Array, type: string): string {
  const known = blobs.get(bytes);
  if (known) return known;
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
  blobs.set(bytes, url);
  return url;
}

export async function boot(root: HTMLElement): Promise<void> {
  const { server, siteId, sampleVersions } = createDemoServer();
  await applySampleData(server, siteId);
  restoreSession(server);
  startSaving(server);
  const origin = window.location.origin;
  window.fetch = demoFetch(server, window.fetch.bind(window), origin);
  window.EventSource = demoEventSource(server, window.EventSource, origin);

  const fetchBlob = async (url: URL): Promise<string> => {
    const answer = await server.handle({ method: "GET", url: `${url.pathname}${url.search}`, headers: {} });
    if (answer.status !== 200 || answer.body === null) throw new Error(`${url.pathname} answered ${answer.status}`);
    const bytes = typeof answer.body === "string" ? new TextEncoder().encode(answer.body) : answer.body;
    return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: answer.headers["content-type"] ?? "application/octet-stream" }));
  };

  installAssetUrls(window, {
    resolve(url): AssetAnswer {
      const raw = /^\/api\/sites\/([^/]+)\/raw$/.exec(url.pathname);
      if (raw) {
        const site = server.backend.sites.get(decodeURIComponent(raw[1] ?? ""));
        const path = url.searchParams.get("path") ?? "";
        const bytes = site?.read(path, url.searchParams.get("rev") === "base" ? "base" : undefined);
        if (!bytes) return { kind: "missing" };
        if (bytes instanceof StaticFile) return { kind: "url", url: bytes.url };
        return { kind: "url", url: blobUrl(bytes, mimeOf(path)) };
      }
      return { kind: "later", url: fetchBlob(url) };
    },
    open(url, download) {
      void fetchBlob(url).then((address) => {
        const anchor = document.createElement("a");
        anchor.href = address;
        if (download) anchor.download = download;
        else anchor.target = "_blank";
        anchor.rel = "noopener";
        anchor.click();
      });
    },
    route(path) {
      window.location.hash = `#${path}`;
    },
  });

  installBridge(window, server);

  // Straight onto the sample site's home, unless the address already says where to go.
  if (!window.location.hash || window.location.hash === "#" || window.location.hash === "#/") window.location.replace(`#/sites/${siteId}`);

  createRoot(root).render(
    <StrictMode>
      <App router={HashRouter} />
    </StrictMode>,
  );
  const layer = document.createElement("div");
  layer.id = "demo-layer";
  document.body.append(layer);
  createRoot(layer).render(
    <StrictMode>
      <DemoLayer server={server} siteId={siteId} sampleVersions={sampleVersions} />
    </StrictMode>,
  );
}
