/**
 * Backups of a data folder, with the system's own tar and real files: what
 * goes in and what doesn't, the sealed format (a wrong passphrase, a file
 * cut short, one flipped byte), hostile archives that would write outside
 * the staging folder, a newer schema, and the swap with its rollback.
 */
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { PRODUCT, VERSION } from "../../src/brand";
import {
  BACKUP_MAGIC,
  BackupError,
  backupEntries,
  INSTALL_SCHEMA_VERSION,
  listArchive,
  safeArchivePath,
  sealArchive,
  stageRestore,
  writeBackupFile,
  type BackupManifest,
} from "../../src/install/index";
import { cleanupAll, sh, tempDir, writeTree } from "../workspace/helpers";

afterAll(() => cleanupAll());

const PASSPHRASE = "a passphrase long enough";
/** Cheap parameters for tests; the format records them, so opening is the same. */
const FAST = { N: 1024, r: 8, p: 1 };

/** A data folder as a hosted install leaves it, with things that must and must not be carried. */
function dataFolder(): string {
  const home = tempDir("backup-home-");

  writeTree(home, {
    "install.json": JSON.stringify({ schema: INSTALL_SCHEMA_VERSION, marker: "state" }),
    "settings.json": "{\"author\":{\"name\":\"Sam\"}}",
    "secrets.json": "{\"anthropic\":\"sk-ant-fake-backup-0000000000\"}",
    "session.key": "ab".repeat(32),
    "keys/deploy_key": "PRIVATE KEY (fake)\n",
    "keys/deploy_key.pub": "ssh-ed25519 AAAAfake galley-editor\n",
    "state/s1/submissions/one.json": "{\"name\":\"Sam\"}",
    "state/s1/threads/t1.json": "{}",
    "plugins/plugins.json": "{\"plugins\":[]}",
    "plugins/node_modules/some-plugin/index.js": "skip me",
    "home/.npm/cache.bin": "skip me",
    "tmp/candidates/x.png": "skip me",
    "site/node_modules/dep/index.js": "skip me",
    "site/dist/index.html": "skip me",
    "site/.astro/types.d.ts": "skip me",
    ".restore-old/data/x": "skip me",
    "server.lock": "{}",
    "backups/older.bak": "skip me",
  });
  const site = join(home, "site");

  sh(site, "init", "-q", "-b", "main");
  writeTree(site, { "src/pages/index.md": "# Home\n", ".gitignore": "node_modules\ndist\n.astro\n" });
  sh(site, "add", "-A");
  sh(site, "commit", "-q", "-m", "First");
  writeFileSync(join(site, "src/pages/index.md"), "# Home, changed and not published\n");
  symlinkSync("src/pages/index.md", join(site, "inside-link"));
  symlinkSync("/etc/hosts", join(site, "outside-link"));
  // Inside the data folder, but out of the checkout and at a key: not the site's to carry.
  symlinkSync("../keys/deploy_key", join(site, "key-link"));
  return home;
}

async function backupOf(home: string, passphrase = PASSPHRASE): Promise<string> {
  const file = join(tempDir("backup-file-"), "site-backup.bak");

  await writeBackupFile({ home, passphrase, file, scrypt: FAST });
  return file;
}

async function restoreFails(file: string, passphrase = PASSPHRASE): Promise<BackupError> {
  const target = tempDir("backup-target-");

  writeTree(target, { "install.json": "untouched" });
  const error = await stageRestore({ home: target, source: createReadStream(file), passphrase }).then(
    () => null,
    (caught: unknown) => caught
  );

  expect(error).toBeInstanceOf(BackupError);
  // Nothing changed, and nothing was left behind.
  expect(readdirSync(target)).toEqual(["install.json"]);
  expect(readFileSync(join(target, "install.json"), "utf8")).toBe("untouched");
  return error as BackupError;
}

describe("what a backup carries", () => {
  it("everything that can't be rebuilt, and none of the packages, caches, build output or staging", async () => {
    const home = dataFolder();
    const entries = await backupEntries(home);

    expect(entries).toEqual(expect.arrayContaining(["install.json", "settings.json", "secrets.json", "session.key", "keys/deploy_key", "state/s1/submissions/one.json", "plugins/plugins.json", "site/.git/HEAD", "site/src/pages/index.md", "site/inside-link"]));
    for (const entry of entries) expect(entry).not.toMatch(/node_modules|^home\/|^tmp\/|^backups(\/|$)|^site\/dist|^site\/\.astro|^\.restore-|^server\.lock$|outside-link|key-link/);
  });

  it("a backup written into the data folder's backups/ folder is restored from there, and every backup in it stays", async () => {
    const home = dataFolder();
    const file = join(home, "backups", "site.bak");

    await writeBackupFile({ home, passphrase: PASSPHRASE, file, scrypt: FAST });
    writeFileSync(join(home, "settings.json"), "{\"changed\":true}");
    const staged = await stageRestore({ home, source: createReadStream(file), passphrase: PASSPHRASE });
    const applied = await staged.apply();

    await applied.commit();
    expect(readFileSync(join(home, "settings.json"), "utf8")).toBe("{\"author\":{\"name\":\"Sam\"}}");
    expect(readdirSync(join(home, "backups")).sort()).toEqual(["older.bak", "site.bak"]);
  });

  it("keeps build output the repository tracks", async () => {
    const home = dataFolder();
    const entries = await backupEntries(home, { tracked: async (dir) => dir === "site/dist" });

    expect(entries).toContain("site/dist/index.html");
    expect(entries).not.toContain("site/.astro/types.d.ts");
  });
});

