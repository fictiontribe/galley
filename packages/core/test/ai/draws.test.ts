import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { checkPageDraws, drawWarning, errorLine } from "../../src/ai/tools/draws";
import type { PreviewStatus, SiteService } from "../../src/types";

let server: http.Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

function siteWith(status: PreviewStatus): SiteService {
  return { preview: () => ({ status: () => status, start: async () => status, stop: async () => undefined, restart: async () => status }) } as unknown as SiteService;
}

describe("whether a page still draws after the assistant's change", () => {
  it("finds the dev server's own line about the error", () => {
    expect(errorLine(["  ready in 300 ms", "\u001b[31m12:01:02 [ERROR] ENOENT: no such file or directory, open '/s/public/video/-poster.webp'\u001b[0m", "  at x"], 0)).toBe(
      "[ERROR] ENOENT: no such file or directory, open '/s/public/video/-poster.webp'",
    );
    expect(errorLine(["fine", "also fine"], 0)).toBeNull();
  });

  it("says nothing when the preview isn't running, and warns when the page answers with an error", async () => {
    const log = ["  ready"];
    server = http.createServer((req, res) => {
      if (req.url === "/broken/") {
        log.push("[ERROR] Cannot read properties of undefined (reading 'width')");
        res.writeHead(500, { "content-type": "text/html" });
        res.end("<title>Error</title>");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<h1>ok</h1>");
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ready = siteWith({ state: "ready", url, baselineUrl: null, baselineSource: null, log });
    const now = async () => undefined;

    expect(await checkPageDraws(siteWith({ state: "starting", url: null, baselineUrl: null, baselineSource: null, log: [] }), "/broken/", now)).toBeNull();
    expect(await checkPageDraws(ready, null, now)).toBeNull();
    expect(await checkPageDraws(ready, "/fine/", now)).toEqual({ draws: true, status: 200, message: null });
    const broken = await checkPageDraws(ready, "/broken/", now);
    expect(broken).toEqual({ draws: false, status: 500, message: "[ERROR] Cannot read properties of undefined (reading 'width')" });
    expect(drawWarning("/broken/", broken)).toMatch(/^The page \/broken\/ can't be drawn after this change: the preview answered 500 \(\[ERROR\] Cannot read/);
    expect(drawWarning("/fine/", { draws: true, status: 200, message: null })).toBeNull();
  });
});
