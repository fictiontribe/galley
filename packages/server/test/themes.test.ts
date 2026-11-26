/**
 * Themes over HTTP: saved for everyone in the data folder (checked on the way
 * in, stored adjusted), deleted, listed with the default, the default named
 * in settings (only a theme this install has), the default on /api/meta for
 * the sign-in screen, the start-up script, and the event open browsers follow.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createSettingsService } from "@galley/core/ai";
import { createEventBus } from "@galley/core/site";
import { QUIET } from "@galley/core/themes";
import { createThemeStore } from "@galley/core/themes/store";
import type { ServerEvent } from "@galley/core/types";
import { createApp } from "../src/app";
import { brandWarnings } from "../src/brand";
import { resolveConfig } from "../src/server";
import { appOptions, buildServices, json, TOKEN } from "./helpers";

const homes: string[] = [];
afterAll(() => homes.forEach((home) => rmSync(home, { recursive: true, force: true })));

function setup(overrides: Parameters<typeof appOptions>[0] = {}) {
  const home = mkdtempSync(join(tmpdir(), "galley-themes-"));
  homes.push(home);
  const events = createEventBus();
  const seen: ServerEvent[] = [];
  events.subscribe((event) => seen.push(event));
  const services = { ...buildServices({ events, settings: createSettingsService({ home, env: {} }) }), themes: createThemeStore({ home }) };
  const app = createApp(services, appOptions(overrides));
  const call = (method: string, path: string, body?: unknown) =>
    Promise.resolve(app.request(path, { method, headers: { authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { home, call, seen, app };
}

const FOG = { ...structuredClone(QUIET), id: "fog", name: "Fog", light: { ...QUIET.light, paper: "#CFCBC4", ink: "#6E6A64" } };

describe("themes saved for everyone", () => {
  it("are checked on the way in and stored adjusted, in the data folder", async () => {
    const { home, call, seen } = setup();
    const saved = await json(await call("PUT", "/api/themes/fog", { theme: FOG }));
    expect(saved.theme.light.paper).not.toBe("#CFCBC4");
    expect(saved.adjusted.map((a: { colour: string }) => a.colour)).toEqual(expect.arrayContaining(["paper", "ink"]));
    const onDisk = JSON.parse(readFileSync(join(home, "themes", "fog.json"), "utf8"));
    expect(onDisk.light).toEqual(saved.theme.light);
    expect(seen).toContainEqual({ type: "themes.updated" });
    const listed = await json(await call("GET", "/api/themes"));
    expect(listed.saved.map((t: { id: string }) => t.id)).toEqual(["fog"]);
    expect(listed.defaultId).toBe("quiet");
  });

  it("refuse what can't be a theme, in words, and save nothing", async () => {
    const { home, call } = setup();
    for (const theme of [{ ...FOG, switches: JSON.parse('{"constructor":"x"}') }, { ...FOG, switches: JSON.parse('{"__proto__":"x"}') }, { ...FOG, light: { ...FOG.light, pencil: "#777777" } }, { ...FOG, light: { ...FOG.light, paper: "url(x)" } }, { ...FOG, css: "body{}" }, "not a theme"]) {
      const response = await call("PUT", "/api/themes/fog", { theme });
      expect(response.status).toBe(400);
    }
    expect(existsSync(join(home, "themes", "fog.json"))).toBe(false);
    // A built-in's id can't be taken, and the address must name the theme.
    expect((await call("PUT", "/api/themes/quiet", { theme: { ...FOG, id: "quiet" } })).status).toBe(409);
    expect((await call("PUT", "/api/themes/other", { theme: FOG })).status).toBe(400);
    expect((await call("PUT", "/api/themes/fog", { theme: FOG, extra: 1 })).status).toBe(400);
  });

  it("are deleted, and a file edited by hand into something unreadable is left out", async () => {
    const { home, call } = setup();
    await call("PUT", "/api/themes/fog", { theme: FOG });
    mkdirSync(join(home, "themes"), { recursive: true });
    writeFileSync(join(home, "themes", "bad.json"), JSON.stringify({ ...FOG, id: "bad", light: { ...FOG.light, paper: "red; background:url(x)" } }));
    const listed = await json(await call("GET", "/api/themes"));
    expect(listed.saved.map((t: { id: string }) => t.id)).toEqual(["fog"]);
    expect(listed.skipped.map((skip: { file: string }) => skip.file)).toEqual(["bad.json"]);
    expect((await call("DELETE", "/api/themes/fog")).status).toBe(200);
    expect((await call("DELETE", "/api/themes/fog")).status).toBe(404);
    expect((await json(await call("GET", "/api/themes"))).saved).toEqual([]);
  });
});

describe("the install's default theme", () => {
  it("is named in settings, only as a theme this install has, and goes out on /api/meta and the start-up script", async () => {
    const webDir = mkdtempSync(join(tmpdir(), "galley-web-"));
    homes.push(webDir);
    writeFileSync(join(webDir, "index.html"), "<!doctype html><title></title>");
    writeFileSync(join(webDir, "theme.js"), "/* the start-up script */");
    const { call, seen, app } = setup({ webDir });
    expect((await call("PATCH", "/api/settings", { appearance: { look: "harbour" } })).status).toBe(400);
    expect((await call("PATCH", "/api/settings", { appearance: { look: "Plate;" } })).status).toBe(400);
    await call("PUT", "/api/themes/fog", { theme: FOG });
    const settings = await json(await call("PATCH", "/api/settings", { appearance: { look: "fog" } }));
    expect(settings.appearance.look).toBe("fog");
    expect(seen.filter((event) => event.type === "themes.updated")).toHaveLength(2);
    expect((await json(await call("GET", "/api/themes"))).defaultId).toBe("fog");
    // Anyone, signed in or not, gets the default's colours and switches, and no words.
    const meta = await json(await app.request("/api/meta"));
    expect(meta.authenticated).toBe(false);
    // Not its id (a slug of its name): a constant, with Fog's colours and switches.
    expect(meta.look.id).toBe("default");
    expect(meta.look.light.pencil).toBe(FOG.light.pencil);
    expect(meta.look.light.paper).not.toBe(QUIET.light.paper);
    expect(Object.keys(meta.look).sort()).toEqual(["dark", "id", "light", "switches", "tuned"]);
    expect((await json(await call("GET", "/api/meta"))).look.id).toBe("fog");
    const script = await (await app.request("/theme.js")).text();
    expect(script.startsWith("self.galleyStart={")).toBe(true);
    expect(script).toContain('"keeper":"server"');
    expect(script).toContain('"theme":"system"');
    expect(script).toContain('"id":"default"');
    expect(script).not.toContain("fog");
    expect(script.endsWith("/* the start-up script */")).toBe(true);
    // Changing appearance.theme is immediately reflected in /theme.js without stale caching.
    await call("PATCH", "/api/settings", { appearance: { theme: "dark" } });
    const darkScript = await (await app.request("/theme.js")).text();
    expect(darkScript).toContain('"theme":"dark"');
    // Deleting the default falls back to Quiet.
    await call("DELETE", "/api/themes/fog");
    expect((await json(await app.request("/api/meta"))).look.light.paper).toBe(QUIET.light.paper);
  });

  it("includes keeper:browser and the install's dynamic appearance theme in /theme.js on hosted installs", async () => {
    const webDir = mkdtempSync(join(tmpdir(), "galley-web-hosted-"));
    homes.push(webDir);
    writeFileSync(join(webDir, "theme.js"), "/* hosted boot */");
    const { call, app } = setup({ mode: "hosted", webDir });
    const initial = await (await app.request("/theme.js")).text();
    expect(initial).toContain('"keeper":"browser"');
    expect(initial).toContain('"theme":"system"');
    await call("PATCH", "/api/settings", { appearance: { theme: "light" } });
    const updated = await (await app.request("/theme.js")).text();
    expect(updated).toContain('"keeper":"browser"');
    expect(updated).toContain('"theme":"light"');
  });

  it("starts as a white-label brand's theme, with the brand's accent as the built-ins' pencil", async () => {
    const { app } = setup({ brand: { productName: "Acme Editor", byline: "", accent: "#0F766E", theme: "desk" } });
    const meta = await json(await app.request("/api/meta"));
    expect(meta.look.id).toBe("default");
    expect(meta.look.light.pencil).toBe("#0F766E");
    expect(meta.look.dark.pencil).toBe("#0F766E");
    expect(meta.look.switches.sidebar).toBe("desk");
  });
});

