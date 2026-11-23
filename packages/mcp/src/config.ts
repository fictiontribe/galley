/**
 * Ready-to-paste harness configuration, per client. `galley mcp config`
 * prints these and docs/mcp.md is generated from the same functions, so the
 * two can't drift. Formats were checked against each client's own
 * documentation (cited in docs/mcp.md).
 */

export const MCP_CLIENTS = ["claude-desktop", "claude-code", "cursor", "vscode", "generic"] as const;
export type McpClient = (typeof MCP_CLIENTS)[number];

export interface ConfigRequest {
  client: McpClient;
  transport: "stdio" | "http";
  /** The key the harness lists the server under. */
  serverName: string;
  productName: string;
  /** The CLI's name as typed, for "run `<cli> mcp token`". */
  cliName: string;
  /** How to start the CLI: the command and the arguments before `mcp`. */
  launcher: { command: string; args: string[] };
  /** stdio: the site's folder. */
  sitePath: string;
  /** stdio: extra flags for `mcp`, e.g. ["--build"]. */
  flags: string[];
  /** http: the MCP endpoint. */
  url: string;
  /** http: the environment variable the token is read from where the client supports references. */
  tokenEnv: string;
}

export interface ClientConfig {
  client: McpClient;
  title: string;
  /** Where it goes, in one line. */
  where: string;
  kind: "json" | "command" | "steps";
  text: string;
  notes: string[];
}

export const CLIENT_TITLES: Record<McpClient, string> = {
  "claude-desktop": "Claude Desktop",
  "claude-code": "Claude Code",
  cursor: "Cursor",
  vscode: "VS Code",
  generic: "Any other MCP client",
};

/** POSIX shell quoting, only where needed. */
export function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`;
}

function stdioArgs(request: ConfigRequest): string[] {
  return [...request.launcher.args, "mcp", request.sitePath, ...request.flags];
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function isLoopbackUrl(url: string): boolean {
  try {
    return /^(127\.\d+\.\d+\.\d+|localhost|\[::1\])$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function clientConfig(request: ConfigRequest): ClientConfig {
  const { client, serverName: name, tokenEnv } = request;
  const title = CLIENT_TITLES[client];
  const stdio = { command: request.launcher.command, args: stdioArgs(request) };
  const tokenNote = `Make the token with \`${request.cliName} mcp token\` (it is shown once) and set ${tokenEnv} to it where the client runs, or paste it in place of the reference in a config file you don't commit.`;

  if (request.transport === "stdio") {
    switch (client) {
      case "claude-desktop":
        return {
          client,
          title,
          where: "Settings › Developer › Edit Config — claude_desktop_config.json (macOS: ~/Library/Application Support/Claude/, Windows: %APPDATA%\\Claude\\). Merge into “mcpServers”, then quit and reopen Claude Desktop.",
          kind: "json",
          text: json({ mcpServers: { [name]: stdio } }),
          notes: [],
        };
      case "claude-code":
        return {
          client,
          title,
          where: "Run in a terminal (add --scope user to use it in every project, --scope project to share it through .mcp.json).",
          kind: "command",
          text: `claude mcp add --transport stdio ${shellQuote(name)} -- ${[stdio.command, ...stdio.args].map(shellQuote).join(" ")}`,
          notes: [],
        };
      case "cursor":
        return {
          client,
          title,
          where: ".cursor/mcp.json in the project, or ~/.cursor/mcp.json for every project.",
          kind: "json",
          text: json({ mcpServers: { [name]: { type: "stdio", ...stdio } } }),
          notes: [],
        };
      case "vscode":
        return {
          client,
          title,
          where: ".mcp.json at the workspace root (or ~/.copilot/mcp-config.json for every workspace).",
          kind: "json",
          text: json({ mcpServers: { [name]: { type: "stdio", ...stdio } } }),
          notes: ["Older VS Code versions read .vscode/mcp.json instead, with “servers” in place of “mcpServers”."],
        };
      case "generic":
        return {
          client,
          title,
          where: "Start this command as a stdio server (most clients take a command and an argument list).",
          kind: "json",
          text: json({ transport: "stdio", ...stdio }),
          notes: [],
        };
    }
  }
  const header = `Bearer \${${tokenEnv}}`;

  switch (client) {
    case "claude-desktop":
      return {
        client,
        title,
        where: "Customize › Connectors › Add custom connector.",
        kind: "steps",
        text: [
          `Name: ${request.productName}`,
          `URL: ${request.url}`,
          `Request header: Authorization = Bearer <your token>`,
        ].join("\n"),
        notes: [
          `Claude Desktop reaches custom connectors from Anthropic's cloud, not from this computer, so this only works for a hosted ${request.productName} at a public https:// address on port 443.${isLoopbackUrl(request.url) ? " This address is on this computer only — use the stdio configuration instead." : ""}`,
          tokenNote,
        ],
      };
    case "claude-code":
      return {
        client,
        title,
        where: `Run in a terminal where ${tokenEnv} is set (the shell fills it in once, when the server is added).`,
        kind: "command",
        text: `claude mcp add --transport http ${shellQuote(name)} ${shellQuote(request.url)} --header "Authorization: Bearer $${tokenEnv}"`,
        notes: [tokenNote],
      };
    case "cursor":
      return {
        client,
        title,
        where: ".cursor/mcp.json in the project, or ~/.cursor/mcp.json for every project.",
        kind: "json",
        text: json({ mcpServers: { [name]: { url: request.url, headers: { Authorization: `Bearer \${env:${tokenEnv}}` } } } }),
        notes: [tokenNote],
      };
    case "vscode":
      return {
        client,
        title,
        where: ".mcp.json at the workspace root (or ~/.copilot/mcp-config.json for every workspace).",
        kind: "json",
        text: json({ mcpServers: { [name]: { type: "http", url: request.url, headers: { Authorization: header } } } }),
        notes: [tokenNote],
      };
    case "generic":
      return {
        client,
        title,
        where: "Any client that speaks Streamable HTTP.",
        kind: "json",
        text: json({ type: "http", url: request.url, headers: { Authorization: "Bearer <your token>" } }),
        notes: [tokenNote],
      };
  }
}
