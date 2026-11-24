/**
 * A small in-memory SiteService for tool and loop tests. Entries are parsed
 * and edited with the engine's own pure content functions, and writes are
 * checked against the engine's own write policy — so a content-mode write to
 * a source file is refused here exactly as the workspace refuses it.
 */
import picomatch from "picomatch";
import { buildEntry } from "../../../src/content/entries/entries";
import { collectionForPath, pathForSlug } from "../../../src/content/entries/paths";
import { applyEdits } from "../../../src/content/edit/apply";
import { serializeEntry } from "../../../src/content/document/serialize";
import { hashContent } from "../../../src/content/util/json";
import { GalleyError } from "../../../src/errors";
import type {
  AgentMode,
  BuildResult,
  ChangeOrigin,
  Checkpoint,
  EditOp,
  Entry,
  EntryList,
  GalleyConfig,
  MediaItem,
  SiteModel,
  SiteService,
  ValidationIssue,
} from "../../../src/types";
import { writeRefusal } from "../../../src/workspace/policy";

export function fakeModel(overrides: Partial<SiteModel> = {}): SiteModel {
  return {
    name: "Harbour Bakery",
    framework: { id: "astro", name: "Astro", version: "7.4" },
    packageManager: "npm",
    installed: true,
    dev: { command: "astro dev", port: 4321 },
    build: { command: "astro build", outDir: "dist" },
    collections: [
      {
        id: "pages",
        label: "Pages",
        singular: "page",
        kind: "entries",
        path: "src/content/pages",
        pattern: "**/*.md",
        format: "markdown",
        body: true,
        url: "/{slug}/",
        fields: [
          { key: "title", label: "Title", type: "string", required: true, source: "schema" },
          { key: "description", label: "Description", type: "text", required: false, source: "schema" },
          {
            key: "sections",
            label: "Sections",
            type: "blocks",
            required: false,
            source: "schema",
            discriminator: "type",
            blocks: [
              {
                type: "hero",
                label: "Hero",
                count: 1,
                fields: [
                  { key: "type", label: "Type", type: "string", required: true, source: "schema" },
                  { key: "heading", label: "Heading", type: "string", required: true, source: "schema" },
                  { key: "image", label: "Image", type: "image", required: false, source: "schema" },
                ],
              },
              {
                type: "text",
                label: "Text",
                count: 1,
                fields: [
                  { key: "type", label: "Type", type: "string", required: true, source: "schema" },
                  { key: "heading", label: "Heading", type: "string", required: false, source: "schema" },
                  { key: "text", label: "Text", type: "markdown", required: true, source: "schema" },
                ],
              },
            ],
          },
        ],
        titleField: "title",
        create: true,
        count: 2,
        source: "schema",
      },
      {
        id: "blog",
        label: "Journal",
        singular: "post",
        kind: "entries",
        path: "src/content/blog",
        pattern: "**/*.md",
        format: "markdown",
        body: true,
        url: "/blog/{slug}/",
        fields: [
          { key: "title", label: "Title", type: "string", required: true, source: "schema" },
          { key: "date", label: "Date", type: "date", required: true, source: "schema" },
        ],
        titleField: "title",
        dateField: "date",
        create: true,
        count: 1,
        source: "schema",
      },
    ],
    media: { dir: "public/images", publicPath: "/images", roots: [{ dir: "public/images", publicPath: "/images" }] },
    urls: {},
    publish: { branch: "main", mode: "commit", remote: null, push: false },
    ai: { instructions: ["CONTENT-GUIDE.md"], allowBuild: true },
    writable: { content: ["src/content/**", "src/data/**", "public/images/**"], build: ["src/**", "public/**", "astro.config.*"] },
    notes: [],
    ...overrides,
  };
}

export const FAKE_FILES: Record<string, string> = {
  "CONTENT-GUIDE.md": "# Content guide\n\nWarm and plain. British spelling.\n",
  "src/content/pages/index.md":
    "---\ntitle: Harbour Bakery\ndescription: Bread baked on the quay.\nsections:\n  - type: hero\n    heading: Bread from the harbour\n  - type: text\n    heading: Our ovens\n    text: Wood-fired since 1998.\n---\n",
  "src/content/pages/about.md": "---\ntitle: About\n---\n\nWe bake before dawn. We bake before dawn again on Sundays.\n",
  "src/content/blog/rye.md": "---\ntitle: Why rye\ndate: 2026-01-10\n---\n\nRye keeps.\n",
  "src/components/Header.astro": "<header>\n  <a href=\"/\">Home</a>\n</header>\n",
  "src/styles/tokens.css": ":root {\n  --color-accent: #1f6feb;\n}\n",
};