describe("a visitor who isn't signed in", () => {
  it("costs one read of one field, once, until something changes", async () => {
    const home = mkdtempSync(join(tmpdir(), "galley-themes-"));
    homes.push(home);
    const settings = createSettingsService({ home, env: {} });
    let gets = 0;
    let looks = 0;
    const counted = { ...settings, get: (...args: Parameters<typeof settings.get>) => (gets++, settings.get(...args)), look: () => (looks++, settings.look!()) };
    const events = createEventBus();
    const app = createApp({ ...buildServices({ events, settings: counted }), themes: createThemeStore({ home }) }, appOptions());
    for (let i = 0; i < 5; i++) await app.request("/api/meta");
    expect(gets).toBe(0);
    expect(looks).toBe(1);
    events.emit({ type: "themes.updated" });
    await app.request("/api/meta");
    expect(looks).toBe(2);
  });
});

describe("a white-label accent that can't be a pencil", () => {
  for (const accent of ["#1F2937", "#333333", "#000000", "#000"]) {
    it(`${accent}: the built-ins keep their own pencil, still apply, and start-up says why`, async () => {
      const { app } = setup({ brand: { productName: "Acme Editor", byline: "", accent } });
      const meta = await json(await app.request("/api/meta"));
      expect(meta.look).toBeTruthy();
      expect(meta.look.light.pencil).toBe("#2E2BFF");
      expect(brandWarnings({ productName: "Acme", byline: "", accent })[0]).toMatch(/can't be the editing app's pencil: it is too close to grey/);
      expect(resolveConfig({ env: { GALLEY_BRAND_ACCENT: accent } }).warnings.join(" ")).toMatch(/too close to grey/);
    });
  }

  it("an accent with color is still the pencil, and says nothing", () => {
    expect(brandWarnings({ productName: "Acme", byline: "", accent: "#0F766E" })).toEqual([]);
  });
});
