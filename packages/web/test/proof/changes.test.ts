import { describe, expect, it } from "vitest";
import type { Collection, FileChange, PublishResult } from "@galley/core/types";
import { bodyOf, changeBadge, changeHeading, describeValue, valueWords, sectionLabels, discardCopy, firstChangedText, groupChanges, labelParts, movedText, orderedPaths, pendingSummary, splitBody, titleOf, visibleOf, withPublishedBody } from "../../src/features/proof/changes";
import { publishOutcome, sendOutcome } from "../../src/features/proof/publishOutcome";

const change = (patch: Partial<FileChange> & Pick<FileChange, "path" | "kind">): FileChange => ({ status: "modified", binary: false, additions: 1, deletions: 1, summary: "", ...patch });

describe("grouping changes", () => {
  const files = [
    change({ path: "src/styles/tokens.css", kind: "code" }),
    change({ path: "public/images/hero.webp", kind: "media", binary: true, status: "added" }),
    change({ path: "src/content/pages/index.md", kind: "content", title: "Home" }),
    change({ path: "galley.config.json", kind: "config" }),
    change({ path: "src/content/pages/about.md", kind: "content", title: "About" }),
  ];

  it("groups content, media, then code & settings, titles A–Z", () => {
    const groups = groupChanges(files);
    expect(groups.map((group) => group.label)).toEqual(["Content", "Media", "Code & settings"]);
    expect(groups[0]?.files.map((file) => titleOf(file))).toEqual(["About", "Home page"]);
    expect(orderedPaths(groups)).toEqual(["src/content/pages/about.md", "src/content/pages/index.md", "public/images/hero.webp", "galley.config.json", "src/styles/tokens.css"]);
  });

  it("counts site-wide settings as settings, named by their collection", () => {
    const collections = [{ id: "site", label: "Site settings", kind: "data" } as Collection];
    const settings = change({ path: "src/data/site.json", kind: "content", collection: "site", title: "Harbour Dental" });
    expect(groupChanges([settings], collections).map((group) => group.id)).toEqual(["code"]);
    expect(titleOf(settings, collections)).toBe("Site settings");
    expect(titleOf(change({ path: "src/content/pages/about.md", kind: "content", title: "About the studio — Harbour" }))).toBe("About the studio");
  });

  it("leaves out empty groups", () => {
    expect(groupChanges([files[2] as FileChange]).map((group) => group.id)).toEqual(["content"]);
    expect(groupChanges([])).toEqual([]);
  });

  it("names files by what people know them as", () => {
    expect(titleOf(change({ path: "src/content/blog/living-through-a-renovation.md", kind: "content" }))).toBe("Living through a renovation");
    expect(titleOf(change({ path: "public/images/a b.png", kind: "media" }))).toBe("a b.png");
  });
});