export interface FakeWrite {
  path: string;
  origin: ChangeOrigin | undefined;
  mode: AgentMode | null;
}

export interface FakeSite extends SiteService {
  files: Map<string, string | Uint8Array>;
  writes: FakeWrite[];
  buildResult: BuildResult;
}

export function createFakeSite(options: { id?: string; files?: Record<string, string>; model?: SiteModel } = {}): FakeSite {
  const model = options.model ?? fakeModel();
  const files = new Map<string, string | Uint8Array>(Object.entries(options.files ?? FAKE_FILES));
  const writes: FakeWrite[] = [];
  const openCheckpoints = new Set<{ records: Map<string, string | Uint8Array | null>; open: boolean }>();
  let config: GalleyConfig | null = null;

  const text = (path: string): string => {
    const value = files.get(path);

    if (value === undefined) throw new GalleyError("not-found", "That file doesn't exist.", path);
    return typeof value === "string" ? value : new TextDecoder().decode(value);
  };
  const put = (path: string, value: string | Uint8Array | null, origin: ChangeOrigin | undefined, mode: AgentMode | null) => {
    for (const checkpoint of openCheckpoints) {
      if (checkpoint.open && !checkpoint.records.has(path)) checkpoint.records.set(path, files.get(path) ?? null);
    }
    if (value === null) files.delete(path);
    else files.set(path, value);
    writes.push({ path, origin, mode });
  };
  const entry = (path: string): Entry => {
    if (!collectionForPath(model, path)) throw new GalleyError("not-found", "This file isn't part of any collection.", path);
    return buildEntry(model, path, text(path), { mtimeMs: 0 });
  };

  const site: FakeSite = {
    id: options.id ?? "fake-site",
    root: "/nonexistent/fake-site",
    files,
    writes,
    buildResult: { ok: true, output: "build ok\n", durationMs: 1200 },
    async summary() {
      throw new Error("not in the fake");
    },
    async detail() {
      throw new Error("not in the fake");
    },
    async model() {
      return model;
    },
    async refresh() {
      return model;
    },
    async detected() {
      return model;
    },
    async readConfig() {
      return config;
    },
    async saveConfig(next) {
      config = next;
      put("galley.config.json", `${JSON.stringify(next, null, 2)}\n`, "agent", null);
      return model;
    },
    async listEntries(collectionId, query = {}): Promise<EntryList> {
      const collection = model.collections.find((c) => c.id === collectionId);

      if (!collection) throw new GalleyError("not-found", "There's no collection with that name.", collectionId);
      const items = [...files.keys()]
        .filter((path) => path.startsWith(`${collection.path}/`) && path.endsWith(".md"))
        .sort()
        .map((path) => entry(path))
        .filter((item) => !query.search || item.title.toLowerCase().includes(query.search.toLowerCase()) || item.path.includes(query.search));
      const offset = query.offset ?? 0;

      return { collection: collectionId, total: items.length, items: items.slice(offset, offset + (query.limit ?? 50)) };
    },
    async readEntry(path) {
      return entry(path);
    },
    async updateEntry(path, ops: EditOp[], opts = {}) {
      const current = entry(path);

      if (opts.baseHash && opts.baseHash !== current.hash) throw new GalleyError("conflict", "This entry changed since it was read. Read it again.");
      const result = applyEdits(current.raw, current.format, ops);

      if (result.applied > 0) put(path, result.content, opts.origin, null);
      return { entry: entry(path), applied: result.applied, refused: result.refused };
    },
    async createEntry(input, opts = {}) {
      const collection = model.collections.find((c) => c.id === input.collection);

      if (!collection) throw new GalleyError("not-found", "There's no collection with that name.", input.collection);
      const path = pathForSlug(collection, input.slug);

      if (files.has(path)) throw new GalleyError("conflict", "Something with that name already exists.");
      put(path, serializeEntry(collection, input.data, input.body), opts.origin, null);
      return entry(path);
    },
    async deleteEntry(path, opts = {}) {
      text(path);
      put(path, null, opts.origin, null);
    },
    async search(query, opts = {}) {
      const hits = [];

      for (const path of [...files.keys()].sort()) {
        if (!collectionForPath(model, path)) continue;
        const raw = text(path);
        const at = raw.toLowerCase().indexOf(query.toLowerCase());

        if (at === -1) continue;
        const item = entry(path);

        hits.push({ path, collection: item.collection, title: item.title, url: item.url, location: { kind: "source" as const, line: raw.slice(0, at).split("\n").length, column: 1 }, excerpt: raw.slice(Math.max(0, at - 20), at + query.length + 20) });
      }
      return hits.slice(0, opts.limit ?? 20);
    },
    async resolveText() {
      return { status: "none", matches: [] };
    },
    async entryForUrl(urlPath) {
      for (const path of files.keys()) {
        if (!collectionForPath(model, path)) continue;
        const item = entry(path);

        if (item.url === urlPath) return item;
      }
      return null;
    },
    async validate(paths): Promise<ValidationIssue[]> {
      const targets = paths ?? [...files.keys()].filter((path) => collectionForPath(model, path));

      return targets.flatMap((path) => entry(path).issues);
    },
    async listFiles(opts = {}) {
      const match = opts.glob ? picomatch(opts.glob) : () => true;

      return [...files.keys()].filter((path) => match(path)).sort().slice(0, opts.limit ?? 1000);
    },
    async readFile(path) {
      const value = files.get(path);

      if (value === undefined) throw new GalleyError("not-found", "That file doesn't exist.", path);
      const binary = typeof value !== "string";

      return { path, content: binary ? "" : value, hash: hashContent(binary ? "" : value), binary };
    },
    async writeFile(path, content, writeOptions) {
      const refusal = writeRefusal(path, model.writable, writeOptions.mode);

      if (refusal) throw new GalleyError("forbidden", refusal, path);
      if (writeOptions.baseHash && files.has(path) && hashContent(text(path)) !== writeOptions.baseHash) {
        throw new GalleyError("conflict", "That file changed since it was read.");
      }
      put(path, content, writeOptions.origin, writeOptions.mode);
    },
    async deleteFile(path, writeOptions) {
      const refusal = writeRefusal(path, model.writable, writeOptions.mode);

      if (refusal) throw new GalleyError("forbidden", refusal, path);
      put(path, null, writeOptions.origin, writeOptions.mode);
    },
    async listMedia(): Promise<MediaItem[]> {
      return [...files.keys()]
        .filter((path) => path.startsWith("public/images/"))
        .sort()
        .map((path) => ({ path, url: path.replace(/^public/, ""), name: path.split("/").pop() ?? path, size: 1, type: "image/svg+xml", modifiedAt: 0, status: "clean" as const }));
    },
    async saveMedia(input, opts = {}) {
      const dir = input.directory ?? model.media.dir;
      const dot = input.filename.lastIndexOf(".");
      const base = input.filename.slice(0, dot);
      const ext = input.filename.slice(dot + 1);
      let path = `${dir}/${input.filename}`;

      for (let n = 2; files.has(path); n += 1) path = `${dir}/${base}-${n}.${ext}`;
      put(path, input.data, opts.origin, null);
      return { path, url: path.replace(/^public/, ""), name: path.split("/").pop() ?? path, size: input.data.length, type: "image/png", modifiedAt: 0, status: "added" };
    },
    resolvePath(path) {
      throw new GalleyError("not-found", "The fake has no disk.", path);
    },
    async changes() {
      throw new Error("not in the fake");
    },
    async diff() {
      throw new Error("not in the fake");
    },
    async readBase() {
      return null;
    },
    async discard() {
      throw new Error("not in the fake");
    },
    async publish() {
      throw new Error("the assistant must never publish");
    },
    async history() {
      return [];
    },
    async revert() {
      throw new Error("not in the fake");
    },
    async send() {
      throw new Error("the assistant must never publish");
    },
    async gitStatus() {
      throw new Error("not in the fake");
    },
    async checkGit() {
      throw new Error("not in the fake");
    },
    async pull() {
      throw new Error("not in the fake");
    },
    async catchUp() {
      throw new Error("not in the fake");
    },
    checkpoint(label): Checkpoint {
      const record = { records: new Map<string, string | Uint8Array | null>(), open: true };

      openCheckpoints.add(record);
      return {
        id: `cp-${label}`,
        paths: () => [...record.records.keys()].sort(),
        run: (work) => work(),
        left: () => [],
        close: () => {
          record.open = false;
        },
        restore: async () => {
          record.open = false;
          for (const [path, before] of record.records) {
            if (before === null) files.delete(path);
            else files.set(path, before);
          }
          return [...record.records.keys()].sort();
        },
      };
    },
    preview() {
      throw new Error("not in the fake");
    },
    async build() {
      return site.buildResult;
    },
    async dispose() {},
  };

  return site;
}
