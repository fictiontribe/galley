// @vitest-environment happy-dom
/**
 * Site settings are saved over the version they were opened with: the save
 * names it, a save made over a version someone else has replaced since is
 * refused in plain words with what was typed left in the form, and the next
 * save names the version the first one made.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { GalleyConfig } from "@galley/core/types";
import { byText, field, renderApp, startServer, submit, type, until, type MockServer, type Rendered } from "./harness";

let page: Rendered | null = null;
afterEach(async () => {
  await page?.unmount();
  page = null;
});

interface Saved {
  config: GalleyConfig;
  baseHash?: string | null;
}

async function open(): Promise<{ server: MockServer; siteId: string; saves: Saved[]; version: () => Promise<string | null> }> {
  const saves: Saved[] = [];
  let read: ((request: unknown) => unknown) | undefined;
  const server = await startServer({
    mode: "local",
    setup: "done",
    handlers: (handlers) => {
      read = handlers["GET /api/sites/:siteId/config"];
      return {
        ...handlers,
        "PUT /api/sites/:siteId/config": async (request: unknown) => {
          saves.push((request as { body: Saved }).body);
          return handlers["PUT /api/sites/:siteId/config"]!(request);
        },
      };
    },
  });
  const siteId = [...server.backend.sites.keys()][0]!;

  page = await renderApp(server, `/sites/${siteId}/settings`);
  return { server, siteId, saves, version: async () => ((await read!({ params: { siteId } })) as { hash: string | null }).hash };
}

const liveSite = () => field(document, "Live site");
const form = () => document.querySelector("form#site-settings-form");

describe("saving site settings", () => {
  it("names the version they were opened with, and then the version that save made", async () => {
    const { saves, version } = await open();

    await until(() => expect(liveSite()).not.toBeNull());
    const opened = await version();

    expect(opened).toEqual(expect.any(String));
    await type(liveSite(), "https://www.example.com");
    await submit(form());
    await until(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ baseHash: opened, config: { urls: { production: "https://www.example.com" } } });
    await until(() => expect(byText(document, "*", "Settings saved")).not.toBeNull());
    const afterFirst = await version();

    expect(afterFirst).not.toBe(opened);
    // A second save straight after doesn't name the version the first one replaced.
    await type(liveSite(), "https://example.com");
    await submit(form());
    await until(() => expect(saves).toHaveLength(2));
    expect(saves[1]!.baseHash).toBe(afterFirst);
  });

  it("is refused when someone else saved them in between, says so, and keeps what was typed", async () => {
    const { server, siteId, saves, version } = await open();

    await until(() => expect(liveSite()).not.toBeNull());
    const opened = await version();
    // Someone else (another window, the assistant) saves the settings.
    const site = (server.backend as unknown as { site(id: string): { config: GalleyConfig; read(path: string): Buffer | null; write(path: string, bytes: Buffer): void } }).site(siteId);

    site.write("galley.config.json", Buffer.from(`${JSON.stringify({ ...site.config, name: "Renamed elsewhere" }, null, 2)}\n`));
    expect(await version()).not.toBe(opened);
    const theirs = site.read("galley.config.json")!.toString("utf8");

    await type(liveSite(), "https://www.example.com");
    await submit(form());
    await until(() => expect(saves).toHaveLength(1));
    expect(saves[0]!.baseHash).toBe(opened);
    await until(() => expect(document.body.textContent).toContain("Couldn’t save the settings"));
    expect(document.body.textContent).toContain("The site’s settings changed since they were opened, so nothing was saved. Open them again, then make the change again.");
    // Nothing was saved, and the form still holds what was typed.
    expect(site.read("galley.config.json")!.toString("utf8")).toBe(theirs);
    expect(liveSite()!.value).toBe("https://www.example.com");
  });
});
