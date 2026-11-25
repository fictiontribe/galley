// A stand-in bucket for the "media in a bucket" captures: the engine's own test fake
// (packages/core/test/media-storage/fakes/s3.ts) with a made-up bucket and a made-up key. It checks
// every request's signature as R2 and S3 do. Nothing here talks to Cloudflare or Amazon.
//
//   node --import tsx apps/site/scripts/capture/serve-media.mts [port] [public port]     (from the repository root)
//
// The pictures show the bucket as a person would have it: Cloudflare R2, the account
// 0123456789abcdef0123456789abcdef, the public address https://media.example.com. Neither name leads
// anywhere real, so the capture's own Galley is started with media-names.mjs, which lets those two
// names reach this stand-in from that one process (start.sh does this).
// It prints the key it accepts: fixed test values, not a credential.
// MEDIA_FAKES may point at a copy of the fakes folder (so edits to the repository can't change a run).
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";

const fakes = resolve(process.env.MEDIA_FAKES ?? join(import.meta.dirname, "../../../../packages/core/test/media-storage/fakes"));
const { startFakeS3 } = await import(pathToFileURL(join(fakes, "s3.ts")).href);

const BUCKET = "caddow-media";
const KEY = { id: "capture0000000000000000000000key", secret: "capture-stand-in-secret-0000000000000000000000000000000000000000" };
const s3 = await startFakeS3({ port: Number(process.argv[2] ?? "4805"), publicPort: Number(process.argv[3] ?? "4806"), pageSize: 50 });
s3.addBucket(BUCKET, { region: "auto", public: true });
s3.addKey({ ...KEY, buckets: { [BUCKET]: ["read", "write", "list", "delete"] } });
process.stdout.write(`Stand-in bucket "${BUCKET}" at ${s3.endpoint}, its public files at ${s3.publicUrl(BUCKET)}\nAccess Key ID: ${KEY.id}\nSecret Access Key: ${KEY.secret}\n`);
const stop = () => void s3.close().then(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
