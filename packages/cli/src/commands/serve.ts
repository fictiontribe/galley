import { resolve } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import type { InstallSite } from "@galley/core/install/types";
import { MIN_PASSWORD_LENGTH, stamped, StartupError } from "@galley/server";
import { parse, portOption } from "../args";
import type { Io } from "../io";

export const SERVE_HELP = `Usage: ${PRODUCT.slug} serve [options]

Run ${PRODUCT.name} for other computers (hosted mode): one site, behind a password.
Everything it keeps — the site, settings, keys, sessions — is in its data folder (GALLEY_HOME).

Options
      --host <address>      Interface to listen on (default GALLEY_HOST, then 0.0.0.0)
  -p, --port <port>         Port to listen on (default GALLEY_PORT, then 4400)
      --reset-password      Forget the password, sign everyone out and print a new
                            one-time setup link, then serve as usual until stopped.
                            Whoever opens the link first chooses the new password.
                            Stopped before that, the next start prints a fresh link
  -h, --help                Show this help

First run
  With no password yet, the server prints a one-time setup link. Whoever opens it first
  chooses the password and connects the site, so open it straight away.

Recommended
  GALLEY_PUBLIC_URL         The address people use, e.g. https://cms.example.com
  GALLEY_TRUST_PROXY=1      When a reverse proxy terminates HTTPS in front of this server

Previews (served through this server's one port, by hostname; point both names at it)
  GALLEY_PREVIEW_URL        Where the site's preview is shown. Default: worked out from
                            GALLEY_PUBLIC_URL (cms.example.com → cms-preview.example.com)
  GALLEY_LIVE_VIEW_URL      Where the live site is shown beside it (→ cms-live.example.com)
  GALLEY_PREVIEW_MEMORY_MB  A memory ceiling for the site's own preview, build and install
                            commands (default: none)

Operations
  GET /healthz, /readyz     Health and readiness, for a load balancer or a container's check
  GALLEY_LOG_REQUESTS=0     Leave out the one line per request (on by default)
  GALLEY_SHUTDOWN_GRACE_MS  How long stopping waits for a publish or a connect in progress
                            (default 20000)
  GALLEY_RESTORE_MAX_MB     The largest backup a restore in the app takes (default 2048);
                            larger ones: \`${PRODUCT.slug} backup restore\` with the server stopped

Unattended start (starting values: each is used once, while the install doesn't have
that thing yet, so what someone later changes in the app sticks)
  GALLEY_PASSWORD           The sign-in password, ${MIN_PASSWORD_LENGTH} characters or more
  GALLEY_SETUP_TOKEN        The one-time setup code to use (24 characters or more), or
  GALLEY_SETUP_TOKEN_SHA256 only its SHA-256, so the code never reaches the server
  GALLEY_SITE_REPOSITORY    The site's repository: git@host:owner/name.git or https://…
  GALLEY_SITE_ACCESS        deploy-key (the install's own key; default) or token
  GALLEY_SITE_TOKEN         The access token, with GALLEY_SITE_ACCESS=token
  GALLEY_SITE_BRANCH        Default: the repository's own default branch
  GALLEY_SITE_FOLDER        The folder inside the repository that holds the site (e.g. apps/site)
  GALLEY_SITE_STARTER       Send this starter to an empty repository instead
  GALLEY_AUTHOR_NAME        The name and e-mail every publish is recorded with
  GALLEY_AUTHOR_EMAIL
  GALLEY_SITE_LIVE_URL      The site's live address
  GALLEY_INSTALL_CONFIG     One JSON file with any of the above (the environment wins)
Secrets are read from the environment or that file only, so they never show up in a process list.`;

function describeHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") return `${host} (every network interface)`;
  if (/^(127\.|localhost$|::1$)/.test(host)) return `${host} (this computer only; put a reverse proxy in front)`;
  return host;
}

function describeSite(site: InstallSite | null): string {
  if (!site || site.state === "none" || !site.repository) return "not connected yet (first run connects it)";
  const where = `${site.repository}${site.folder ? `, folder ${site.folder}` : ""}`;

  switch (site.state) {
    case "connected":
      return where;
    case "connecting":
      return `${where} (being copied into the data folder now)`;
    case "waiting":
      return `${where} (waiting: first run shows this editor's key to add on the code host)`;
    case "failed":
      return `${where} (couldn't be connected${site.problem ? `: ${site.problem}` : ""})`;
  }
}

