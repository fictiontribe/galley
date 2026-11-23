/**
 * The fake hosts as standalone servers, for the end-to-end rehearsal of the
 * real app (see docs/deploy.md, "Rehearsing without a real host"):
 *
 *   npx tsx packages/core/test/deploy/fakes/serve.ts <evidence.json> [cloudflarePort] [vercelPort]
 *
 * Point the app at them with GALLEY_DEPLOY_CLOUDFLARE_API=http://127.0.0.1:<port>/client/v4
 * and GALLEY_DEPLOY_VERCEL_API=http://127.0.0.1:<port>. Every deployment the
 * fakes accept is written to the evidence file: kind, every path with its size
 * and SHA-256, and the first heading of each HTML page.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { startFakeCloudflare } from "./cloudflare";
import { startFakeVercel } from "./vercel";

const [evidence = "/tmp/galley-deploy/evidence.json", cfPort = "4531", vercelPort = "4532"] = process.argv.slice(2);
// A certificate that takes a few looks to arrive, and one address with a DNS record already on it, so the rehearsal shows the wait and a refusal.
const cf = await startFakeCloudflare({ port: Number(cfPort), certificatePolls: 3 });

cf.dnsRecords.add("mail.example.com");
const vercel = await startFakeVercel({ port: Number(vercelPort) });

function describe(files: Map<string, Buffer>) {
  return [...files.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, bytes]) => ({
      path,
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
      ...(path.endsWith(".html") ? { h1: /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(bytes.toString("utf8"))?.[1]?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() } : {}),
    }));
}

function write() {
  writeFileSync(
    evidence,
    `${JSON.stringify(
      {
        cloudflare: { uploadedParts: cf.uploadedParts, domains: cf.domains, log: cf.log, deployments: cf.deployments.map((entry) => ({ kind: entry.kind, script: entry.script, id: entry.id, metadata: { ...entry.metadata, assets: { ...entry.metadata.assets, jwt: "[completion jwt]" } }, files: describe(entry.files) })) },
        vercel: { uploads: vercel.uploads, log: vercel.log, deployments: vercel.deployments.map((entry) => ({ kind: entry.kind, project: entry.project, id: entry.id, files: describe(entry.files) })) },
      },
      null,
      2
    )}\n`
  );
}

setInterval(write, 500);
write();
process.stdout.write(`fake Cloudflare ${cf.api} (key ${cf.token})\nfake Vercel ${vercel.url} (key ${vercel.token})\n`);
const stop = () => {
  write();
  void Promise.all([cf.close(), vercel.close()]).then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
