/**
 * The redirects list (and the host files written from it) is not page
 * content, and its addresses are not links: an old address is supposed to
 * match no page. Neither Proof's checks nor the Search & AI audit may report
 * it, and no fix may ever rewrite it — on the starter, through the real
 * SiteService and the real redirects service, the way a person adds them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRedirectsService, type RedirectsService } from "../../src/redirects/index";
import { auditSite, forgetAudit } from "../../src/seo/audit";
import { applyFixes, fixRefusal } from "../../src/seo/fixes";
import { createEventBus } from "../../src/site/index";
import type { EventBus, Settings } from "../../src/types";
import { disposeAll, makeSite, openSite, sh, tempDir } from "../site/helpers";

const LIST = "src/data/redirects.json";
const HOST_FILE = "public/_redirects";
const PASTE = ["/old-about/ /about/", "/2019/05/coat-notes/ /blog/ 302", "/news/* /blog/:splat", "/gone/ /no-such-page/"].join("\n");
const services: RedirectsService[] = [];

afterEach(async () => {
  while (services.length) services.pop()!.dispose();
  await disposeAll();
});

async function rig() {
  const root = makeSite();
  const bus: EventBus = createEventBus();
  const { site } = await openSite(root, { events: bus });
  const redirects = createRedirectsService({
    home: tempDir("redirects-home-"),
    events: bus,
    registry: { get: async (id) => (id === site.id ? site : null) },
    settings: { readSecret: async () => null, get: async () => ({ author: { name: "Test Editor", email: "editor@example.com" } }) as Settings },
  });

  services.push(redirects);
  await redirects.configure(site, { host: "cloudflare" });
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "Host chosen");
  await redirects.confirm(site, { text: PASTE });
  // A real broken link in a page, to an address the list moved.
  const about = join(root, "src/content/pages/about.md");

  writeFileSync(about, `${readFileSync(about, "utf8").trimEnd()}\n\nRead [the old about page](/old-about/) or [a page that never was](/never-was/).\n`);
  forgetAudit(site.root);
  return { root, site, read: (path: string) => readFileSync(join(root, path), "utf8") };
}

describe("the redirects list is not links", () => {
  it("gives Proof no things to check for the redirects, and still reports a real broken link", async () => {
    const { site } = await rig();
    // The pending changes (what Proof checks), plus the page edited behind the app's back just now.
    const issues = [...(await site.validate()), ...(await site.validate(["src/content/pages/about.md"]))].filter((issue) => issue.code === "broken-link");

    expect(issues.filter((issue) => issue.path === LIST || issue.path === HOST_FILE)).toEqual([]);
    expect(issues.map((issue) => issue.path)).toContain("src/content/pages/about.md");
  });

  it("gives Search & AI no link findings for the redirects, and fixes the page's own link from the list", async () => {
    const { site } = await rig();
    const audit = await auditSite(site);

    expect(audit.findings.filter((finding) => finding.path === LIST || finding.path === HOST_FILE)).toEqual([]);
    const broken = audit.findings.filter((finding) => finding.code === "link-broken");

    expect(broken.map((finding) => `${finding.path} ${finding.evidence.value}`).sort()).toEqual(["src/content/pages/about.md /never-was/", "src/content/pages/about.md /old-about/"]);
    // The list itself says where /old-about/ went, even before the host's file is read.
    expect(broken.find((finding) => finding.evidence.value === "/old-about/")?.fix).toMatchObject({ label: "Point it at the new address", after: "/about/" });
  });

  it("“Fix all” leaves the redirects list and the host's file byte for byte", async () => {
    const { site, read } = await rig();
    const before = { list: read(LIST), host: read(HOST_FILE) };
    const audit = await auditSite(site);
    const result = await applyFixes(
      site,
      audit.findings.filter((finding) => finding.fix).map((finding) => finding.id)
    );

    expect(result.applied.length).toBeGreaterThan(0);
    expect(read(LIST)).toBe(before.list);
    expect(read(HOST_FILE)).toBe(before.host);
    expect(read("src/content/pages/about.md")).toContain("[the old about page](/about/)");
  });

  it("refuses any fix that would edit the redirects list or the host's file", async () => {
    const { site } = await rig();
    const model = await site.model();
    const edit = (path: string) => ({ label: "Point it at the new address", edits: [{ path, ops: [{ op: "set" as const, path: ["redirects", 1, "from"], value: "/blog/" }], summary: "Point the link at /blog/" }] });

    expect(fixRefusal(model, edit(LIST))).toMatch(/Redirects/);
    expect(fixRefusal(model, edit(HOST_FILE))).toMatch(/Redirects/);
    expect(fixRefusal(model, edit("vercel.json"))).toMatch(/Redirects/);
    expect(fixRefusal(model, edit("src/content/pages/about.md"))).toBeNull();
  });
});