describe("values in words", () => {
  it("describes scalars, lists and sections plainly", () => {
    expect(describeValue("Hello")).toBe("Hello");
    expect(describeValue(true)).toBe("Yes");
    expect(describeValue(null)).toBe("Empty");
    expect(describeValue(["a", "b"])).toBe("a, b");
    expect(describeValue([{ a: 1 }, { a: 2 }])).toBe("2 items");
    expect(describeValue({ type: "hero", heading: "Make more of the home you already have." })).toBe("Hero · “Make more of the home you already have.”");
    expect(describeValue({ type: "rich-text" })).toBe("Rich text");
  });

  it("names an added script by its name and never shows a bare position or a count as inserted text", () => {
    // What the Scripts screen's "Add a script" writes for Google Analytics 4.
    const script = { id: "ga4", kind: "ga4", enabled: true, settings: { measurementId: "G-ABC123XYZ" }, placement: "head", load: "eager", consent: "analytics" };
    const added = { field: ["scripts", 1], label: "Scripts › 2", kind: "added" as const, after: script };

    expect(describeValue(script)).toBe("Google Analytics 4");
    expect(changeHeading(added)).toEqual({ lead: "Scripts", rest: "Google Analytics 4", badge: "Added" });
    expect(changeHeading({ field: ["scripts", 0], label: "Scripts › 1", kind: "removed", before: { ...script, label: "Shop analytics" } })).toEqual({ lead: "Scripts", rest: "Shop analytics", badge: "Removed" });
    // A section keeps its type and place.
    expect(changeHeading({ field: ["sections", 4], label: "Sections › 5 (FAQ)", kind: "added", after: { type: "faq" } })).toMatchObject({ badge: "Added at 5" });
    expect(valueWords({ a: 1, b: 2 })).toEqual({ text: "2 details", summary: true });
    expect(valueWords([{ a: 1 }])).toEqual({ text: "1 item", summary: true });
    expect(valueWords(script).summary).toBe(false);
  });

  it("names a section by its type's label on the site, so a new FAQ reads “FAQ”, not “Faq”", () => {
    const collections = [
      {
        id: "pages",
        fields: [{ key: "sections", label: "Sections", type: "blocks", required: false, source: "config", blocks: [{ type: "faq", label: "FAQ", fields: [], count: 1 }, { type: "hero", label: "Hero", fields: [], count: 3 }] }],
      },
    ] as unknown as Collection[];
    const labels = sectionLabels(collections);

    expect(labels.get("faq")).toBe("FAQ");
    expect(describeValue({ type: "faq", heading: "Questions" }, labels)).toBe("FAQ · “Questions”");
    expect(describeValue({ type: "faq" }, labels)).toBe("FAQ");
    expect(describeValue({ type: "logo-row" }, labels)).toBe("Logo row");
  });

  it("splits a label so its section part can be emphasised", () => {
    expect(labelParts("Hero › Heading")).toEqual({ lead: "Hero", rest: "Heading" });
    expect(labelParts("Title")).toEqual({ lead: "", rest: "Title" });
  });

  it("names a whole section by its name, and says where it went", () => {
    const moved = { field: ["sections", 2], label: "Sections › 3 (Logo row)", kind: "moved" as const, from: 1, to: 2 };
    expect(labelParts(moved.label)).toEqual({ lead: "", rest: "Logo row" });
    expect(changeBadge(moved)).toBe("Moved");
    expect(movedText(moved)).toBe("Moved from 2 to 3");
    expect(movedText({ ...moved, from: 2 })).toBe("Changed order, still at 3");
    expect(labelParts("Sections › 4 (Metrics) › Tone")).toEqual({ lead: "Metrics", rest: "Tone" });
    expect(changeBadge({ field: ["sections", 3, "tone"], label: "Sections › 4 (Metrics) › Tone", kind: "changed" })).toBeNull();
    expect(changeBadge({ field: ["sections", 4], label: "Sections › 5 (FAQ)", kind: "added" })).toBe("Added at 5");
    expect(changeBadge({ field: ["sections", 5], label: "Sections › 6 (Call to action)", kind: "removed" })).toBe("Removed from 6");
    expect(changeBadge({ field: ["sections", 0, "eyebrow"], label: "Sections › 1 (Hero) › Eyebrow", kind: "added" })).toBe("Added");
  });

  it("finds the changed text as the page shows it", () => {
    expect(visibleOf("Make more of the *house you already love*.")).toBe("Make more of the house you already love.");
    expect(visibleOf("Read [the guide](/guide/) **first**")).toBe("Read the guide first");
    const fileChange = change({ path: "a.md", kind: "content", fieldChanges: [{ field: ["x"], label: "X", kind: "removed", before: "Gone" }, { field: ["h"], label: "Hero › Heading", kind: "changed", before: "Old", after: "New *one*" }] });
    expect(firstChangedText(fileChange)).toBe("New one");
    expect(firstChangedText(change({ path: "a.md", kind: "content" }))).toBeNull();
  });

  it("takes the body from below the front matter", () => {
    expect(bodyOf("---\ntitle: A\n---\n\nFirst paragraph.\n")).toBe("First paragraph.\n");
    expect(bodyOf("No front matter.")).toBe("No front matter.");
    expect(bodyOf(null)).toBe("");
  });
});

describe("discard wording", () => {
  it("puts deleted files back, and says what goes and stays", () => {
    expect(discardCopy(change({ path: "a.md", kind: "content", title: "Old team page", status: "deleted" }))).toMatchObject({ title: "Put back Old team page?", confirmLabel: "Put back" });
    expect(discardCopy(change({ path: "a.md", kind: "content", title: "Home" })).body).toBe("This removes your unpublished edits to Home. What’s already published stays as it is.");
    expect(discardCopy(change({ path: "a.md", kind: "content", title: "New post", status: "added" })).title).toBe("Discard New post?");
  });
});

