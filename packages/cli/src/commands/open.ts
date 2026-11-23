import { statSync } from "node:fs";
import { resolve } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import { looksLikeSite, StartupError } from "@galley/server";
import { parse, portOption } from "../args";
import type { Io } from "../io";

export const OPEN_HELP = `Usage: ${PRODUCT.slug} [path] [options]

Open the site in [path] (default: this folder) and the browser, signed in.
Everything stays on this computer: the server listens on 127.0.0.1 only.

Options
  -p, --port <port>   Port to listen on (default 4400, or the next free one)
      --no-open       Don't open the browser; print the link instead
  -h, --help          Show this help`;

export const NOT_A_SITE_MARKERS = "package.json, .git, galley.config.json, hugo.toml or config.toml, _config.yml, or a content/ or src/content/ folder";

export interface OpenHooks {
  /** Runs once the site is open, before "Press Ctrl+C to stop." — `galley new` prints its next steps here. */
  afterStart?(info: { url: string; link: string; opened: boolean }): void;
}

export async function openCommand(argv: string[], io: Io, hooks: OpenHooks = {}): Promise<number> {
  const { values, positionals } = parse("", argv, { port: { type: "string", short: "p" }, "no-open": { type: "boolean" } });

  if (values.help) {
    io.out(OPEN_HELP);
    return 0;
  }
  const port = portOption(values.port);
  const root = resolve(io.cwd, positionals[0] ?? ".");
  const info = statSync(root, { throwIfNoEntry: false });

  if (!info) {
    io.err(`There's no folder at ${root}.`);
    return 1;
  }
  if (!info.isDirectory()) {
    io.err(`${root} is a file, not a folder. Point ${PRODUCT.slug} at the folder your site lives in.`);
    return 1;
  }
  if (!looksLikeSite(root)) {
    io.err(`${root} doesn't look like a site.`);
    io.err(`Looked for ${NOT_A_SITE_MARKERS}.`);
    io.err(`To start a new site, run: ${PRODUCT.slug} new my-site`);
    return 1;
  }

  let server;

  try {
    server = await io.startServer({ host: "127.0.0.1", mode: "local", port, env: io.env, notice: (line) => io.err(line) });
  } catch (error) {
    if (error instanceof StartupError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
  try {
    const site = await server.services.registry.open({ path: root });
    const model = await site.model();
    const link = server.openUrl(`/sites/${encodeURIComponent(site.id)}`);

    io.out(`${PRODUCT.name} is running at ${server.url}`);
    io.out(`Site: ${model.name} (${root})`);
    io.out(`Open: ${link}`);
    const opened = !values["no-open"] && (await io.openBrowser(link));

    if (!values["no-open"] && !opened) io.out("Couldn't open a browser. Open the link above instead.");
    hooks.afterStart?.({ url: server.url, link, opened });
    io.out("Press Ctrl+C to stop.");
  } catch (error) {
    await server.close();
    throw error;
  }
  await io.waitForStop();
  io.out("Stopping…");
  await server.close();
  return 0;
}