export async function serveCommand(argv: string[], io: Io): Promise<number> {
  const { values } = parse(
    "serve",
    argv,
    { host: { type: "string" }, port: { type: "string", short: "p" }, "sites-dir": { type: "string" }, "reset-password": { type: "boolean" } },
    0
  );

  if (values.help) {
    io.out(SERVE_HELP);
    return 0;
  }
  const host = values.host ?? io.env.GALLEY_HOST ?? "0.0.0.0";
  // Still accepted so old scripts start; the server says it is ignored now.
  const sitesDir = values["sites-dir"] ? resolve(io.cwd, values["sites-dir"]) : undefined;
  let server;

  try {
    server = await io.startServer({
      mode: "hosted",
      host,
      port: portOption(values.port),
      sitesDir,
      env: io.env,
      // Every line the server writes is already scrubbed of secrets; here it gets its time.
      notice: (line) => io.err(stamped(`! ${line}`)),
      log: (line) => io.err(stamped(line)),
      ...(values["reset-password"] ? { resetPassword: true } : {}),
    });
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
  const home = server.home ?? (env.GALLEY_HOME?.trim() || `~/${PRODUCT.homeDir}`);
  const site = (await server.install?.site().catch(() => null)) ?? null;
  const passwordSet = server.install ? server.install.store.hasPassword() : true;

  io.out(`${PRODUCT.name} is serving on ${describeHost(host)}, port ${server.port}.`);
  io.out(`Address:   ${publicUrl ?? `${server.url} (set GALLEY_PUBLIC_URL to the address people use)`}`);
  if (!passwordSet) {
    io.out(
      // A code the operator supplied is theirs already: printing it again would only put it in the server's log.
      server.setupUrl && new URL(server.setupUrl).searchParams.get("token") !== io.env.GALLEY_SETUP_TOKEN?.trim()
        ? `Setup:     ${server.setupUrl}\n           Open it now: it works once, and whoever opens it first chooses the password.`
        : server.setupUrl
          ? `Setup:     ${new URL("/setup", server.setupUrl).href}?token=<the setup code you supplied>\n           It works once, and whoever opens it first chooses the password.`
          : "Setup:     waiting for first run, with the setup code you supplied (only its hash is kept here)"
    );
  } else {
    // Which password is in use, without saying anything about it: GALLEY_PASSWORD only sets it while there is none, and the app can change it since.
    const fromEnv = Boolean(server.install && env.GALLEY_PASSWORD && (await server.install.store.checkPassword(env.GALLEY_PASSWORD).catch(() => false)));

    io.out(`Sign-in:   ${fromEnv ? "the password GALLEY_PASSWORD set" : "this editor's password (it is changed on the Install page)"}; after 5 wrong attempts in a minute, that address waits a minute`);
  }
  io.out(
    `Sessions:  signed HttpOnly SameSite=Strict cookie, 30 days; ${publicUrl?.startsWith("https://") ? "Secure, and a __Host- cookie on this https:// address" : `Secure over HTTPS${trustProxy ? " (X-Forwarded-Proto is trusted)" : " (X-Forwarded-Proto is ignored; set GALLEY_TRUST_PROXY=1 behind a proxy)"}`}`
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
  io.out(`Site:      ${describeSite(site)}`);
  io.out(
    server.previews
      ? `Previews:  ${server.previews.preview} (the live site beside it at ${server.previews.live}), through this port; only a signed-in browser is let in`
      : "Previews:  not shown: no address is set for them (GALLEY_PUBLIC_URL with a hostname, or GALLEY_PREVIEW_URL and GALLEY_LIVE_VIEW_URL)"
  );
  io.out(`Data:      ${home} (the site, its settings and stored keys, sessions — everything this install keeps)`);
  io.out("Press Ctrl+C to stop.");
  await io.waitForStop();
  // Requests stop, event streams end, a publish or a connect in progress gets its grace, the preview stops, the state is written.
  io.out("Stopping… (again to stop at once)");
  await server.close();
  io.out("Stopped.");
  // Everything is closed and written: end here, so nothing left behind (a measurement, a stray handle) turns a clean stop into a kill.
  await io.exit?.(0);
  return 0;
}
