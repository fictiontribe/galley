/**
 * Install test helpers: a code host that is really git (`git http-backend`)
 * behind Basic auth on a local port, a `git` on PATH that writes down every
 * argument list it is started with, and a fake `ssh` that answers like a
 * code host refusing an unknown key.
 */
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { sh, tempDir } from "../workspace/helpers";

export { sh, tempDir };

export interface HttpGitHost {
  /** http://127.0.0.1:<port>/<name>.git */
  url(name: string): string;
  /** Every Authorization header the host received, decoded ("user:password"). */
  readonly credentials: string[];
  close(): Promise<void>;
}

/**
 * Serves every bare repository in `root` over git's smart HTTP protocol,
 * pushing included, to clients that send `user:password` with Basic auth.
 */
export async function httpGitHost(root: string, expected: { user: string; password: string }): Promise<HttpGitHost> {
  const backend = join(execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(), "git-http-backend");
  const credentials: string[] = [];
  const server: Server = createServer((req, res) => {
    const header = req.headers.authorization ?? "";
    const decoded = header.startsWith("Basic ") ? Buffer.from(header.slice(6), "base64").toString("utf8") : null;

    if (decoded !== null) credentials.push(decoded);
    if (decoded !== `${expected.user}:${expected.password}`) {
      res.writeHead(401, { "www-authenticate": 'Basic realm="test"' });
      res.end("no");
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const child = spawn(backend, [], {
      env: {
        PATH: process.env.PATH,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: decodeURIComponent(url.pathname),
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: req.method ?? "GET",
        CONTENT_TYPE: req.headers["content-type"] ?? "",
        REMOTE_USER: expected.user,
        REMOTE_ADDR: "127.0.0.1",
        GIT_CONFIG_NOSYSTEM: "1",
        ...(req.headers["content-encoding"] ? { HTTP_CONTENT_ENCODING: String(req.headers["content-encoding"]) } : {}),
        ...(req.headers["git-protocol"] ? { HTTP_GIT_PROTOCOL: String(req.headers["git-protocol"]) } : {}),
      },
    });
    const chunks: Buffer[] = [];

    req.pipe(child.stdin);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("close", () => {
      const out = Buffer.concat(chunks);
      const split = out.indexOf("\r\n\r\n");
      const head = out.subarray(0, split).toString("utf8");
      const body = out.subarray(split + 4);
      let status = 200;
      const headers: Record<string, string> = {};

      for (const line of head.split("\r\n")) {
        const colon = line.indexOf(":");
        const name = line.slice(0, colon).trim().toLowerCase();
        const value = line.slice(colon + 1).trim();

        if (name === "status") status = Number(value.split(" ")[0]);
        else if (name) headers[name] = value;
      }
      res.writeHead(status, headers);
      res.end(body);
    });
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;

  return {
    url: (name) => `http://127.0.0.1:${port}/${name}.git`,
    credentials,
    close: () => new Promise((done) => server.close(() => done())),
  };
}

/** A bare repository called `<name>.git` in `root`, empty or with one version of `files` on main. */
export function bareRepository(root: string, name: string, files?: Record<string, string>): string {
  const bare = join(root, `${name}.git`);

  mkdirSync(bare, { recursive: true });
  sh(bare, "init", "-q", "--bare", "-b", "main");
  sh(bare, "config", "http.receivepack", "true");
  if (files) {
    const work = tempDir("install-seed-");

    sh(work, "init", "-q", "-b", "main");
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(work, path, ".."), { recursive: true });
      writeFileSync(join(work, path), content);
    }
    sh(work, "add", "-A");
    sh(work, "commit", "-q", "-m", "First");
    sh(work, "push", "-q", bare, "main");
  }
  return bare;
}

/**
 * A folder to put first on PATH: `git` there writes each argument list to
 * `log` (one JSON array a line) and runs the real git.
 */
export function recordingGit(): { dir: string; log: string; calls(): string[][] } {
  const dir = tempDir("install-bin-");
  const log = join(dir, "git-calls.log");
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();

  writeFileSync(
    join(dir, "git"),
    `#!/bin/sh\n${JSON.stringify(process.execPath)} -e 'require("fs").appendFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)) + "\\n")' ${JSON.stringify(log)} "$@"\nexec ${JSON.stringify(real)} "$@"\n`
  );
  chmodSync(join(dir, "git"), 0o755);
  writeFileSync(log, "");
  return {
    dir,
    log,
    calls: () =>
      readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]),
  };
}

/** A folder to put first on PATH whose `ssh` answers like a code host that doesn't know the key. */
export function refusingSsh(): string {
  const dir = tempDir("install-ssh-");

  writeFileSync(join(dir, "ssh"), "#!/bin/sh\necho 'git@code.example: Permission denied (publickey).' >&2\nexit 255\n");
  chmodSync(join(dir, "ssh"), 0o755);
  return dir;
}
