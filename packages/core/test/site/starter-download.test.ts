/**
 * A starter that is downloaded the first time it is used: the bundle keeps
 * what shows it and a record (asset, size, SHA-256); making a site from it
 * downloads the archive, refuses anything that isn't exactly what the record
 * says, and says so in plain words when it can't be downloaded.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPOSITORY_URL, VERSION } from "../../src/brand";
import { scaffoldSite } from "../../src/site/scaffold-site";
import { STARTER_DOWNLOAD, starterDownloadUrl } from "../../src/site/starter-download";
import { listStarters } from "../../src/site/starters";
import { cleanupAll, sh, tempDir, writeTree } from "../workspace/helpers";

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((done) => server.close(() => done()));
  cleanupAll();
});

const STARTER_FILES = {
  "package.json": '{\n  "name": "sarking",\n  "version": "0.0.1"\n}\n',
  "starter.json": '{\n  "name": "Sarking",\n  "description": "A blog.",\n  "preview": "galley/preview.webp",\n  "download": true\n}\n',
  "galley.config.json": "{}\n",
  "galley/preview.webp": "a picture",
  "galley/sections/chart.webp": "a section",
  "src/pages/index.md": "# Sarking\n",
  gitignore: "node_modules\n",
};

/** A starters folder holding what the bundle keeps of Sarking, and its archive, as build.mjs makes them. */
function packed(): { startersDir: string; archive: Buffer; record: Record<string, unknown> } {
  const full = tempDir("starter-full-");

  writeTree(full, STARTER_FILES);
  const archiveFile = join(tempDir("starter-archive-"), "starters-sarking.tgz");

  execFileSync("tar", ["-czf", archiveFile, "-C", full, "."]);
  const archive = readFileSync(archiveFile);
  const startersDir = tempDir("starters-");
  const record = { asset: "starters-sarking.tgz", bytes: archive.length, sha256: createHash("sha256").update(archive).digest("hex"), sections: 1, templates: 0 };

  writeTree(startersDir, {
    "sarking/package.json": STARTER_FILES["package.json"],
    "sarking/starter.json": STARTER_FILES["starter.json"],
    "sarking/galley.config.json": STARTER_FILES["galley.config.json"],
    "sarking/galley/preview.webp": STARTER_FILES["galley/preview.webp"],
    [`sarking/${STARTER_DOWNLOAD}`]: `${JSON.stringify(record)}\n`,
  });
  return { startersDir, archive, record };
}

/** Serves `files` by name; anything else is a 404. Returns the folder address. */
async function serve(files: Record<string, Buffer>): Promise<string> {
  const server = createServer((req, res) => {
    const body = files[decodeURIComponent((req.url ?? "/").slice(1))];

    if (!body) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/gzip", "content-length": body.length }).end(body);
  });

  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

const workFolders = () => readdirSync(tmpdir()).filter((name) => name.startsWith("galley-starter-")).length;

describe("a starter downloaded when it is first used", () => {
  it("is listed from what the bundle keeps, preview included", async () => {
    const { startersDir } = packed();
    const [starter] = await listStarters(startersDir);

    expect(starter).toMatchObject({ id: "sarking", name: "Sarking", previewUrl: "/api/starters/sarking/preview" });
  });

  it("is downloaded, checked and unpacked into a folder of its own, which is gone afterwards", async () => {
    const { startersDir, archive } = packed();
    const base = await serve({ "starters-sarking.tgz": archive });
    const target = join(tempDir("site-parent-"), "My Blog");
    const told: string[] = [];
    const before = workFolders();

    await scaffoldSite({ starterDir: join(startersDir, "sarking"), targetDir: target, name: "My Blog", env: { GALLEY_STARTER_DOWNLOADS: base }, onDownload: (size) => told.push(size) });
    expect(told).toEqual(["0.0 MB"]);
    expect(readFileSync(join(target, "src/pages/index.md"), "utf8")).toBe("# Sarking\n");
    expect(readFileSync(join(target, "galley/sections/chart.webp"), "utf8")).toBe("a section");
    // Neither the wizard's description nor the download record is part of the site; .gitignore got its dot back.
    expect(existsSync(join(target, "starter.json"))).toBe(false);
    expect(existsSync(join(target, STARTER_DOWNLOAD))).toBe(false);
    expect(existsSync(join(target, ".gitignore"))).toBe(true);
    expect(sh(target, "status", "--porcelain")).toBe("");
    expect(workFolders()).toBe(before);
  });

  it("refuses an archive that isn't the one recorded, and makes nothing", async () => {
    const { startersDir, archive } = packed();
    const tampered = Buffer.from(archive);

    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
    const target = join(tempDir("site-parent-"), "My Blog");

    for (const body of [tampered, Buffer.concat([archive, Buffer.from("more")])]) {
      const base = await serve({ "starters-sarking.tgz": body });

      await expect(scaffoldSite({ starterDir: join(startersDir, "sarking"), targetDir: target, name: "My Blog", env: { GALLEY_STARTER_DOWNLOADS: base } })).rejects.toThrow(
        "The Sarking starter that was downloaded isn't the one this version of Galley expects, so it wasn't used and nothing was made."
      );
      expect(existsSync(target)).toBe(false);
    }
  });

  it("says plainly when it can't be downloaded: offline, or not published yet", async () => {
    const { startersDir } = packed();
    const target = join(tempDir("site-parent-"), "My Blog");
    const missing = await serve({});
    // A port nothing listens on.
    const closed = await serve({});

    await new Promise<void>((done) => servers.pop()!.close(() => done()));
    await expect(scaffoldSite({ starterDir: join(startersDir, "sarking"), targetDir: target, name: "My Blog", env: { GALLEY_STARTER_DOWNLOADS: closed } })).rejects.toThrow(
      "The Sarking starter is downloaded the first time it is used, and it couldn't be downloaded just now. Check that this computer is online, then try again, or choose another starter."
    );
    await expect(scaffoldSite({ starterDir: join(startersDir, "sarking"), targetDir: target, name: "My Blog", env: { GALLEY_STARTER_DOWNLOADS: missing } })).rejects.toThrow(
      "The Sarking starter isn't available to download yet. Try again later, or choose another starter."
    );
    expect(existsSync(target)).toBe(false);
  });

  it("refuses a record that isn't valid, before anything is downloaded", async () => {
    const { startersDir } = packed();

    writeFileSync(join(startersDir, "sarking", STARTER_DOWNLOAD), JSON.stringify({ asset: "../../etc/passwd", bytes: 1, sha256: "0".repeat(64) }));
    await expect(scaffoldSite({ starterDir: join(startersDir, "sarking"), targetDir: join(tempDir("site-parent-"), "x"), name: "x" })).rejects.toThrow("download record isn't valid");
  });

  it("comes from this version's starters release unless GALLEY_STARTER_DOWNLOADS says otherwise", () => {
    expect(starterDownloadUrl("starters-sarking.tgz", {})).toBe(`${REPOSITORY_URL}/releases/download/starters-v${VERSION}/starters-sarking.tgz`);
    expect(starterDownloadUrl("starters-sarking.tgz", { GALLEY_STARTER_DOWNLOADS: "https://mirror.example/galley/" })).toBe("https://mirror.example/galley/starters-sarking.tgz");
  });
});