describe("publish outcomes", () => {
  const base: PublishResult = { ok: true, commit: "abc", branch: "main", files: ["a.md", "b.md", "c.png"], pushed: true };
  const commit = { message: "Update the home page", mode: "commit" as const };

  it("published and sent", () => {
    expect(publishOutcome(base, commit)).toMatchObject({ kind: "published", title: "Published", body: "3 changes are live. The site usually updates within a minute." });
  });

  it("published on this computer but not sent", () => {
    const outcome = publishOutcome({ ...base, pushed: false, pushError: "The site’s host didn’t accept the changes." }, commit);
    expect(outcome).toMatchObject({ kind: "not-sent", title: "Saved, not live yet", tone: "warning", canRetry: false });
    expect(outcome.body).toContain("didn’t reach the site’s host");
    expect(outcome.body).toContain("The site’s host didn’t accept the changes.");
  });

  it("paused because the live site is newer: offers to get the latest, no dead end", () => {
    const outcome = publishOutcome({ ok: false, files: ["a.md"], pushed: false, behind: true, error: "The live site has newer changes than this copy, so publishing is paused and nothing was overwritten. Your edits are safe. Get the latest versions, then publish again." }, commit);
    expect(outcome).toMatchObject({ kind: "behind", tone: "warning", title: "The live site has newer changes", canGetLatest: true, canRetry: false });
    expect(outcome.body).toContain("Get the latest versions, then publish again.");
  });

  it("a site with no host keeps versions here, and says so", () => {
    expect(publishOutcome({ ...base, pushed: false }, commit)).toMatchObject({ kind: "saved-local", tone: "success" });
  });

  it("review requested, with its link", () => {
    expect(publishOutcome({ ...base, pullRequestUrl: "https://example.com/pr/1" }, { message: "Update hero", mode: "pull-request" })).toMatchObject({
      kind: "review",
      title: "Sent for review",
      body: "A developer can approve “Update hero” before it goes live.",
      reviewUrl: "https://example.com/pr/1",
    });
    expect(publishOutcome({ ...base, pushed: false, pushError: "Couldn’t reach GitHub." }, { message: "x", mode: "pull-request" })).toMatchObject({ kind: "review-not-sent", canRetry: true });
  });

  it("nothing to publish, and failure with the reason", () => {
    expect(publishOutcome({ ok: false, files: [], pushed: false, error: "There's nothing to publish." }, commit)).toMatchObject({ kind: "nothing", title: "Nothing to publish" });
    const failed = publishOutcome({ ok: false, files: ["a.md"], pushed: false, error: "The site's own checks stopped the publish, so nothing was published.", detail: "lint failed" }, commit);
    expect(failed).toMatchObject({ kind: "failed", title: "Couldn’t publish", detail: "lint failed", canRetry: true });
    expect(failed.body).toContain("Your changes are safe here.");
  });

  it("counts one change correctly", () => {
    expect(publishOutcome({ ...base, files: ["a.md"] }, commit).body).toBe("1 change is live. The site usually updates within a minute.");
  });
});

describe("putting the main text back", () => {
  const published = "---\ntitle: Home\nsections: []\n---\n\nThe *published* text.\n\nSecond paragraph.\n";
  it("splits exactly where the main text starts", () => {
    const split = splitBody(published);
    expect(split?.head).toBe("---\ntitle: Home\nsections: []\n---\n");
    expect(split?.body).toBe("\nThe *published* text.\n\nSecond paragraph.\n");
    expect(`${split?.head}${split?.body}`).toBe(published);
  });

  it("keeps the current fields and restores the published body byte for byte", () => {
    const current = "---\ntitle: Home, edited\nsections: []\n---\nThe edited text, no blank line.";
    const next = withPublishedBody(current, published);
    expect(next).toBe("---\ntitle: Home, edited\nsections: []\n---\n\nThe *published* text.\n\nSecond paragraph.\n");
    expect(splitBody(next ?? "")?.body).toBe(splitBody(published)?.body);
  });

  it("handles CRLF files, a byte-order mark and files without front matter", () => {
    const crlf = "﻿---\r\ntitle: A\r\n---\r\nBody\r\n";
    expect(splitBody(crlf)).toEqual({ head: "﻿---\r\ntitle: A\r\n---\r\n", body: "Body\r\n" });
    expect(splitBody("Just text.\n")).toEqual({ head: "", body: "Just text.\n" });
  });

  it("does nothing when the body already matches, and refuses what it can't split", () => {
    expect(withPublishedBody(published.replace("Home", "Other"), published)).toBeNull();
    expect(withPublishedBody('{"title":"x"}\nBody', '{"title":"x"}\nOld')).toBeNull();
    expect(splitBody("---\ntitle: unclosed\nBody")).toBeNull();
  });
});

