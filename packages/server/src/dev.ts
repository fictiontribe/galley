/**
 * `pnpm dev`: start the server for development, open the site in
 * GALLEY_SITE (or the current directory) and print the signed-in URL.
 * The web UI's own dev server (`pnpm dev:web`) proxies /api here.
 */
import { resolve } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import { looksLikeSite } from "./fs-list";
import { startServer, StartupError } from "./server";

async function main(): Promise<void> {
  const sitePath = resolve(process.env.GALLEY_SITE ?? process.env.INIT_CWD ?? process.cwd());
  const server = await startServer({ home: process.env.GALLEY_HOME ?? resolve(".galley-home") });
  let path = "/";

  if (looksLikeSite(sitePath)) {
    try {
      const site = await server.services.registry.open({ path: sitePath });

      path = `/sites/${encodeURIComponent(site.id)}`;
      process.stdout.write(`Opened ${sitePath}\n`);
    } catch (error) {
      process.stdout.write(`Couldn't open ${sitePath}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  } else {
    process.stdout.write(`${sitePath} doesn't look like a site; set GALLEY_SITE to open one.\n`);
  }
  process.stdout.write(`${PRODUCT.name} (${server.mode}) on ${server.url}\n${server.openUrl(path)}\n`);

  let stopping = false;
  const stop = () => {
    if (stopping) process.exit(1);
    stopping = true;
    void server.close().then(() => process.exit(0));
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof StartupError ? error.message : error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
