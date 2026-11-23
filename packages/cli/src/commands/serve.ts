import { resolve } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import { MIN_PASSWORD_LENGTH, StartupError } from "@galley/server";
import { parse, portOption } from "../args";
import type { Io } from "../io";

export const SERVE_HELP = `Usage: ${PRODUCT.slug} serve [options]

Run ${PRODUCT.name} for other computers (hosted mode), behind a password.

Options
      --host <address>      Interface to listen on (default GALLEY_HOST, then 0.0.0.0)
  -p, --port <port>         Port to listen on (default GALLEY_PORT, then 4400)
      --sites-dir <folder>  The only folder sites can be opened from or created in
                            (default GALLEY_SITES_DIR, then <GALLEY_HOME>/sites)
  -h, --help                Show this help

Required
  GALLEY_PASSWORD           The sign-in password, ${MIN_PASSWORD_LENGTH} characters or more. Read from the
                            environment only, so it never shows up in a process list.
Recommended
  GALLEY_PUBLIC_URL         The address people use, e.g. https://cms.example.com
  GALLEY_TRUST_PROXY=1      When a reverse proxy terminates HTTPS in front of this server`;

function describeHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") return `${host} (every network interface)`;
  if (/^(127\.|localhost$|::1$)/.test(host)) return `${host} (this computer only; put a reverse proxy in front)`;
  return host;
}

export async function serveCommand(argv: string[], io: Io): Promise<number> {
  const { values } = parse("serve", argv, { host: { type: "string" }, port: { type: "string", short: "p" }, "sites-dir": { type: "string" } }, 0);

  if (values.help) {
    io.out(SERVE_HELP);
    return 0;
  }
  const host = values.host ?? io.env.GALLEY_HOST ?? "0.0.0.0";
  const sitesDir = values["sites-dir"] ? resolve(io.cwd, values["sites-dir"]) : undefined;
  let server;

  try {
    server = await io.startServer({ mode: "hosted", host, port: portOption(values.port), sitesDir, env: io.env, notice: (line) => io.err(`! ${line}`) });
  } catch (error) {
    if (error instanceof StartupError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
  const env = io.env;
  const publicUrl = env.GALLEY_PUBLIC_URL?.trim();
  const trustProxy = /^(1|true|yes|on)$/i.test(env.GALLEY_TRUST_PROXY ?? "");
  const home = env.GALLEY_HOME?.trim() || `~/${PRODUCT.homeDir}`;
  const sites = sitesDir ?? env.GALLEY_SITES_DIR?.trim() ?? `${home}/sites`;

  io.out(`${PRODUCT.name} is serving on ${describeHost(host)}, port ${server.port}.`);
  io.out(`Address:   ${publicUrl ?? `${server.url} (set GALLEY_PUBLIC_URL to the address people use)`}`);
  io.out(`Sign-in:   password from GALLEY_PASSWORD; after 5 wrong attempts in a minute, that address waits a minute`);
  io.out(
    `Sessions:  signed HttpOnly SameSite=Strict cookie, 30 days; Secure over HTTPS${trustProxy ? " (X-Forwarded-Proto is trusted)" : " (X-Forwarded-Proto is ignored; set GALLEY_TRUST_PROXY=1 behind a proxy)"}`
  );
  io.out(
    publicUrl
      ? `Requests:  only for ${new URL(publicUrl).hostname} and loopback names; changes must come from that address`
      : "Requests:  for any hostname (GALLEY_PUBLIC_URL limits them to one); changes must come from the address they were loaded from"
  );
  if (env.GALLEY_TOKEN) io.out("Scripts:   Authorization: Bearer <GALLEY_TOKEN> is accepted");
  if (!/^(0|false|no|off)$/i.test(env.GALLEY_MCP?.trim() ?? "")) {
    io.out(`AI tools:  MCP at ${publicUrl ? `${publicUrl.replace(/\/+$/, "")}/mcp` : "/mcp"} with a token from \`${PRODUCT.slug} mcp token\` (GALLEY_MCP=off removes it)`);
  }
  io.out(`Sites:     ${sites} (nothing outside it can be opened, cloned into, or created)`);
  const range = env.GALLEY_PREVIEW_PORTS?.trim();

  io.out(
    `Previews:  each site's preview listens on ${host} at ${range ? `a port in ${range} (GALLEY_PREVIEW_PORTS)` : "a free port (GALLEY_PREVIEW_PORTS=4410-4429 fixes the range)"}${publicUrl ? `, reached at ${new URL(publicUrl).hostname}` : ""}`
  );
  io.out(`Data:      ${home} (settings, stored keys, the cookie-signing key)`);
  io.out("Press Ctrl+C to stop.");
  await io.waitForStop();
  io.out("Stopping…");
  await server.close();
  return 0;
}
