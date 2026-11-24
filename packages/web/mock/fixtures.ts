/**
 * Fixture sites for the mock. The first is the real starter read from disk
 * at start-up (its collections, fields and section types come from its own
 * files), with a few pending edits applied the way a person would make them.
 * The second is a small documentation site built from inline files; the
 * third is a forgotten folder, to show the "missing" state.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { HistoryEntry } from "@galley/core/types";
import { MockSite, type CollectionDef, type SiteSeed } from "./site.ts";

// Joined by hand rather than `new URL(…, import.meta.url)`: tests that render the app in a
// browser-like environment rewrite that pattern into a page address.
export const STARTER_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../starters/astro-starter");
/** The mock's pretend disk: everything lives under this home folder. */
export const HOME = "/Users/you";
export const SITES_DIR = `${HOME}/Sites`;

const SKIP = new Set(["node_modules", ".astro", "dist", ".git"]);

function readTree(root: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name) || name === ".DS_Store") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.set(relative(root, full).split(sep).join("/"), readFileSync(full));
    }
  };
  walk(root);
  return files;
}

let counter = 0;
const id = (stem: string) => `${stem}-${(++counter).toString(36)}`;

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const sha = (seed: string) => {
  let hash = "";
  for (let i = 0; hash.length < 40; i++) hash += ((seed.charCodeAt(i % seed.length) * (i + 7)) % 16).toString(16);
  return hash;
};

function history(entries: Array<Omit<HistoryEntry, "commit" | "shortCommit">>): HistoryEntry[] {
  return entries.map((entry) => {
    const commit = sha(entry.message + entry.date);
    return { ...entry, commit, shortCommit: commit.slice(0, 7) };
  });
}

/** Team members' names from the starter, used as believable authors. */
function teamNames(files: Map<string, Buffer>): string[] {
  return [...files.entries()]
    .filter(([path]) => path.startsWith("src/content/team/"))
    .map(([, bytes]) => /^name:\s*(.+)$/m.exec(bytes.toString("utf8"))?.[1]?.trim())
    .filter((name): name is string => Boolean(name));
}

const NEW_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900" role="img"><title>Loft with a new dormer window</title><rect width="1600" height="900" fill="#DCD6C8"/><path d="M200 760 800 260l600 500z" fill="#B9A58A"/><rect x="640" y="430" width="320" height="200" fill="#F3EEE3"/><rect x="680" y="465" width="110" height="130" fill="#8FA3A8"/><rect x="810" y="465" width="110" height="130" fill="#8FA3A8"/><rect y="760" width="1600" height="140" fill="#8F9C7C"/></svg>
`;

const NEW_POST = `---
title: Notes from a site visit on Mill Lane
description: What we look at in the first hour of a visit, and why we always ask to see the loft.
date: 2026-11-20
author: nell-okafor
image: /images/projects/loft-dormer.svg
imageAlt: Abstract drawing of a loft with a new dormer window
tags:
  - Process
  - Lofts
draft: true
---

Most first visits start in the kitchen and end in the loft. The kitchen is where people want to change things; the loft is where we find out what the house will let us do.

## The first hour

