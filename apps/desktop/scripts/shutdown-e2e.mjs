#!/usr/bin/env node
// Launches the real desktop app (the debug build) and proves its lifecycle on
// this Mac, twice: once quitting normally (SIGTERM → the app's own quit path)
// and once with `kill -9` (the server notices its stdin close and stops).
//
//   pnpm --filter @galley/desktop test:shutdown [-- <path to app binary>]
//
// Each round: start the app with a Finder-like PATH (/usr/bin:/bin:…), so
// the login-shell PATH resolution has to work → the server answers
// /api/meta with desktop: true → the main window exists (window list) → the
// in-page self-test reports the bridge and the permission boundary (debug
// builds only, see src/selftest.rs) → open a copy of the starter site and
// start its preview (a real dev server behind the proxy) → stop the app →
// nothing listens on the server, proxy or dev-server ports, and no process
// from the app's tree is left. Uses a temporary GALLEY_HOME.
//
// Two windows: after the site is opened, the app is launched a second time
// with the site's folder (as Finder does for a folder dropped on the Dock
// icon); the running app takes it over and opens the site in a window of its
// own. Both windows must exist, both run the self-test with exactly the same
// bridge, and round 2 must reopen the site's window by itself (remembered).
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { connect } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const binary = process.argv[2] ?? join(here, "..", "src-tauri", "target", "debug", "galley-desktop");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
  return ok;
}

