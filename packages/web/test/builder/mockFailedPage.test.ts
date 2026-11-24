/**
 * The mock's preview answers a page it can't draw the way a dev server does
 * — an error page, with the overlay's word that it failed — so the app's
 * failed-page state can be reached without a real site.
 */
import { describe, expect, it } from "vitest";
import { createMockServer } from "../../mock/server.ts";
import { startPreviewServers } from "../../mock/preview.ts";

describe("the mock preview's failed page", () => {
  it("answers a section with a blank picture with an error page that says it failed, and draws again once it's gone", async () => {
    const server = createMockServer({ mode: "local" });
    const site = [...server.backend.sites.values()][0]!;
    const path = "src/content/pages/index.md";
    const original = site.read(path)!;
    const servers = await startPreviewServers(site);
    try {
      const fine = await fetch(`${servers.url}/`);
      expect(fine.status).toBe(200);
      expect(await fine.text()).toContain('type:"page-state",state:"drawn"');

      site.write(path, Buffer.from(original.toString("utf8").replace("sections:\n", "sections:\n  - type: split\n    heading: \"\"\n    image: \"\"\n")));
      const broken = await fetch(`${servers.url}/`);
      expect(broken.status).toBe(500);
      const html = await broken.text();
      expect(html).toContain('"type":"page-state","state":"failed","status":500');
      expect(html).toContain("sections.0, a split section");

      site.write(path, original);
      expect((await fetch(`${servers.url}/`)).status).toBe(200);
    } finally {
      servers.close();
    }
  });
});