We walk the whole house before we talk about the room in question. Stairs, chimneys and the line of the roof tell us more about cost than any wish list.
`;

/** The site kit's files: two forms and a scripts setup, as a site that has the kit carries them. */
const KIT_FILES: Array<[string, string]> = [
  [
    "src/content/forms/contact.json",
    `${JSON.stringify(
      {
        name: "Contact",
        description: "The form on the contact page.",
        fields: [
          { id: "name", type: "text", label: "Your name", required: true, width: "half" },
          { id: "email", type: "email", label: "Email", required: true, width: "half" },
          { id: "message", type: "textarea", label: "Message", required: true },
        ],
        submitLabel: "Send message",
        destinations: [{ provider: "galley", settings: {} }],
        afterSubmit: [{ type: "message", title: "Thanks", text: "We’ll reply within two working days." }],
      },
      null,
      2,
    )}\n`,
  ],
  [
    "src/content/forms/newsletter.json",
    `${JSON.stringify(
      {
        name: "Newsletter sign-up",
        fields: [{ id: "email", type: "email", label: "Email", required: true }],
        submitLabel: "Sign up",
        destinations: [{ provider: "galley", settings: {} }],
        afterSubmit: [{ type: "message", text: "You’re on the list." }],
      },
      null,
      2,
    )}\n`,
  ],
  ["src/data/scripts.json", `${JSON.stringify({ scripts: [], consent: { mode: "none" } }, null, 2)}\n`],
];

function loadStarter(): SiteSeed {
  if (!existsSync(STARTER_DIR)) throw new Error(`The mock reads the starter from ${STARTER_DIR}, which is missing.`);
  const files = readTree(STARTER_DIR);
  for (const [path, text] of KIT_FILES) if (!files.has(path)) files.set(path, Buffer.from(text));
  const config = files.get("galley.config.json") ? (JSON.parse(files.get("galley.config.json")!.toString("utf8")) as { name?: string; collections?: Array<Partial<CollectionDef> & { id: string }> }) : {};
  const siteJson = files.get("src/data/site.json") ? (JSON.parse(files.get("src/data/site.json")!.toString("utf8")) as { name?: string; url?: string }) : {};
  const pkg = JSON.parse(files.get("package.json")?.toString("utf8") ?? "{}") as { dependencies?: Record<string, string> };
  const override = (cid: string) => config.collections?.find((c) => c.id === cid) ?? {};

  const collections: CollectionDef[] = [
    { id: "pages", label: "Pages", singular: "page", kind: "entries", path: "src/content/pages", pattern: "**/*.md", format: "markdown", body: true, url: "/{slug}/", titleField: "title", imageField: "image", create: true, ...override("pages") },
    { id: "blog", label: "Blog", singular: "post", kind: "entries", path: "src/content/blog", pattern: "*.md", format: "markdown", body: true, url: "/blog/{slug}/", titleField: "title", dateField: "date", imageField: "image", draftField: "draft", create: true, ...override("blog") },
    { id: "team", label: "Team", singular: "team member", kind: "entries", path: "src/content/team", pattern: "*.md", format: "markdown", body: true, url: null, titleField: "name", imageField: "photo", create: true, ...override("team") },
    { id: "site", label: "Site details", singular: "site details", kind: "data", path: "src/data/site.json", format: "json", body: false, url: null, create: false, source: "inferred" },
    { id: "navigation", label: "Navigation", singular: "navigation", kind: "data", path: "src/data/navigation.json", format: "json", body: false, url: null, create: false, source: "inferred" },
    { id: "forms", label: "Forms", singular: "form", kind: "entries", path: "src/content/forms", pattern: "*.json", format: "json", body: false, url: null, titleField: "name", create: true, source: "schema" },
    { id: "scripts", label: "Scripts", singular: "scripts", kind: "data", path: "src/data/scripts.json", format: "json", body: false, url: null, create: false, source: "inferred" },
  ];

  const names = teamNames(files);
  const [a = "Sam Editor", b = "Ari Writer", c = "Jo Designer", d = "Kim Developer"] = names;
  const email = (name: string) => `${name.split(" ")[0]?.toLowerCase()}@example.com`;
  const astroVersion = pkg.dependencies?.astro?.replace(/^[^\d]*/, "").split(".").slice(0, 2).join(".");

  return {
    id: id("starter"),
    name: config.name ?? siteJson.name ?? "Astro starter",
    root: `${SITES_DIR}/marketing-site`,
    framework: { id: "astro", name: "Astro", version: astroVersion },
    packageManager: "pnpm",
    files,
    collections,
    notes: [
      "Read 3 collections from src/content.config.ts: pages, blog, team.",
      "Found 2 data files in src/data: site.json, navigation.json.",
      "Applied galley.config.json: labels for Journal and Team; Team has no pages of its own.",
      "pages.sections: 16 section types declared, 11 used across 8 pages.",
      "team.role: 4 distinct values in 4 files — kept as text.",
    ],
    mediaDir: "public/images",
    mediaPublicPath: "/images",
    urls: { production: siteJson.url },
    dev: { command: "astro dev", port: 4321 },
    build: { command: "astro build", outDir: "dist" },
    branch: "main",
    remoteUrl: "git@github.com:example/marketing-site.git",
    behind: 2,
    history: history([
      { message: "Update prices for 2027", author: a, email: email(a), date: hoursAgo(2), files: ["src/content/pages/pricing.md"], viaGalley: true },
      { message: "Add post: Living through a renovation", author: b, email: email(b), date: hoursAgo(26), files: ["src/content/blog/living-through-a-renovation.md", "public/images/blog/renovation-guide.svg"], viaGalley: true },
      { message: "Fix the phone number on the contact page", author: c, email: email(c), date: hoursAgo(75), files: ["src/content/pages/contact.md", "src/data/site.json"], viaGalley: true },
      { message: "Add the garden rooms gallery", author: d, email: email(d), date: hoursAgo(190), files: ["src/content/pages/services.md", "public/images/gallery/garden-room.svg"], viaGalley: false },
      { message: "New team photos", author: a, email: email(a), date: hoursAgo(340), files: names.map((n) => `public/images/team/${n.toLowerCase().replace(/\s+/g, "-")}.svg`), viaGalley: true },
      { message: "First version of the site", author: d, email: email(d), date: hoursAgo(900), files: ["src/content/pages/index.md", "src/content/pages/about.md", "src/content.config.ts"], viaGalley: false },
    ]),
  };
}

/** Pending edits on the starter, made through the same code paths the API uses. */
function seedEdits(site: MockSite): void {
  site.updateEntry("src/content/pages/index.md", [
    { op: "set", path: ["sections", 0, "heading"], value: "Make more of the *house you already love*." },
    {
      op: "set",
      path: ["sections", 0, "text"],
      value: "We are a studio of four, designing extensions, loft conversions and garden rooms. Clear drawings, fixed fees, and someone who picks up the phone.",
    },
  ]);
  site.updateEntry("src/content/pages/about.md", [
    { op: "set", path: ["description"], value: "A four-person architecture studio. Meet the team, and see how we work with ordinary houses." },
  ]);
  site.write("public/images/projects/loft-dormer.svg", Buffer.from(NEW_IMAGE));
  site.write("src/content/blog/notes-from-a-site-visit.md", Buffer.from(NEW_POST));
}

const doc = (data: Record<string, unknown>, body: string) => Buffer.from(`---\n${YAML.stringify(data)}---\n\n${body}\n`);
const picture = (title: string, fill: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800" role="img"><title>${title}</title><rect width="1200" height="800" fill="${fill}"/><rect x="180" y="200" width="840" height="400" fill="#F4F1EA"/></svg>\n`);