describe("a backup, restored", () => {
  it("round-trips: the state, the keys, the inbox and the checkout with its unpublished change and history", async () => {
    const home = dataFolder();
    const file = await backupOf(home);
    const bytes = readFileSync(file);

    expect(bytes.subarray(0, 8).equals(BACKUP_MAGIC)).toBe(true);
    // Sealed: nothing readable inside.
    for (const plain of ["sk-ant-fake-backup", "PRIVATE KEY", "Home, changed"]) expect(bytes.includes(Buffer.from(plain))).toBe(false);

    const target = tempDir("backup-target-");

    writeTree(target, { "install.json": "the old state", "secrets.json": "{\"old\":\"key\"}", "home/.npm/keep.bin": "cache stays" });
    const staged = await stageRestore({ home: target, source: createReadStream(file), passphrase: PASSPHRASE });

    expect(staged.manifest).toMatchObject({ product: PRODUCT.slug, version: VERSION, schema: INSTALL_SCHEMA_VERSION });
    // Staged only: nothing in place yet.
    expect(readFileSync(join(target, "install.json"), "utf8")).toBe("the old state");
    const applied = await staged.apply();

    expect(JSON.parse(readFileSync(join(target, "install.json"), "utf8")).marker).toBe("state");
    expect(readFileSync(join(target, "keys/deploy_key"), "utf8")).toBe("PRIVATE KEY (fake)\n");
    expect(statSync(join(target, "keys/deploy_key")).mode & 0o077).toBe(lstatSync(join(home, "keys/deploy_key")).mode & 0o077);
    expect(readFileSync(join(target, "state/s1/submissions/one.json"), "utf8")).toBe("{\"name\":\"Sam\"}");
    expect(readFileSync(join(target, "site/src/pages/index.md"), "utf8")).toBe("# Home, changed and not published\n");
    expect(sh(join(target, "site"), "log", "--format=%s")).toBe("First");
    expect(sh(join(target, "site"), "status", "--porcelain")).toContain("src/pages/index.md");
    expect(readlinkSync(join(target, "site/inside-link"))).toBe("src/pages/index.md");
    expect(existsSync(join(target, "site/node_modules"))).toBe(false);
    // What a backup never carries stays where it was.
    expect(readFileSync(join(target, "home/.npm/keep.bin"), "utf8")).toBe("cache stays");

    await applied.rollback();
    expect(readFileSync(join(target, "install.json"), "utf8")).toBe("the old state");
    expect(readFileSync(join(target, "secrets.json"), "utf8")).toBe("{\"old\":\"key\"}");
    expect(existsSync(join(target, "site"))).toBe(false);
    await staged.discard();
    expect(readdirSync(target).sort()).toEqual(["home", "install.json", "secrets.json"]);
  });

  it("a wrong passphrase changes nothing and says so", async () => {
    const error = await restoreFails(await backupOf(dataFolder()), "not the passphrase at all");

    expect(error.problem).toBe("wrong-passphrase");
    expect(error.message).toMatch(/passphrase doesn't open this backup/);
  });

  it("a file cut short changes nothing and says it is damaged", async () => {
    const file = await backupOf(dataFolder());
    const bytes = readFileSync(file);

    for (const keep of [bytes.length - 1, bytes.length - 17, Math.floor(bytes.length / 2), 200]) {
      writeFileSync(file, bytes.subarray(0, keep));
      expect((await restoreFails(file)).problem).toBe("damaged");
    }
  });

  it("one flipped byte anywhere changes nothing and says it is damaged", async () => {
    const file = await backupOf(dataFolder());
    const bytes = readFileSync(file);

    for (const at of [20, 60, bytes.length - 5, Math.floor(bytes.length / 2)]) {
      const flipped = Buffer.from(bytes);

      flipped[at] = flipped[at]! ^ 0x01;
      writeFileSync(file, flipped);
      expect((await restoreFails(file)).problem, `byte ${at}`).toBe("damaged");
    }
  });

  it("a file that isn't a backup is refused as such", async () => {
    const file = join(tempDir("backup-file-"), "notes.txt");

    writeFileSync(file, "just some notes, long enough to read a header from");
    expect((await restoreFails(file)).problem).toBe("not-a-backup");
  });
});

/** A ustar archive written by hand, so it can hold what no tar would make on purpose. */
function tarOf(entries: Array<{ name: string; type?: "0" | "2" | "5" | "1"; link?: string; body?: string }>): Buffer {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? "");
    const header = Buffer.alloc(512);

    header.write(entry.name, 0, 100, "utf8");
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("00000000000\0", 136);
    header.write(entry.type ?? "0", 156);
    if (entry.link) header.write(entry.link, 157, 100, "utf8");
    header.write("ustar\0", 257);
    header.write("00", 263);
    header.fill(" ", 148, 156);
    let sum = 0;

    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

async function sealed(tar: Buffer, manifest: Partial<BackupManifest> = {}): Promise<string> {
  const file = join(tempDir("backup-file-"), "made.bak");
  const { stream } = await sealArchive({
    archive: Readable.from([gzipSync(tar)]),
    manifest: { format: 1, product: PRODUCT.slug, version: VERSION, schema: INSTALL_SCHEMA_VERSION, createdAt: new Date().toISOString(), madeOn: "test", ...manifest },
    passphrase: PASSPHRASE,
    scrypt: FAST,
  });
  const chunks: Buffer[] = [];

  for await (const chunk of stream) chunks.push(chunk as Buffer);
  writeFileSync(file, Buffer.concat(chunks));
  return file;
}

describe("hostile archives", () => {
  it("reads the archive itself, entry by entry", async () => {
    const dir = tempDir("backup-file-");

    writeFileSync(join(dir, "a.tar.gz"), gzipSync(tarOf([{ name: "dir/", type: "5" }, { name: "dir/a.txt", body: "hello" }, { name: "dir/link", type: "2", link: "a.txt" }])));
    expect(await listArchive(join(dir, "a.tar.gz"))).toEqual([
      { path: "dir/", type: "directory", link: null },
      { path: "dir/a.txt", type: "file", link: null },
      { path: "dir/link", type: "symlink", link: "a.txt" },
    ]);
  });

  it.each([
    ["an absolute path", [{ name: "/tmp/escaped-by-a-backup.txt", body: "x" }]],
    ["a path with ..", [{ name: "site/../../escaped.txt", body: "x" }]],
    ["a link pointing out", [{ name: "site/", type: "5" as const }, { name: "site/out", type: "2" as const, link: "../../../etc" }]],
    ["an absolute link", [{ name: "out", type: "2" as const, link: "/etc/passwd" }]],
    ["a hard link to a path outside", [{ name: "hard", type: "1" as const, link: "../outside" }]],
    [
      "a link from the site's checkout to a key beside it",
      [{ name: "keys/", type: "5" as const }, { name: "keys/deploy_key", body: "key" }, { name: "site/", type: "5" as const }, { name: "site/key", type: "2" as const, link: "../keys/deploy_key" }],
    ],
    [
      "a hard link from the site's checkout to a key",
      [{ name: "keys/", type: "5" as const }, { name: "keys/deploy_key", body: "key" }, { name: "site/", type: "5" as const }, { name: "site/key", type: "1" as const, link: "keys/deploy_key" }],
    ],
    ["a link at the top of the data folder", [{ name: "out", type: "2" as const, link: "install.json" }]],
  ])("%s is refused and nothing is written anywhere", async (_name, entries) => {
    const parent = tempDir("backup-parent-");
    const target = join(parent, "data");

    mkdirSync(target);
    writeTree(target, { "install.json": "untouched" });
    const file = await sealed(tarOf([{ name: "install.json", body: "{}" }, ...entries]));
    const error = await stageRestore({ home: target, source: createReadStream(file), passphrase: PASSPHRASE }).then(
      () => null,
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(BackupError);
    expect((error as BackupError).problem).toBe("unsafe");
    expect(readdirSync(target)).toEqual(["install.json"]);
    expect(readdirSync(parent)).toEqual(["data"]);
    expect(existsSync("/tmp/escaped-by-a-backup.txt")).toBe(false);
  });

  it("knows a safe path from an unsafe one", () => {
    for (const path of ["a", "a/b", "a/./b", "a/b/"]) expect(safeArchivePath(path), path).toBe(true);
    for (const path of ["/a", "..", "a/../..", "a/../../b", "../a", "a\\..\\b", "C:/x", ""]) expect(safeArchivePath(path), path).toBe(false);
  });

  it("a backup made by a newer data version is refused", async () => {
    const file = await sealed(tarOf([{ name: "install.json", body: "{}" }]), { schema: INSTALL_SCHEMA_VERSION + 1 });
    const error = await restoreFails(file);

    expect(error.problem).toBe("newer-schema");
    expect(error.message).toMatch(/made by a newer version/);
  });
});
