/**
 * "Go to X › Y" sentences must name places that exist. The app has two
 * settings screens, so a bare "Settings › …" is always ambiguous or wrong
 * ("Settings › Site configuration" sent people nowhere); and each named
 * section of them must be one the screens really have.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packages = fileURLToPath(new URL("../../", import.meta.url));
const roots = ["web/src", "web/mock", "core/src", "server/src"].map((dir) => join(packages, dir));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// Comments name examples ("Site settings › Tagline" is a data file's field in a sample label), so only code is read.
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sources = roots.flatMap(files).map((path) => ({ path, text: code(readFileSync(path, "utf8")) }));
const sectionsOf = (path: string, pattern: RegExp) => new Set([...readFileSync(join(packages, path), "utf8").matchAll(pattern)].map((match) => match[1]!));

describe("pointers to places in the app", () => {
  it("never say a bare “Settings › …”", () => {
    const bare = sources.flatMap(({ path, text }) => [...text.matchAll(/(?<!App |Site |Account |account )Settings › [A-Z][a-z]+/g)].map((match) => `${path.slice(packages.length)}: ${match[0]}`));
    expect(bare).toEqual([]);
  });

  it("name only sections the settings screens have", () => {
    const app = sectionsOf("web/src/screens/settings/AppSettingsScreen.tsx", /\{ id: "[a-z]+", label: "([^"]+)" \}/g);
    const site = new Set([...sectionsOf("web/src/screens/site-settings/SiteSettingsScreen.tsx", /<Group (?:id="[a-z-]+" )?title="([^"]+)"/g), "Connections"]);
    const named = sources.flatMap(({ text }) => [...text.matchAll(/(App|Site) settings › ([A-Z][A-Za-z ]*?[a-z])(?=[^A-Za-z ]|$| [a-z(“])/g)].map((match) => [match[1]!, match[2]!] as const));
    expect(named.length).toBeGreaterThan(5);
    for (const [where, section] of named) expect(where === "App" ? app : site, `${where} settings › ${section}`).toContain(section);
  });
});
