/**
 * A started hosted install, where guarded work needs someone (core
 * install/caller.ts): the operator's token publishes over the API and over
 * /mcp, a person publishes as their role allows, and the same site, reached
 * by work done for nobody after those requests ended, publishes nothing.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { NO_CALLER_REFUSAL } from "@galley/core/install";
import type { PublishResult } from "@galley/core/types";
import { call, EDITOR, git, sandbox, siteRepository, startHosted } from "./hosted-helpers";

const box = sandbox("caller-hosted");
const PASSWORD = "correct horse battery staple";
const OPERATOR = "an-operator-token-for-scripts-0000";

afterAll(() => box.cleanup(), 120_000);

describe("guarded work on a started hosted install", () => {
  it("the operator's token publishes over the API and over /mcp; work done for nobody can't", async () => {
    const bare = siteRepository(box);
    const { server, port } = await startHosted(box, box.folder("home"), {
      GALLEY_PUBLIC_URL: EDITOR,
      GALLEY_PASSWORD: PASSWORD,
      GALLEY_OWNER_NAME: "Sam Owner",
      GALLEY_OWNER_EMAIL: "sam@example.com",
      GALLEY_TOKEN: OPERATOR,
      GALLEY_SITE_REPOSITORY: bare,
      GALLEY_SITE_ACCESS: "token",
      GALLEY_SITE_TOKEN: "fake-access-key-for-the-repository-0000",
      GALLEY_AUTHOR_NAME: "Site Publisher",
      GALLEY_AUTHOR_EMAIL: "publisher@example.com",
      GALLEY_MCP: "on",
      GALLEY_MCP_PUBLISH: "on",
    });

    await server.install!.idle();
    const siteId = server.install!.siteId()!;
    const folder = server.install!.siteFolder();
    const page = (name: string) => writeFileSync(join(folder, "src/content/pages", `${name}.md`), `---\ntitle: ${name}\n---\n${name}\n`);

    page("by-the-api");
    const api = await call<PublishResult>(port, "POST", `/api/sites/${siteId}/publish`, { bearer: OPERATOR, body: { message: "Over the API", paths: ["src/content/pages/by-the-api.md"] } });

    expect(api.status, api.text).toBe(200);
    expect(api.body.ok, api.text).toBe(true);
    page("over-mcp");
    const client = new Client({ name: "operator-script", version: "1.0.0" });

    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { authorization: `Bearer ${OPERATOR}`, host: "cms.localhost" } } }));
      const published = (await client.callTool({ name: "publish", arguments: { message: "Over MCP", paths: ["src/content/pages/over-mcp.md"] } })) as CallToolResult;

      expect(published.isError, JSON.stringify(published)).toBeFalsy();
    } finally {
      await client.close();
    }
    expect(git(folder, "log", "--format=%s", "-n", "2").split("\n")).toEqual(["Over MCP", "Over the API"]);
    // The same open site, used by work no request is behind any more: refused, and nothing is published.
    page("by-nobody");
    const site = (await server.services.registry.get(siteId))!;
    const outcome = await new Promise<string>((resolve) => {
      setImmediate(() =>
        site.publish({ message: "By nobody" }).then(
          () => resolve("published"),
          (error: unknown) => resolve(error instanceof Error ? error.message : String(error))
        )
      );
    });

    expect(outcome).toBe(NO_CALLER_REFUSAL);
    expect(git(folder, "log", "--format=%s", "-n", "1")).toBe("Over MCP");
  }, 180_000);
});
