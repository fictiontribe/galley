// A stand-in Cloudflare for the "Online" captures: the engine's own test fake
// (packages/core/test/deploy/fakes/cloudflare.ts) with a made-up account, a
// made-up workers.dev subdomain and a made-up zone, so every address in the
// pictures is invented. Nothing here talks to Cloudflare.
//
//   node --import tsx apps/site/scripts/capture/serve-host.mts [port]     (from the repository root)
//
// Galley is pointed at it with GALLEY_DEPLOY_CLOUDFLARE_API=http://127.0.0.1:<port>/client/v4
// and GALLEY_DEPLOY_PROBE=http://127.0.0.1:<port>/__probe?host={host} (start.sh does this).
// It prints the key it accepts: a fixed test value, not a credential.
// FAKES may point at a copy of the fakes folder (so edits to the repository can't change a run).
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";

const fakes = resolve(process.env.FAKES ?? join(import.meta.dirname, "../../../../packages/core/test/deploy/fakes"));
const { startFakeCloudflare } = await import(pathToFileURL(join(fakes, "cloudflare.ts")).href);

const port = Number(process.argv[2] ?? "4791");
const cf = await startFakeCloudflare({
  port,
  // The certificate takes two looks to arrive, so attaching a domain shows the wait.
  certificatePolls: 2,
  subdomain: "example-studio",
  accounts: [{ id: "0000000000000000000000000000000a", name: "Caddow studio" }],
  zones: { "caddow.example": "zone00000000000000000000000000cd" },
});
process.stdout.write(`Stand-in Cloudflare at ${cf.api}\nIts key (paste it as the access key): ${cf.token}\n`);
const stop = () => void cf.close().then(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
