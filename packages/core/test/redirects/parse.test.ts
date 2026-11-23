/**
 * Reading every format people actually have. Each input in inputs/ has a
 * golden file of what was understood (golden/parse/*.json, checked by eye
 * when written); the assertions below pin the behaviour that matters most:
 * the detected format, nothing guessed, every rejected line with its number
 * and a reason.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRedirects } from "../../src/redirects/index";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const input = (name: string) => readFileSync(here(`./inputs/${name}`), "utf8");
const ctx = { siteHosts: ["lowfield.example"], trailingSlash: "always" as const };

function parse(name: string, filename?: string) {
  return parseRedirects(input(name), { ...ctx, ...(filename ? { filename } : {}) });
}

function summary(name: string, filename?: string) {
  const result = parse(name, filename);

  return {
    format: result.format,
    redirects: result.redirects.map(({ line, from, to, status, statusMissing, notes, note }) => ({ line, from, to, status, ...(statusMissing ? { statusMissing } : {}), ...(note ? { note } : {}), ...(notes.length ? { notes } : {}) })),
    rejected: result.rejected.map(({ line, kind, reason }) => ({ line, kind, reason })),
    ignored: result.ignored,
    unknownHosts: result.unknownHosts,
  };
}

describe("golden files: every input format", () => {
  for (const [name, filename] of [
    ["columns.csv"],
    ["columns.tsv"],
    ["mixed.txt"],
    ["_redirects", "_redirects"],
    [".htaccess", ".htaccess"],
    ["nginx.conf", "nginx.conf"],
    ["cloudflare.csv", "cloudflare.csv"],
    ["ours.json"],
    ["vercel.json"],
    ["wordpress-report.json"],
    ["redirects.mjs"],
  ] as Array<[string, string?]>) {
    it(name, async () => {
      await expect(`${JSON.stringify(summary(name, filename), null, 2)}\n`).toMatchFileSnapshot(here(`./golden/parse/${name.replace(/^[._]/, "")}.json`));
    });
  }
});

describe("detection", () => {
  it("names the format most lines are in", () => {
    expect(parse("columns.csv").format).toBe("columns");
    expect(parse("_redirects").format).toBe("redirects-file");
    expect(parse(".htaccess").format).toBe("apache");
    expect(parse("nginx.conf").format).toBe("nginx");
    expect(parse("cloudflare.csv").format).toBe("cloudflare-csv");
    expect(parse("ours.json").format).toBe("json");
    expect(parse("vercel.json").format).toBe("vercel-json");
    expect(parse("wordpress-report.json").format).toBe("wordpress");
    expect(parse("redirects.mjs").format).toBe("wordpress");
  });

  it("reads a paste that mixes separators line by line", () => {
    const result = parse("mixed.txt");

    expect(result.redirects.map((redirect) => [redirect.from, redirect.to])).toEqual([
      ["/semi/", "/about/"],
      ["/space/", "/contact/"],
      ["/comma/", "/pricing/"],
      ["/full/", "/blog/"],
    ]);
    expect(result.rejected.map((line) => line.line)).toEqual([5, 6]);
  });
});

describe("never guesses", () => {
  it("skips a header row and keeps quoted commas", () => {
    const result = parse("columns.csv");

    expect(result.ignored).toBe(1);
    expect(result.redirects.find((redirect) => redirect.line === 4)?.from).toBe("/with,comma/");
  });

  it("strips this site's own address, rejects another domain's with its line", () => {
    const result = parseRedirects("https://www.lowfield.example/a/ /b/\nhttps://elsewhere.example/c/ /d/\nhttps://elsewhere.example/e/ /f/", ctx);

    expect(result.redirects).toHaveLength(1);
    expect(result.redirects[0]!.notes).toContain("Removed the site's own address from the start.");
    expect(result.rejected.map((line) => [line.line, line.kind])).toEqual([
      [2, "other-domain"],
      [3, "other-domain"],
    ]);
    expect(result.unknownHosts).toEqual([{ host: "elsewhere.example", count: 2 }]);
  });

  it("marks a missing status instead of choosing one", () => {
    const result = parse("columns.csv");

    expect(result.redirects.find((redirect) => redirect.from === "/no-status/")?.statusMissing).toBe(true);
  });

  it("refuses words that aren't addresses", () => {
    const result = parseRedirects("hello world\nfoo bar baz", ctx);

    expect(result.redirects).toHaveLength(0);
    expect(result.rejected.map((line) => line.kind)).toEqual(["malformed", "malformed"]);
  });

  it("sends clever rules to a person, with the line number", () => {
    const apache = parse(".htaccess", ".htaccess");
    const lines = Object.fromEntries(apache.rejected.map((line) => [line.line, line.kind]));

    expect(lines[9]).toBe("needs-person"); // RedirectMatch rearranging groups
    expect(lines[12]).toBe("needs-person"); // RewriteRule without R
    expect(lines[13]).toBe("needs-person"); // RewriteCond
    expect(lines[14]).toBe("needs-person"); // the rule under the condition
    expect(lines[15]).toBe("needs-person"); // gone
    const redirects = _redirectsOnly();

    expect(redirects.rejected.map((line) => line.line)).toEqual(expect.arrayContaining([10, 13, 15, 16]));
  });

  it("drops fragments from old addresses with a note, keeps them on new ones", () => {
    const result = parseRedirects("/a/#top /b/#middle 301", ctx);

    expect(result.redirects[0]).toMatchObject({ from: "/a/", to: "/b/#middle" });
    expect(result.redirects[0]!.notes.join(" ")).toMatch(/browsers never send it/);
  });

  it("keeps an old address's own trailing slash, gives a new one the site's", () => {
    const result = parseRedirects("/old-page /about 301", ctx);

    expect(result.redirects[0]).toMatchObject({ from: "/old-page", to: "/about/" });
  });

  it("decodes percent-encoding into plain letters", () => {
    const result = parseRedirects("/caf%C3%A9/ /about/ 301", ctx);

    expect(result.redirects[0]!.from).toBe("/café/");
  });

  it("keeps a query string on the old address (the checks flag it per host)", () => {
    expect(parseRedirects("/?p=123 /blog/ 301", ctx).redirects[0]!.from).toBe("/?p=123");
  });

  it("refuses a wildcard that isn't a whole folder", () => {
    expect(parseRedirects("/blog* /x/ 301", ctx).rejected[0]!.kind).toBe("needs-person");
    expect(parseRedirects("/a/*/b /x/ 301", ctx).rejected[0]!.kind).toBe("needs-person");
  });
});

function _redirectsOnly() {
  return parse("_redirects", "_redirects");
}