function answers(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = connect({ host, port });

    socket.setTimeout(800, () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function table() {
  return execFileSync("/bin/ps", ["-A", "-o", "pid=", "-o", "ppid=", "-o", "pgid=", "-o", "command="], { encoding: "utf8" })
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map(([, pid, ppid, pgid, command]) => ({ pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), command }));
}

function descendants(root) {
  const all = table();
  const found = [];
  const frontier = [root];

  while (frontier.length) {
    const parent = frontier.pop();

    for (const info of all) {
      if (info.ppid === parent && !found.some((f) => f.pid === info.pid)) {
        found.push(info);
        frontier.push(info.pid);
      }
    }
  }
  return found;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** Window list of a process, from CoreGraphics (needs no Accessibility permission). */
function windowsOf(pid) {
  const script = `ObjC.import("CoreGraphics");
const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, 0)));
JSON.stringify(list.filter((w) => w.kCGWindowOwnerPID === ${pid} && w.kCGWindowLayer === 0).map((w) => ({ id: w.kCGWindowNumber, name: w.kCGWindowName ?? null, onscreen: !!w.kCGWindowIsOnscreen, width: w.kCGWindowBounds.Width, height: w.kCGWindowBounds.Height })));`;

  try {
    return JSON.parse(execFileSync("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], { encoding: "utf8" }));
  } catch (error) {
    return { error: error.message.split("\n")[0] };
  }
}

// A page on another loopback port, standing in for the preview inside the app's window.
const frameServer = createHttpServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(`<!doctype html><script>
(async () => {
  const result = { origin: location.origin, hasBridge: "__GALLEY_DESKTOP__" in window, hasInternals: !!window.__TAURI_INTERNALS__ };
  if (window.__TAURI_INTERNALS__) {
    try { await window.__TAURI_INTERNALS__.invoke("reveal_in_finder", { path: "/etc" }); result.invoke = "allowed"; }
    catch (error) { result.invoke = "refused: " + String(error && error.message || error); }
  }
  parent.postMessage(result, "*");
})();
</script>`);
});
await new Promise((resolve) => frameServer.listen(0, "127.0.0.1", resolve));
const frameUrl = `http://127.0.0.1:${frameServer.address().port}/frame`;

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-desktop-e2e-")));
// The shell remembers open site windows in its config folder; keep the person's own list out of the way.
const windowsFile = join(homedir(), "Library", "Application Support", "com.fictiontribe.galley", "windows.json");
const savedWindows = existsSync(windowsFile) ? readFileSync(windowsFile) : null;
rmSync(windowsFile, { force: true });
const site = join(tmp, "site");
const starter = join(repo, "starters", "astro-starter");
const git = (...args) => execFileSync("git", args, { cwd: site, encoding: "utf8" });

cpSync(starter, site, { recursive: true, filter: (source) => !["node_modules", ".astro", "dist"].includes(basename(source)) });
symlinkSync(realpathSync(join(starter, "node_modules")), join(site, "node_modules"));
git("init", "-q");
git("symbolic-ref", "HEAD", "refs/heads/main");
writeFileSync(join(site, ".git", "info", "exclude"), "node_modules\n");
git("-c", "user.name=E2E", "-c", "user.email=e2e@example.invalid", "add", "-A");
git("-c", "user.name=E2E", "-c", "user.email=e2e@example.invalid", "commit", "-q", "-m", "First version");

async function round(label, stop) {
  console.log(`\n── ${label}`);
  const selftestOut = join(tmp, `selftest-${Date.now()}.json`);
  // What an app opened from the Finder gets: launchd's PATH, no agent variables.
  const env = {
    HOME: process.env.HOME,
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME,
    SHELL: process.env.SHELL,
    TMPDIR: process.env.TMPDIR,
    LANG: "en_US.UTF-8",
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    ASTRO_TELEMETRY_DISABLED: "1",
    GALLEY_HOME: join(tmp, "home"),
    GALLEY_DESKTOP_SELFTEST: frameUrl,
    GALLEY_DESKTOP_SELFTEST_OUT: selftestOut,
  };
  const app = spawn(binary, [], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";

  app.stdout.on("data", (chunk) => (log += chunk));
  app.stderr.on("data", (chunk) => (log += chunk));
  const appExited = new Promise((resolve) => app.once("exit", (code, signal) => resolve(code ?? signal)));
  const started = Date.now();
  let serverPid = 0;
  let port = 0;

  while (Date.now() - started < 60_000 && !port) {
    const match = /\[desktop\] server pid (\d+) on port (\d+)/.exec(log);

    if (match) [serverPid, port] = [Number(match[1]), Number(match[2])];
    else await delay(100);
  }
  if (!check("the app started its server", port > 0, port ? `app pid ${app.pid}, server pid ${serverPid}, port ${port}` : log.slice(-2000))) {
    app.kill("SIGKILL");
    return;
  }
  check("PATH came from the login shell", /PATH from login shell/.test(log), (/PATH from [^:]+/.exec(log) ?? [""])[0]);
  // The token only exists in the server's environment; read it the way an operator could.
  const token = /GALLEY_TOKEN=([0-9a-f]+)/.exec(execFileSync("/bin/ps", ["eww", "-o", "command=", "-p", String(serverPid)], { encoding: "utf8" }))?.[1];
  const api = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  let meta = null;

  for (let i = 0; i < 100 && !meta; i += 1) {
    meta = await api("GET", "/api/meta").then((r) => (r.status === 200 ? r.body : null), () => null);
    if (!meta) await delay(200);
  }
  check("GET /api/meta with the token reports desktop: true", meta?.desktop === true, JSON.stringify({ desktop: meta?.desktop, mode: meta?.mode, authenticated: meta?.authenticated, version: meta?.version }));
  const unauthenticated = await fetch(`http://127.0.0.1:${port}/api/sites`).then((r) => r.status);
  check("the API refuses requests without the token", unauthenticated === 401 || unauthenticated === 403, `GET /api/sites → ${unauthenticated}`);

  let windows = [];
  for (let i = 0; i < 50; i += 1) {
    windows = windowsOf(app.pid);
    if (Array.isArray(windows) && windows.some((w) => w.width >= 1024 && w.height >= 680)) break;
    await delay(200);
  }
  const main = Array.isArray(windows) ? windows.find((w) => w.width >= 1024 && w.height >= 680) : null;
  check("the main window exists (CoreGraphics window list)", !!main, JSON.stringify(windows));
  if (main && label.startsWith("1")) {
    const shot = join(tmpdir(), "desktop-main-window.png");

    try {
      execFileSync("/usr/sbin/screencapture", ["-x", "-o", `-l${main.id}`, shot], { timeout: 10_000 });
      console.log(`  screenshot: ${existsSync(shot) ? shot : "not written (screen recording permission?)"}`);
    } catch (error) {
      console.log(`  screenshot: couldn't (${error.message.split("\n")[0]})`);
    }
  }

  for (let i = 0; i < 100 && !existsSync(selftestOut); i += 1) await delay(200);
  if (check("the in-page self-test ran", existsSync(selftestOut))) {
    const r = JSON.parse(readFileSync(selftestOut, "utf8"));
    const refused = (x, pattern) => x && x.ok === false && (!pattern || pattern.test(x.error));

    check("window.__GALLEY_DESKTOP__ is present, frozen, exactly 4 members", r.bridge?.present && r.bridge.frozen && r.bridge.keys.join() === "openExternal,pickFolder,revealInFinder,version", JSON.stringify(r.bridge));
    check("openExternal refuses javascript:", refused(r.openExternalJavascript, /web addresses/), r.openExternalJavascript?.error);
    check("openExternal refuses file:", refused(r.openExternalFile, /web addresses/), r.openExternalFile?.error);
    check("revealInFinder refuses a folder that isn't a site", refused(r.revealNotASite, /site’s own folder|site's own folder/), r.revealNotASite?.error);
    check("revealInFinder refuses a relative path", refused(r.revealRelative, /full folder path/), r.revealRelative?.error);
    check("the page can't call the start-up window's commands", refused(r.startupCommandFromApp, /not allowed/i), r.startupCommandFromApp?.error);
    check("the page can't call the dialog plugin", refused(r.dialogPluginFromApp, /not allowed/i), r.dialogPluginFromApp?.error);
    check("the page can't call the opener plugin", refused(r.openerPluginFromApp, /not allowed/i), r.openerPluginFromApp?.error);
    check("an iframe on another loopback port loads inside the app", r.frame?.loaded && r.frame?.message?.origin === new URL(frameUrl).origin, JSON.stringify(r.frame));
    const frameInvoke = r.frame?.message?.invoke;
    check(
      "that iframe gets no bridge and its command calls are refused by the ACL",
      r.frame?.message?.hasBridge === false && (frameInvoke === undefined || /refused: .*not allowed/i.test(frameInvoke)),
      `hasInternals: ${r.frame?.message?.hasInternals}, invoke: ${frameInvoke ?? "(no IPC in the frame)"}`
    );
  }

  const opened = await api("POST", "/api/sites/open", { path: site });
  const siteId = opened.body.id;
  const siteWindowOut = `${selftestOut}.site-${siteId}`;

  if (label.startsWith("1")) {
    // Finder hands a folder dropped on the Dock icon to the app; a second launch with the folder does the same here.
    const second = spawn(binary, [site], { env, stdio: "ignore" });
    const secondExit = await Promise.race([new Promise((resolve) => second.once("exit", (code, signal) => resolve(code ?? signal))), delay(20_000).then(() => "still running")]);
    check("a second launch hands the folder to the running app and ends", secondExit !== "still running", `exit ${secondExit}`);
  }
  let pair = [];
  for (let i = 0; i < 150; i += 1) {
    const list = windowsOf(app.pid);
    pair = Array.isArray(list) ? list.filter((w) => w.width >= 1024 && w.height >= 680) : [];
    if (pair.length >= 2) break;
    await delay(200);
  }
  check(
    label.startsWith("1") ? "two app windows: the main one and the site's own (window list)" : "the site's window was reopened at launch (remembered)",
    pair.length === 2,
    JSON.stringify(pair)
  );
  for (let i = 0; i < 150 && !existsSync(siteWindowOut); i += 1) await delay(200);
  if (check("the site's window ran the self-test", existsSync(siteWindowOut))) {
    const r = JSON.parse(readFileSync(siteWindowOut, "utf8"));
    const refused = (x, pattern) => x && x.ok === false && (!pattern || pattern.test(x.error));

    check("site window shows the site, on the app's own origin", new URL(r.page).origin === `http://127.0.0.1:${port}` && new URL(r.page).pathname === `/sites/${siteId}`, r.page);
    check("site window: the same bridge — present, frozen, exactly 4 members", r.bridge?.present && r.bridge.frozen && r.bridge.keys.join() === "openExternal,pickFolder,revealInFinder,version", JSON.stringify(r.bridge));
    check("site window: openExternal refuses javascript:", refused(r.openExternalJavascript, /web addresses/), r.openExternalJavascript?.error);
    check("site window: revealInFinder refuses a folder that isn't a site", refused(r.revealNotASite, /site’s own folder|site's own folder/), r.revealNotASite?.error);
    check("site window: can't call the start-up window's commands", refused(r.startupCommandFromApp, /not allowed/i), r.startupCommandFromApp?.error);
    check("site window: can't call the dialog plugin", refused(r.dialogPluginFromApp, /not allowed/i), r.dialogPluginFromApp?.error);
    check("site window: can't call the opener plugin", refused(r.openerPluginFromApp, /not allowed/i), r.openerPluginFromApp?.error);
    check("site window: a loopback iframe gets no bridge", r.frame?.message?.hasBridge === false, JSON.stringify(r.frame?.message ?? null));
  }
  await api("POST", `/api/sites/${siteId}/preview/start`);
  let preview = null;

  for (let i = 0; i < 240; i += 1) {
    preview = (await api("GET", `/api/sites/${siteId}/preview`)).body;
    if (preview.state === "ready" || preview.state === "error") break;
    await delay(500);
  }
  const proxyPort = preview?.url ? Number(new URL(preview.url).port) : 0;
  const devPort = Number((preview?.log ?? []).map((line) => /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)/.exec(line)).find(Boolean)?.[1] ?? 0);
  check("the site's preview runs (dev server behind the proxy)", preview?.state === "ready" && (await answers(proxyPort)), `proxy :${proxyPort}, dev server :${devPort}`);
  const tree = descendants(app.pid).filter((p) => !p.command.includes("/bin/ps"));
  console.log(`  processes under the app before stopping: ${tree.length}`);
  for (const p of tree) console.log(`    ${p.pid} (parent ${p.ppid}, group ${p.pgid}) ${p.command.slice(0, 110)}`);

  const stopStarted = Date.now();
  await stop(app);
  const appCode = await Promise.race([appExited, delay(20_000).then(() => "still running")]);
  check("the app process ended", appCode !== "still running", `${appCode} after ${Date.now() - stopStarted} ms`);
  // The kill -9 path depends on the server noticing on its own; give it time to finish closing.
  const deadline = Date.now() + 15_000;
  let left = [];
  let listening = [];

  do {
    await delay(250);
    left = tree.filter((p) => alive(p.pid));
    listening = [];
    for (const [name, p] of [["server", port], ["preview proxy", proxyPort], ["dev server", devPort]]) {
      if (p && ((await answers(p)) || (name === "dev server" && (await answers(p, "::1"))))) listening.push(`${name} :${p}`);
    }
  } while ((left.length || listening.length) && Date.now() < deadline);
  check("nothing is listening on the server, proxy or dev-server ports", listening.length === 0, listening.join(", ") || `checked :${port}, :${proxyPort}, :${devPort} after ${Date.now() - stopStarted} ms`);
  check("no process from the app's tree is left", left.length === 0, left.map((p) => `${p.pid} ${p.command.slice(0, 80)}`).join("; ") || `${tree.length} processes all gone`);
  for (const p of left) process.kill(p.pid, "SIGKILL");
  if (failures) console.log(`\n── app output (last lines)\n${log.split("\n").slice(-25).join("\n")}`);
}

try {
  await round("1. normal quit (SIGTERM → the app's quit path)", async (app) => app.kill("SIGTERM"));
  await round("2. kill -9 of the app", async (app) => app.kill("SIGKILL"));
} finally {
  frameServer.close();
  rmSync(tmp, { recursive: true, force: true });
  if (savedWindows) writeFileSync(windowsFile, savedWindows);
  else rmSync(windowsFile, { force: true });
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
