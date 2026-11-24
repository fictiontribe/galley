#!/usr/bin/env node
// A rehearsal of media storage against the REAL service — for the
// maintainers, by hand. The tests use stand-ins; this is how the same steps
// are seen on Cloudflare R2 or Amazon S3 themselves.
//
//   npx tsx scripts/rehearse-media-storage.mjs --connector r2 \
//     --bucket <name> --account <account id> --public-url https://media.example.com
//   npx tsx scripts/rehearse-media-storage.mjs --connector s3 \
//     --bucket <name> --region eu-west-1 --public-url https://<bucket>.s3.eu-west-1.amazonaws.com
//
// The key is read from GALLEY_MEDIA_ACCESS_KEY_ID and
// GALLEY_MEDIA_SECRET_ACCESS_KEY — never an option.
//
// It makes a throwaway copy of the starter (a git checkout in a temporary
// folder, its own Galley home), connects it to the bucket under a folder of
// its own (`galley-rehearsal-<random>/`), and walks through: the check, an
// upload, the library, Proof, used-on, a refused delete, a move to the bucket
// and back, and a delete. One line per step; the first that fails ends the
// run with exit code 1. At the end — failed or not — it deletes every object
// it made under its folder and removes the temporary folders, unless --keep.
// It never touches anything outside its own folder of the bucket.
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { createMediaStorageService } from "../packages/core/src/media-storage/service.ts";
import { openSiteService } from "../packages/core/src/site/service.ts";
import { createEventBus } from "../packages/core/src/site/events.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: {
    connector: { type: "string" },
    bucket: { type: "string" },
    account: { type: "string" },
    region: { type: "string" },
    endpoint: { type: "string" },
    "public-url": { type: "string" },
    keep: { type: "boolean", default: false },
  },
});

function fail(message) {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}

if (!values.connector || !values.bucket || !values["public-url"]) {
  fail("Give --connector (r2 or s3), --bucket and --public-url (and --account for R2, --region for S3).");
  process.exit(2);
}
if (!process.env.GALLEY_MEDIA_ACCESS_KEY_ID || !process.env.GALLEY_MEDIA_SECRET_ACCESS_KEY) {
  fail("Set GALLEY_MEDIA_ACCESS_KEY_ID and GALLEY_MEDIA_SECRET_ACCESS_KEY to the bucket's key.");
  process.exit(2);
}

const folder = `galley-rehearsal-${randomBytes(4).toString("hex")}`;
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "rehearse-media-")));
const home = join(scratch, "home");
const root = join(scratch, "site");
const config = {
  connector: values.connector,
  bucket: values.bucket,
  publicUrl: values["public-url"],
  prefix: folder,
  ...(values.account ? { account: values.account } : {}),
  ...(values.region ? { region: values.region } : {}),
  ...(values.endpoint ? { endpoint: values.endpoint } : {}),
};

console.log(`Rehearsing ${values.connector} on bucket ${values.bucket}, folder ${folder}/ — everything made is removed at the end.`);
cpSync(join(ROOT, "starters/astro-starter"), root, { recursive: true, filter: (source) => !["node_modules", "dist", ".astro"].includes(basename(source)) });
const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "Rehearsal", GIT_AUTHOR_EMAIL: "rehearsal@example.com", GIT_COMMITTER_NAME: "Rehearsal", GIT_COMMITTER_EMAIL: "rehearsal@example.com" } });
git("init", "-q", "-b", "main");
git("add", "-A");
git("commit", "-q", "-m", "Rehearsal starter");

const storage = createMediaStorageService({ home, env: process.env, listTtlMs: 0 });
const site = await openSiteService(root, { id: "rehearsal", events: createEventBus(), overlayScript: () => "", author: () => ({ name: "Rehearsal", email: "rehearsal@example.com" }), watch: false, media: storage });
let step = 0;

