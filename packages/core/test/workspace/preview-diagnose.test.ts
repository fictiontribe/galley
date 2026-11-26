import { afterEach, describe, expect, it } from "vitest";
import { createPreviewController, type PreviewControllerHandle } from "../../src/workspace/index";
import { diagnosePreviewFailure } from "../../src/workspace/preview/diagnose";
import { cleanupAll, tempDir, until, writeTree } from "./helpers";

const controllers: PreviewControllerHandle[] = [];

afterEach(async () => {
  while (controllers.length) await controllers.pop()?.stop();
  cleanupAll();
});

describe("diagnosePreviewFailure", () => {
  it("explains Vite packageEntryFailure / Failed to resolve entry for package", () => {
    const diagnosis = diagnosePreviewFailure([
      "\u001b[31merror when starting dev server:\u001b[0m",
      'Error: Failed to resolve entry for package "gsap". The package may have incorrect main/module/exports specified in its package.json.',
      "    at packageEntryFailure (file:///node_modules/vite/dist/node/chunks/dep.js:1:1)",
    ]);

    expect(diagnosis).toMatch(/“gsap”/);
    expect(diagnosis).toMatch(/entry files are missing/i);
    expect(diagnosis).toMatch(/\.gitignore/);
  });

  it("explains bare packageEntryFailure without package name", () => {
    const diagnosis = diagnosePreviewFailure(["Error: packageEntryFailure while resolving dependency"]);

    expect(diagnosis).toMatch(/entry files/i);
    expect(diagnosis).toMatch(/\.gitignore/);
  });

  it("explains ERR_MODULE_NOT_FOUND / Cannot find package / Cannot find module", () => {
    const pkg = diagnosePreviewFailure([
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@astrojs/mdx' imported from /site/astro.config.mjs",
    ]);
    expect(pkg).toMatch(/“@astrojs\/mdx”/);
    expect(pkg).toMatch(/package\.json/);

    const mod = diagnosePreviewFailure(["Error: Cannot find module 'sharp'"]);
    expect(mod).toMatch(/“sharp”/);

    const rel = diagnosePreviewFailure(["Error [ERR_MODULE_NOT_FOUND]: Cannot find module './components/Missing.astro'"]);
    expect(rel).toMatch(/“\.\/components\/Missing\.astro”/);
    expect(rel).toMatch(/import path/i);
  });

  it("explains missing environment variable errors", () => {
    const explicit = diagnosePreviewFailure(["Error: Missing environment variable PUBLIC_SANITY_PROJECT_ID"]);
    expect(explicit).toContain("PUBLIC_SANITY_PROJECT_ID");
    expect(explicit).toMatch(/\.env/);

    const importMeta = diagnosePreviewFailure(["TypeError: import.meta.env.SITE_URL is not defined"]);
    expect(importMeta).toContain("SITE_URL");

    const refErr = diagnosePreviewFailure(["ReferenceError: CMS_API_TOKEN is not defined at astro.config.mjs:4"]);
    expect(refErr).toContain("CMS_API_TOKEN");
  });

  it("explains Astro content schema and Astro/Vite config syntax errors", () => {
    const schema = diagnosePreviewFailure([
      "InvalidContentEntryDataError: blog → hello-world data does not match collection schema.",
      "  at src/content/blog/hello-world.md",
    ]);
    expect(schema).toMatch(/content collection schema/i);
    expect(schema).toContain("src/content/blog/hello-world.md");

    const collectionCfg = diagnosePreviewFailure(["ContentCollectionConfigError: Failed to parse src/content.config.ts"]);
    expect(collectionCfg).toMatch(/content collection schema/i);

    const astroCfg = diagnosePreviewFailure([
      "failed to load config from /app/astro.config.mjs",
      "SyntaxError: Unexpected token '}' in astro.config.mjs",
    ]);
    expect(astroCfg).toContain("astro.config.mjs");
    expect(astroCfg).toMatch(/syntax or configuration error/i);

    const viteCfg = diagnosePreviewFailure(["Error: SyntaxError while loading vite.config.ts"]);
    expect(viteCfg).toContain("vite.config.ts");
  });

  it("explains EADDRINUSE port conflicts", () => {
    const withPort = diagnosePreviewFailure(["Error: listen EADDRINUSE: address already in use 127.0.0.1:4321"]);
    expect(withPort).toContain("Port 4321");
    expect(withPort).toMatch(/already in use/i);

    const withoutPort = diagnosePreviewFailure(["Error: listen EADDRINUSE"]);
    expect(withoutPort).toMatch(/port is already in use/i);
  });

  it("explains ENOMEM / JavaScript heap out of memory / SIGKILL", () => {
    expect(diagnosePreviewFailure(["FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory"])).toMatch(/ran out of memory/i);
    expect(diagnosePreviewFailure(["Error: spawn ENOMEM"])).toMatch(/ran out of memory/i);
    expect(diagnosePreviewFailure([], { signal: "SIGKILL", phase: "running" })).toMatch(/ran out of memory/i);
    expect(diagnosePreviewFailure([], { exitCode: 137, phase: "start" })).toMatch(/ran out of memory/i);
  });

  it("explains pnpm and npm install errors", () => {
    expect(diagnosePreviewFailure(["ERR_PNPM_OUTDATED_LOCKFILE Cannot install with \"frozen-lockfile\""], { phase: "install" })).toMatch(/lockfile is out of date/i);
    expect(diagnosePreviewFailure(["npm error code E401", "npm error 401 Unauthorized"], { phase: "install" })).toMatch(/authentication or permission/i);
    expect(diagnosePreviewFailure(["ERR_PNPM_FETCH_403 Forbidden"], { phase: "install" })).toMatch(/authentication or permission/i);
    expect(diagnosePreviewFailure(["npm error code E404", "npm error 404 Not Found - GET https://registry.npmjs.org/nope"], { phase: "install" })).toMatch(/404/);
    expect(diagnosePreviewFailure(["npm error request failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org"], { phase: "install" })).toMatch(/ENOTFOUND/);
    expect(diagnosePreviewFailure(["ERR_PNPM_META_FETCH_FAIL getaddrinfo EAI_AGAIN registry.npmjs.org"], { phase: "install" })).toMatch(/EAI_AGAIN/);
  });

  it("returns null for unrecognized logs so the controller keeps its generic fallback", () => {
    expect(diagnosePreviewFailure(["boom: missing module"])).toBeNull();
    expect(diagnosePreviewFailure(["SyntaxError: the site is broken"])).toBeNull();
    expect(diagnosePreviewFailure([])).toBeNull();
  });
});

