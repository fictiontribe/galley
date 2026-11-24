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
    expect(meta.look.id).toBe("fog");
    expect(Object.keys(meta.look).sort()).toEqual(["dark", "id", "light", "switches", "tuned"]);
    const script = await (await app.request("/theme.js")).text();
    expect(script.startsWith("self.galleyStart={")).toBe(true);
    expect(script).toContain('"keeper":"server"');
    expect(script).toContain('"id":"fog"');
    expect(script.endsWith("/* the start-up script */")).toBe(true);
    // Deleting the default falls back to Quiet.
    await call("DELETE", "/api/themes/fog");
    expect((await json(await app.request("/api/meta"))).look.id).toBe("quiet");
  });

  it("starts as a white-label brand's theme, with the brand's accent as the built-ins' pencil", async () => {
    const { app } = setup({ brand: { productName: "Acme Editor", byline: "", accent: "#0F766E", theme: "desk" } });
    const meta = await json(await app.request("/api/meta"));
    expect(meta.look.id).toBe("desk");
    expect(meta.look.light.pencil).toBe("#0F766E");
    expect(meta.look.dark.pencil).toBe("#0F766E");
    expect(meta.look.switches.sidebar).toBe("desk");
  });
});
