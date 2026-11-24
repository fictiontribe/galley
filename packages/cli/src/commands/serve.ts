import { resolve } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import { mailConfigFromEnv } from "@galley/core/forms";
import { PASSWORD_LINK_MINUTES } from "@galley/core/install/accounts";
import type { InstallSite } from "@galley/core/install/types";
import { MIN_PASSWORD_LENGTH, stamped, StartupError } from "@galley/server";
import { parse, portOption, UsageError } from "../args";
import type { Io } from "../io";

export const SERVE_HELP = `Usage: ${PRODUCT.slug} serve [options]

Run ${PRODUCT.name} for other computers (hosted mode): one site, for the people an owner
invites, each with their own e-mail and password.
Everything it keeps — the site, settings, keys, accounts, sessions — is in its data
folder (GALLEY_HOME).

Options
      --host <address>      Interface to listen on (default GALLEY_HOST, then 0.0.0.0)
  -p, --port <port>         Port to listen on (default GALLEY_PORT, then 4400)
      --reset-password      Get an owner back in: print a one-time link for the owner to
                            choose a new password (it works once, for ${PASSWORD_LINK_MINUTES} minutes), then
                            serve as usual until stopped. Nobody else's account changes,
                            and the owner's old password works until the link is used.
                            With no owner yet: a new one-time setup link instead
      --email <address>     With --reset-password, when there are several owners: which one
  -h, --help                Show this help

First run
  With no owner yet, the server prints a one-time setup link. Whoever opens it first
  becomes the owner (their name, e-mail and password) and connects the site, so open it
  straight away. The owner invites everyone else from the app.

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
  GALLEY_SYNC_MINUTES       How often the editor looks for newer versions in the site's
                            repository and brings them in when nothing here is in the way
                            (default 5; 0: only when someone opens Version history)

E-mail (optional; without it, invitation and new-password links are shown to the owner
who makes them, to send however they like)
  GALLEY_SMTP_URL           smtp://user:pass@host:587 (or smtps://) for invitations,
                            new-password links and "Forgot your password?"
  GALLEY_MAIL_FROM          The sender address

Unattended start (starting values: each is used once, while the install doesn't have
that thing yet, so what someone later changes in the app sticks)
  GALLEY_PASSWORD           The first owner's password, ${MIN_PASSWORD_LENGTH} characters or more
  GALLEY_OWNER_NAME         The first owner's name and the e-mail they sign in with
  GALLEY_OWNER_EMAIL        (with GALLEY_PASSWORD; without them the app asks after sign-in)
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
    { host: { type: "string" }, port: { type: "string", short: "p" }, "sites-dir": { type: "string" }, "reset-password": { type: "boolean" }, email: { type: "string" } },
    0
  );

  if (values.help) {
    io.out(SERVE_HELP);
    return 0;
  }
  if (values.email !== undefined && !values["reset-password"]) throw new UsageError("--email is only used with --reset-password, to say which owner's password to reset.");
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
      ...(values.email !== undefined ? { resetPasswordEmail: values.email } : {}),
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
  const passwordSet = server.install ? server.install.store.hasOwner() : true;

  io.out(`${PRODUCT.name} is serving on ${describeHost(host)}, port ${server.port}.`);
  io.out(`Address:   ${publicUrl ?? `${server.url} (set GALLEY_PUBLIC_URL to the address people use)`}`);
  if (!passwordSet) {
    io.out(
      // A code the operator supplied is theirs already: printing it again would only put it in the server's log.
      server.setupUrl && new URL(server.setupUrl).searchParams.get("token") !== io.env.GALLEY_SETUP_TOKEN?.trim()
        ? `Setup:     ${server.setupUrl}\n           Open it now: it works once, and whoever opens it first creates the owner's account.`
        : server.setupUrl
          ? `Setup:     ${new URL("/setup", server.setupUrl).href}?token=<the setup code you supplied>\n           It works once, and whoever opens it first creates the owner's account.`
          : "Setup:     waiting for first run, with the setup code you supplied (only its hash is kept here)"
    );
  } else {
    // Whether GALLEY_PASSWORD still signs the first owner in, without saying anything about it: it only sets it while there is no owner, and the app can change it since.
    const fromEnv = Boolean(server.install && env.GALLEY_PASSWORD && (await server.install.people.ownerPasswordIs(env.GALLEY_PASSWORD).catch(() => false)));

    io.out(
      `Sign-in:   each person's own e-mail and password${fromEnv ? " (an owner's is still the one GALLEY_PASSWORD set)" : "; an owner invites people in the app"}; after 5 wrong attempts in a minute, that address waits a minute`
    );
  }
  if (server.passwordLink) {
    const until = new Date(server.passwordLink.expiresAt).toISOString().slice(11, 16);

    io.out(
      `Password:  ${server.passwordLink.url}\n           Open it now: it lets ${server.passwordLink.name || "the owner"} choose a new password, once, until ${until} UTC. Nobody else's account changed.`
    );
  }
  io.out(
    `E-mail:    ${
      !mailConfigFromEnv(env).config
        ? "not set up (GALLEY_SMTP_URL, GALLEY_MAIL_FROM): owners send invitation and new-password links themselves"
        : publicUrl
          ? "invitations and new-password links are e-mailed too"
          : "set up, but no link is e-mailed until the editor's public address is set (GALLEY_PUBLIC_URL): a link is only ever built from it"
    }`
  );
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
  const minutes = server.syncMinutes;

  if (typeof minutes === "number") {
    io.out(
      minutes > 0
        ? `Repository: checked every ${minutes === 1 ? "minute" : `${minutes} minutes`}; newer versions are brought in when nothing here is in the way`
        : "Repository: not checked by itself (GALLEY_SYNC_MINUTES=0)"
    );
  }
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