describe("sending versions that didn't reach the host", () => {
  const result = (patch: Partial<PublishResult>): PublishResult => ({ ok: true, files: [], pushed: false, ...patch });

  it("says the versions were sent, counting them when known", () => {
    const outcome = sendOutcome(result({ pushed: true, files: ["a.md"] }), { waiting: 2 });
    expect(outcome).toMatchObject({ kind: "sent", tone: "success", title: "Sent" });
    expect(outcome.canSend).toBeFalsy();
    expect(outcome.body).toBe("2 versions published here have reached the site’s host. The site usually updates within a minute.");
    expect(sendOutcome(result({ pushed: true, files: ["a.md"] })).body).toMatch(/^The versions published here have reached/);
  });

  it("says when nothing was waiting", () => {
    expect(sendOutcome(result({ pushed: true }))).toMatchObject({ kind: "nothing-to-send", title: "Nothing to send" });
  });

  it("keeps offering to send again when the host still can't be reached", () => {
    const outcome = sendOutcome(result({ ok: false, pushError: "The site’s host didn’t answer.", error: "The site’s host didn’t answer.", detail: "ssh: timed out" }), { waiting: 1 });
    expect(outcome).toMatchObject({ kind: "send-failed", tone: "warning", title: "Couldn’t send", canSend: true, detail: "ssh: timed out" });
    expect(outcome.body).toBe("The site’s host didn’t answer. The versions stay saved here, ready to send.");
  });

  it("stops offering when sending can't help (no host at all)", () => {
    const outcome = sendOutcome(result({ ok: false, error: "This site isn’t connected to a host." }));
    expect(outcome).toMatchObject({ kind: "send-failed", tone: "danger", canSend: false });
    expect(outcome.body).toBe("This site isn’t connected to a host. The versions stay saved here.");
  });

  it("offers to send again after a publish that didn't reach the host", () => {
    const outcome = publishOutcome(result({ files: ["a.md"], pushError: "The site’s host didn’t answer." }), { message: "Update", mode: "commit" });
    expect(outcome).toMatchObject({ kind: "not-sent", canSend: true, canRetry: false });
  });
});

describe("what is waiting, in content terms", () => {
  it("counts fields, page text, new and removed files instead of lines", () => {
    const files = [
      change({ path: "a.md", kind: "content", fieldChanges: [{ field: ["title"], label: "Title", kind: "changed" }, { field: ["description"], label: "Description", kind: "changed" }], bodyChanged: true }),
      change({ path: "b.md", kind: "content", status: "added" }),
      change({ path: "c.webp", kind: "media", status: "deleted", binary: true }),
    ];
    expect(pendingSummary(files)).toBe("2 fields edited, the text of 1 page edited, 1 new, 1 removed");
    expect(pendingSummary([change({ path: "x.css", kind: "code" })])).toBe("");
  });

  it("says a moved section moved rather than counting it as an edited field", () => {
    const home = change({
      path: "index.md",
      kind: "content",
      fieldChanges: [
        { field: ["sections", 2], label: "Sections › 3 (Logo row)", kind: "moved", from: 1, to: 2 },
        { field: ["sections", 3, "tone"], label: "Sections › 4 (Metrics) › Tone", kind: "changed" },
      ],
    });
    expect(pendingSummary([home])).toBe("1 field edited, 1 item moved");
  });
});