describe("preview controller plain-English diagnostics", () => {
  it("surfaces plain-English diagnosis in status.detail on early exit while keeping raw log in status.log", async () => {
    const root = tempDir("preview-diag-");

    writeTree(root, {
      "fail.mjs": `console.error('Error: Failed to resolve entry for package "gsap".');\nprocess.exit(1);\n`,
    });
    const controller = createPreviewController({
      root,
      settings: () => ({ dev: { command: "node fail.mjs", port: null }, packageManager: null, installed: true, urls: {} }),
      overlayScript: () => "",
    });

    controllers.push(controller);
    const status = await controller.start();

    expect(status.state).toBe("error");
    expect(status.detail).toMatch(/“gsap”/);
    expect(status.detail).toMatch(/\.gitignore/);
    expect(status.log.join("\n")).toContain('Failed to resolve entry for package "gsap"');
  });

  it("surfaces plain-English diagnosis when a ready dev server crashes out of memory", async () => {
    const root = tempDir("preview-diag-crash-");

    writeTree(root, {
      "crash-later.mjs": `
import http from "node:http";
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><head></head><body>ok</body></html>");
});
server.listen(0, "127.0.0.1", () => {
  console.log("Local: http://localhost:" + server.address().port + "/");
  setTimeout(() => {
    console.error("FATAL ERROR: JavaScript heap out of memory");
    process.exit(134);
  }, 600);
});
`,
    });
    const controller = createPreviewController({
      root,
      settings: () => ({ dev: { command: "node crash-later.mjs", port: null }, packageManager: null, installed: true, urls: {} }),
      overlayScript: () => "",
    });

    controllers.push(controller);
    const ready = await controller.start();

    expect(ready.state).toBe("ready");
    await until(() => controller.status().state === "error", 5000);
    expect(controller.status().detail).toMatch(/ran out of memory/i);
    expect(controller.status().log.join("\n")).toContain("JavaScript heap out of memory");
  });
});
