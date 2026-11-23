/** docs/mcp.md can't drift from the code, and the client snippets have the shapes their documentation asks for. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clientConfig, MCP_CLIENTS, type ConfigRequest } from "../src/index";
import { DOCS_FILE, renderDocs } from "../src/docs";
import { REPO } from "./helpers";

const base: Omit<ConfigRequest, "client" | "transport"> = {
  serverName: "galley",
  productName: "Galley",
  cliName: "galley",
  launcher: { command: "/usr/bin/node", args: ["/opt/galley/packages/cli/bin/galley.js"] },
  sitePath: "/home/ana/my site",
  flags: ["--build"],
  url: "https://cms.example.com/mcp",
  tokenEnv: "GALLEY_MCP_TOKEN",
};

describe("docs/mcp.md", () => {
  it("is up to date with the tool catalog and the client configs (run `pnpm --filter @galley/mcp docs`)", () => {
    const document = readFileSync(join(REPO, DOCS_FILE), "utf8");

    expect(renderDocs(document)).toBe(document);
  });
});

describe("client configurations", () => {
  it("Claude Desktop: mcpServers with command and args", () => {
    const parsed = JSON.parse(clientConfig({ ...base, client: "claude-desktop", transport: "stdio" }).text);

    expect(parsed).toEqual({ mcpServers: { galley: { command: "/usr/bin/node", args: ["/opt/galley/packages/cli/bin/galley.js", "mcp", "/home/ana/my site", "--build"] } } });
  });

  it("Claude Code: claude mcp add with the -- separator, shell-quoted", () => {
    expect(clientConfig({ ...base, client: "claude-code", transport: "stdio" }).text).toBe(
      "claude mcp add --transport stdio galley -- /usr/bin/node /opt/galley/packages/cli/bin/galley.js mcp '/home/ana/my site' --build"
    );
    expect(clientConfig({ ...base, client: "claude-code", transport: "http" }).text).toBe(
      'claude mcp add --transport http galley https://cms.example.com/mcp --header "Authorization: Bearer $GALLEY_MCP_TOKEN"'
    );
  });

  it("Cursor: type stdio, and url + headers with ${env:…} for HTTP", () => {
    expect(JSON.parse(clientConfig({ ...base, client: "cursor", transport: "stdio" }).text).mcpServers.galley).toMatchObject({ type: "stdio", command: "/usr/bin/node" });
    expect(JSON.parse(clientConfig({ ...base, client: "cursor", transport: "http" }).text).mcpServers.galley).toEqual({
      url: "https://cms.example.com/mcp",
      headers: { Authorization: "Bearer ${env:GALLEY_MCP_TOKEN}" },
    });
  });

  it("VS Code: portable .mcp.json with type http and a ${…} reference", () => {
    expect(JSON.parse(clientConfig({ ...base, client: "vscode", transport: "http" }).text).mcpServers.galley).toEqual({
      type: "http",
      url: "https://cms.example.com/mcp",
      headers: { Authorization: "Bearer ${GALLEY_MCP_TOKEN}" },
    });
  });

  it("Claude Desktop over HTTP is a custom connector, and says when the address is local", () => {
    const hosted = clientConfig({ ...base, client: "claude-desktop", transport: "http" });

    expect(hosted.kind).toBe("steps");
    expect(hosted.text).toContain("URL: https://cms.example.com/mcp");
    expect(hosted.notes.join(" ")).not.toContain("use the stdio configuration");
    expect(clientConfig({ ...base, client: "claude-desktop", transport: "http", url: "http://127.0.0.1:4400/mcp" }).notes.join(" ")).toContain("use the stdio configuration");
  });

  it("every client has both forms and never embeds a token", () => {
    for (const client of MCP_CLIENTS) {
      for (const transport of ["stdio", "http"] as const) {
        const config = clientConfig({ ...base, client, transport });

        expect(config.text.length, `${client} ${transport}`).toBeGreaterThan(10);
        expect(config.text).not.toMatch(/galley_mcp_[A-Za-z0-9_-]{20,}/);
      }
    }
  });
});