async function run(label, work) {
  step += 1;
  try {
    const detail = await work();
    console.log(`✓ ${step}. ${label}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    fail(`${step}. ${label}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

try {
  await run("Check and connect", async () => {
    const result = await storage.connect(site, { config });
    for (const s of result.check.steps) console.log(`    ${s.state === "ok" ? "✓" : s.state === "failed" ? "✗" : "·"} ${s.label}`);
    if (!result.check.ok) throw new Error(`${result.check.message}${result.check.detail ? ` (${result.check.detail})` : ""}`);
    return "the test picture was stored, read back, listed, loaded from the public address and removed";
  });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  let uploaded;
  await run("Upload a picture", async () => {
    uploaded = await site.saveMedia({ filename: "Rehearsal Coat.png", data: png });
    if (uploaded.location !== "bucket") throw new Error(`it went to ${uploaded.location ?? "the repository"}`);
    const again = await site.saveMedia({ filename: "rehearsal-coat.png", data: png });
    if (again.key === uploaded.key) throw new Error("the second upload took the same name");
    return `${uploaded.url}, then ${again.key} for the same name`;
  });
  await run("Load it from its public address", async () => {
    const response = await fetch(uploaded.url);
    if (!response.ok) throw new Error(`${response.status}`);
    return `${response.status}, ${response.headers.get("cache-control") ?? "no cache-control"}`;
  });
  await run("The library lists it with its size", async () => {
    const item = (await site.listMedia()).find((candidate) => candidate.key === uploaded.key);
    if (!item?.width) throw new Error("not listed, or no size");
    return `${item.width}×${item.height}`;
  });
  const page = join(root, "src/content/authors/tomas-reyes.md");
  await run("Proof sees the upload, and a page using it", async () => {
    writeFileSync(page, readFileSync(page, "utf8").replace(/photo: .*/, `photo: ${uploaded.url}`));
    const changes = await site.changes();
    const listed = changes.storeUploads?.find((item) => item.key === uploaded.key);
    if (!listed?.used) throw new Error("not in Proof as used");
    return `${changes.storeUploads.length} in the bucket`;
  });
  await run("Used on, and a delete refused while used", async () => {
    const usage = await storage.usage(site, uploaded.url);
    if (!usage.working.length) throw new Error("no page found");
    const deleted = await storage.deleteStored(site, [uploaded.path]);
    if (!deleted.refused.length) throw new Error("it was deleted");
    return usage.working.map((w) => w.path).join(", ");
  });
  await run("Move the repository's media to the bucket", async () => {
    git("checkout", "--", "src/content/authors/tomas-reyes.md");
    const outcome = await storage.move(site, { kind: "move", from: "repository", to: "bucket", keepCopies: true });
    // Templates that use media are left alone on purpose; anything else is a failure.
    const real = outcome.problems.filter((p) => !p.reason.includes("not its content"));
    if (real.length) throw new Error(real.map((p) => `${p.path}: ${p.reason}`).join("; "));
    return `${outcome.summary} (${outcome.problems.length - real.length} templates left as they are)`;
  });
  await run("And back to the repository", async () => {
    const outcome = await storage.move(site, { kind: "move", from: "bucket", to: "repository" });
    return outcome.summary;
  });
} catch {
  // Reported above; clean up below.
} finally {
  await run("Remove everything made under the folder", async () => {
    const [store] = await storage.stores(site);
    if (!store) return "nothing connected";
    let removed = 0;
    let cursor;
    do {
      const page = await store.list(cursor);
      for (const item of page.items) {
        await store.delete(item.key);
        removed += 1;
      }
      cursor = page.next ?? undefined;
    } while (cursor);
    // Anything list() skipped (no known file type) under the folder, by the raw listing.
    const left = await store.client.listAll(`${folder}/`);
    for (const object of left) await store.client.deleteObject(object.key);
    return `${removed + left.length} objects`;
  }).catch(() => undefined);
  await site.dispose?.();
  if (!values.keep) rmSync(scratch, { recursive: true, force: true });
  else console.log(`Kept ${scratch}`);
}