function handbookSeed(name: string, folder: string): SiteSeed {
  const files = new Map<string, Buffer>([
    ["package.json", Buffer.from(JSON.stringify({ name: folder, private: true, scripts: { dev: "eleventy --serve", build: "eleventy" }, devDependencies: { "@11ty/eleventy": "^3.1.0" } }, null, 2))],
    ["eleventy.config.js", Buffer.from('export default function (config) {\n  config.addPassthroughCopy("src/images");\n  return { dir: { input: "src" } };\n}\n')],
    ["src/_data/settings.json", Buffer.from(JSON.stringify({ title: name, description: "How we write, review and publish.", footer: "Questions? Ask in the team channel." }, null, 2) + "\n")],
    ["src/guides/getting-started.md", doc({ title: "Getting started", summary: "Your first week, in order.", order: 1, updated: "2026-10-02" }, "Welcome. This guide walks through the first week: accounts, tools and who to ask.\n\n## Day one\n\nSet up your laptop and read the writing style guide.")],
    ["src/guides/writing-style.md", doc({ title: "Writing style", summary: "Plain words, short sentences, active voice.", order: 2, updated: "2026-09-18" }, "Write the way you would explain it to a colleague. One idea per sentence.\n\n## Headings\n\nSentence case. No full stops.")],
    ["src/guides/publishing-checklist.md", doc({ title: "Publishing checklist", summary: "Seven things to check before anything goes live.", order: 3, updated: "2026-11-01" }, "1. Read it aloud.\n2. Check every link.\n3. Check the images have descriptions.")],
    ["src/guides/images.md", doc({ title: "Images", summary: "Sizes, formats and descriptions.", order: 4, updated: "2026-08-27", image: "/images/sizes.svg" }, "Use WebP where you can. Describe every image for people who can't see it.")],
    ["src/images/sizes.svg", picture("Image sizes", "#C9D3DA")],
    ["src/images/cover.svg", picture("Handbook cover", "#D9CBB8")],
  ]);
  return {
    id: id("handbook"),
    name,
    root: folder.startsWith("/") ? folder : `${SITES_DIR}/${folder}`,
    framework: { id: "eleventy", name: "Eleventy", version: "3.1" },
    packageManager: "npm",
    files,
    collections: [
      { id: "guides", label: "Guides", singular: "guide", kind: "entries", path: "src/guides", pattern: "*.md", format: "markdown", body: true, url: "/guides/{slug}/", titleField: "title", dateField: "updated", create: true, source: "inferred" },
      { id: "settings", label: "Handbook details", singular: "handbook details", kind: "data", path: "src/_data/settings.json", format: "json", body: false, url: null, create: false, source: "inferred" },
    ],
    notes: ["Eleventy 3.1 · found 1 folder of 4 markdown files (guides).", "Found 1 data file in src/_data."],
    mediaDir: "src/images",
    mediaPublicPath: "/images",
    urls: {},
    dev: { command: "eleventy --serve", port: 8080 },
    build: { command: "eleventy", outDir: "_site" },
    branch: "main",
    history: history([
      { message: "Add the publishing checklist", author: "You", email: "you@example.com", date: hoursAgo(50), files: ["src/guides/publishing-checklist.md"], viaGalley: true },
      { message: "Start the handbook", author: "You", email: "you@example.com", date: hoursAgo(400), files: ["src/guides/getting-started.md"], viaGalley: false },
    ]),
  };
}

