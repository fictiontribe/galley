/**
 * Starters that travel apart from galley-cms: the archive build.mjs writes
 * (read back by the system's tar, the same bytes every time), what the
 * bundle keeps of such a starter, and a site made from the built bundle with
 * the archive downloaded from a local server.
 */
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..");
const made: string[] = [];
const servers: Server[] = [];

afterAll(async () => {
  for (const server of servers) await new Promise<void>((done) => server.close(() => done()));
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));

  made.push(dir);
  return dir;
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/** Every file under `dir`, as sorted relative paths. */
function list(dir: string, prefix = ""): string[] {
  return readdirSync(join(dir, prefix), { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? list(dir, prefix ? `${prefix}/${entry.name}` : entry.name) : [prefix ? `${prefix}/${entry.name}` : entry.name]))
    .sort();
}

interface ArchiveModule {
  starterArchive(dir: string): Buffer;
  keptFiles(manifest: unknown): Set<string>;
}

const archiveModule = (): Promise<ArchiveModule> => import(pathToFileURL(join(CLI, "scripts", "starter-archive.mjs")).href) as Promise<ArchiveModule>;
const LONG = `src/content/${"a-rather-long-folder-name/".repeat(5)}post-with-a-name-that-goes-on.md`;

describe("a starter's archive", () => {
  it("is read back by the system's tar exactly, the same bytes every time, a program kept runnable", async () => {
    const { starterArchive } = await archiveModule();
    const source = temp("starter-src-");

    write(source, { "package.json": "{}\n", "src/pages/index.md": "# Hi\n", "scripts/run.sh": "#!/bin/sh\necho hi\n", [LONG]: "long\n", gitignore: "node_modules\n" });
    chmodSync(join(source, "scripts/run.sh"), 0o755);
    const first = starterArchive(source);

    expect(starterArchive(source).equals(first)).toBe(true);
    const out = temp("starter-out-");

    writeFileSync(join(out, "a.tgz"), first);
    mkdirSync(join(out, "x"));
    execFileSync("tar", ["-xzf", "a.tgz", "-C", "x"], { cwd: out });
    expect(list(join(out, "x"))).toEqual(list(source));
    for (const file of list(source)) expect(readFileSync(join(out, "x", file), "utf8")).toBe(readFileSync(join(source, file), "utf8"));
    expect(statSync(join(out, "x", "scripts/run.sh")).mode & 0o111).not.toBe(0);
    expect(statSync(join(out, "x", "src/pages/index.md")).mode & 0o111).toBe(0);
  });

  it("leaves the bundle only what shows the starter: its three settings files and the pictures starter.json names", async () => {
    const { keptFiles } = await archiveModule();

    expect([...keptFiles({ preview: "galley/preview.webp", looks: [{ preview: "galley/looks/dusk.webp" }, { preview: "../../keys" }, {}] })].sort()).toEqual([
      "galley.config.json",
      "galley/looks/dusk.webp",
      "galley/preview.webp",
      "package.json",
      "starter.json",
    ]);
  });
});

describe("a bundle with a starter that is downloaded when used", { timeout: 300_000 }, () => {
  it("keeps it apart, records its archive, lists it, and makes a site from it downloaded from the release", async () => {
    const starters = temp("cli-starters-");
    const plain = { "package.json": '{ "name": "plain", "version": "0.0.1" }\n', "starter.json": '{ "name": "Plain", "short": "plain" }\n', "galley.config.json": "{}\n", "src/pages/index.md": "# Plain\n" };
    const blog = {
      "package.json": '{ "name": "sarking", "version": "0.0.1" }\n',
      "starter.json": JSON.stringify({ name: "Sarking", short: "sarking", description: "A blog.", preview: "galley/preview.webp", looks: [{ id: "paper", label: "Paper", preview: "galley/looks/paper.webp" }], download: true }),
      "galley.config.json": "{}\n",
      "galley/preview.webp": "picture",
      "galley/looks/paper.webp": "look",
      "galley/sections/chart.webp": "section",
      "galley/sections/table.webp": "section",
      "galley/templates/post.md": "---\n---\n",
      "src/pages/index.md": "# Sarking\n",
      ".gitignore": "node_modules\n",
    };

    write(join(starters, "plain"), plain);
    write(join(starters, "sarking"), blog);
    const dist = join(temp("cli-dist-"), "dist");

    execFileSync(process.execPath, [join(CLI, "build.mjs")], { cwd: CLI, env: { ...process.env, GALLEY_CLI_DIST: dist, GALLEY_CLI_STARTERS: starters }, stdio: "pipe" });
    // The bundled starter is whole; the downloaded one keeps what shows it, and its record.
    expect(list(join(dist, "starters", "plain"))).toEqual(Object.keys(plain).sort());
    expect(list(join(dist, "starters", "sarking"))).toEqual(["galley.config.json", "galley/looks/paper.webp", "galley/preview.webp", "package.json", "starter-download.json", "starter.json"]);
    const archive = readFileSync(join(`${dist}-starter-assets`, "starters-sarking.tgz"));
    const record = JSON.parse(readFileSync(join(dist, "starters", "sarking", "starter-download.json"), "utf8"));

    expect(record).toEqual({ asset: "starters-sarking.tgz", bytes: archive.length, sha256: createHash("sha256").update(archive).digest("hex"), sections: 2, templates: 1 });
    expect(existsSync(`${dist}-starter-assets/starters-plain.tgz`)).toBe(false);

    const home = temp("cli-home-");
    const galley = (args: string[], env: Record<string, string> = {}) =>
      execFileSync(process.execPath, [join(dist, "galley.mjs"), ...args], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: home, GALLEY_HOME: join(home, ".galley"), ...env } });
    const listed = JSON.parse(galley(["starters", "--json"])) as Array<{ short: string; inside: string }>;

    expect(listed.map((starter) => starter.short).sort()).toEqual(["plain", "sarking"]);
    expect(listed.find((starter) => starter.short === "sarking")?.inside).toMatch(/^2 sections · 1 page template · 1 look · downloaded when used \(0\.0 MB\)$/);

    const server = createServer((req, res) => (req.url === "/starters-sarking.tgz" ? res.writeHead(200).end(archive) : res.writeHead(404).end()));

    servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const sites = temp("cli-sites-");
    // Not execFileSync: the server answering the download runs in this process.
    const { stdout: out } = await promisify(execFile)(process.execPath, [join(dist, "galley.mjs"), "new", "my-blog", "--starter", "sarking", "--dir", sites, "--no-install", "--no-start"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", HOME: home, GALLEY_HOME: join(home, ".galley"), GALLEY_STARTER_DOWNLOADS: base },
    });

    expect(out).toContain("Downloading the starter (0.0 MB)");
    const site = join(sites, "my-blog");

    expect(readFileSync(join(site, "src/pages/index.md"), "utf8")).toBe("# Sarking\n");
    expect(readFileSync(join(site, "galley/templates/post.md"), "utf8")).toBe("---\n---\n");
    expect(existsSync(join(site, ".gitignore"))).toBe(true);
    expect(existsSync(join(site, "starter-download.json"))).toBe(false);
  });
});