export function createSites(): MockSite[] {
  const starter = new MockSite(loadStarter());
  seedEdits(starter);
  starter.lastOpenedAt = Date.now() - 20 * 60_000;

  const handbook = new MockSite(handbookSeed("Team handbook", "handbook"));
  handbook.lastOpenedAt = Date.now() - 3 * 86_400_000;

  const missingSeed = handbookSeed("Old handbook", "archive/old-handbook");
  const missing = new MockSite({ ...missingSeed, missing: true, history: [] });
  missing.lastOpenedAt = Date.now() - 40 * 86_400_000;

  return [starter, handbook, missing];
}

/** A fresh site from the starter (create) or the small docs fixture (clone, open). */
export function newSiteFrom(kind: "starter" | "docs", name: string, folder: string): MockSite {
  if (kind === "starter") {
    const seed = loadStarter();
    return new MockSite({ ...seed, id: id("site"), name, root: `${SITES_DIR}/${folder}`, history: seed.history.slice(-1), behind: 0, remoteUrl: undefined });
  }
  return new MockSite(handbookSeed(name, folder));
}

export function starterDescription(): string {
  try {
    return (JSON.parse(readFileSync(join(STARTER_DIR, "package.json"), "utf8")) as { description?: string }).description ?? "";
  } catch {
    return "";
  }
}
