/**
 * `galley import wordpress <url|file>` — ready to mount in the CLI's
 * command table. It needs only the slice of the CLI's Io it uses (out, err,
 * cwd, env); everything else it builds from the engine itself.
 *
 * The application password is read from an environment variable whose
 * name is given (never from an argument, which would end up in shell
 * history and process lists) and it is never printed.
 */
import { existsSync, realpathSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { isGalleyError } from "@galley/core";
import { PRODUCT } from "@galley/core/brand";
import { createEventBus, createSiteService, siteIdFor } from "@galley/core/site";
import type { JsonValue, SiteModel, SiteService } from "@galley/core/types";
import { ImportError } from "./errors";
import { planImport } from "./plan";
import { renderReport } from "./report";
import { runImport } from "./run";
import { cacheDirFor, readWordPress, sourceFromArgument } from "./source/index";
import type { ImportKind, PlanContext, PlanOptions, ProgressEvent, WordPressSource } from "./types";

export interface ImportIo {
  out(line?: string): void;
  err(line?: string): void;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Opens the target site. Default: the real engine, without a file watcher. */
  openImportSite?(root: string): Promise<SiteService>;
  /** For tests: the HTTP client every request goes through. */
  fetch?: typeof fetch;
}

export const IMPORT_HELP = `Usage: ${PRODUCT.slug} import wordpress <address|file> [path] [options]

Bring a WordPress site into this site. Posts, pages, images and SEO details
arrive as pending changes: check them in Proof, then publish. Nothing goes
live by itself.

  <address>  the site's address — read through its REST API
  <file>     an export file (WordPress › Tools › Export › All content)
  [path]     the site to import into (default: this folder)

Options
      --plan                   Show what would come across; write nothing
      --into <path>            The site to import into (same as [path])
      --dry-run                Same as --plan
      --only <kinds>           posts, pages and/or media (comma-separated)
      --limit <n>              At most n posts and n pages (newest first)
      --since <YYYY-MM-DD>     Only what was published or changed since then
      --posts-into <id>        The collection posts go into, when asked
      --pages-into <id>        The collection pages go into, when asked
      --type <slug>:<id>       Also import a custom content type into a collection
      --default <field>=<v>    A value for a required field WordPress can't fill
                               (prefix a collection to target one: blog.image=/images/x.png)
      --user <name>            Sign in to read drafts and private pages…
      --app-password-env <VAR> …with the application password in this variable
                               (default WORDPRESS_APP_PASSWORD)
      --write-redirects        Write redirect files for the addresses that change
      --max-file-mb <n>        Largest single file to download (default 25)
      --max-total-mb <n>       Stop downloading media past this total (default 1024)
      --fresh                  Fetch everything again instead of resuming
      --json                   Print the report as JSON
  -h, --help                   Show this help`;

class UsageProblem extends Error {}

function positiveNumber(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) throw new UsageProblem(`--${name} must be a positive number, not “${value}”.`);
  return n;
}

function parseValue(text: string): JsonValue {
  if (/^(true|false|null|-?\d+(\.\d+)?)$/.test(text) || /^[[{"]/.test(text)) {
    try {
      return JSON.parse(text) as JsonValue;
    } catch {
      return text;
    }
  }
  return text;
}

async function defaultOpenSite(root: string): Promise<SiteService> {
  const real = realpathSync(root);

  return createSiteService(real, { id: siteIdFor(real), events: createEventBus(), overlayScript: () => "", author: () => null, watch: false });
}

/**
 * `--default [collection.]field=value` entries → the plan's defaults: a value
 * for every collection that has the field, or only the one named.
 */
export function defaultsFromAnswers(model: SiteModel, entries: Array<{ collection?: string; field: string; value: JsonValue }>): NonNullable<PlanOptions["defaults"]> {
  const out: NonNullable<PlanOptions["defaults"]> = {};

  for (const entry of entries) {
    for (const collection of model.collections) {
      if (entry.collection && entry.collection !== collection.id) continue;
      if (!collection.fields.some((field) => field.key === entry.field)) continue;
      out[collection.id] = { ...(out[collection.id] ?? {}), [entry.field]: entry.value };
    }
  }
  return out;
}

/** Entries the plan may match authors against, and the media paths that tell how the site files images. */
export async function planContext(site: SiteService, model: SiteModel): Promise<PlanContext> {
  const referenced = new Set<string>();

  for (const collection of model.collections) {
    for (const field of collection.fields) {
      if (field.type === "reference" && field.collection) referenced.add(field.collection);
      if (field.of?.type === "reference" && field.of.collection) referenced.add(field.of.collection);
    }
  }
  const entries: PlanContext["entries"] = {};

  for (const id of referenced) {
    const list = await site.listEntries(id, { limit: 1000 }).catch(() => null);

    if (list) entries[id] = list.items.map((item) => ({ slug: item.slug, title: item.title }));
  }
  const mediaPaths = (await site.listMedia().catch(() => [])).map((item) => item.path);

  return { entries, mediaPaths };
}

function progressPrinter(io: ImportIo, quiet: boolean): (event: ProgressEvent) => void {
  let last = "";

  return (event) => {
    if (quiet) return;
    const text = "done" in event && event.total ? `${event.label} (${event.done}/${event.total})` : event.label;

    // Byte-level read progress is too chatty for a terminal; print each label once.
    if (event.label === last) return;
    last = event.label;
    io.err(`… ${text}`);
  };
}

export const importCommand = {
  name: "import" as const,
  describe: "Bring a WordPress site's posts, pages and images into this site as pending changes",

  async run(args: string[], io: ImportIo): Promise<number> {
    let parsed;

    try {
      parsed = parseArgs({
        args,
        allowPositionals: true,
        strict: true,
        options: {
          help: { type: "boolean", short: "h" },
          into: { type: "string" },
          "dry-run": { type: "boolean" },
          plan: { type: "boolean" },
          only: { type: "string", multiple: true },
          limit: { type: "string" },
          since: { type: "string" },
          "posts-into": { type: "string" },
          "pages-into": { type: "string" },
          type: { type: "string", multiple: true },
          default: { type: "string", multiple: true },
          user: { type: "string" },
          "app-password-env": { type: "string" },
          "write-redirects": { type: "boolean" },
          "max-file-mb": { type: "string" },
          "max-total-mb": { type: "string" },
          fresh: { type: "boolean" },
          json: { type: "boolean" },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const unknown = /Unknown option '([^']+)'/.exec(message)?.[1];

      io.err(`${unknown ? `${unknown} isn't an option here.` : message} Run \`${PRODUCT.slug} import --help\` to see the options.`);
      return 2;
    }
    const { values, positionals } = parsed;

    if (values.help || positionals.length === 0) {
      io.out(IMPORT_HELP);
      return positionals.length === 0 && !values.help ? 2 : 0;
    }
    const [from, input, target, ...extra] = positionals;

    try {
      if (from !== "wordpress") throw new UsageProblem(`${PRODUCT.name} can import from WordPress: \`${PRODUCT.slug} import wordpress <url|file>\`.`);
      if (!input) throw new UsageProblem("Say where the WordPress site is: its address, or the path to an export file.");
      if (extra.length) throw new UsageProblem(`Too many arguments: ${extra.join(" ")}.`);
      if (target && values.into && resolve(io.cwd, target) !== resolve(io.cwd, values.into)) throw new UsageProblem("Name the site to import into once: as [path] or with --into, not both.");
      const only = (values.only ?? []).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);

      for (const kind of only) if (!["posts", "pages", "media"].includes(kind)) throw new UsageProblem(`--only takes posts, pages or media, not “${kind}”.`);
      if (values.since && Number.isNaN(Date.parse(values.since))) throw new UsageProblem(`--since needs a date like 2024-01-31, not “${values.since}”.`);
      const types: Record<string, string> = {};

      for (const entry of values.type ?? []) {
        const [slug, collection] = entry.split(":");

        if (!slug || !collection) throw new UsageProblem(`--type needs a content type and a collection, like --type portfolio:projects (got “${entry}”).`);
        types[slug] = collection;
      }
      const defaults: Array<{ collection?: string; field: string; value: JsonValue }> = [];

      for (const entry of values.default ?? []) {
        const at = entry.indexOf("=");

        if (at <= 0) throw new UsageProblem(`--default needs field=value, like --default image=/images/cover.png (got “${entry}”).`);
        const key = entry.slice(0, at);
        const dot = key.indexOf(".");

        defaults.push({ ...(dot > 0 ? { collection: key.slice(0, dot) } : {}), field: dot > 0 ? key.slice(dot + 1) : key, value: parseValue(entry.slice(at + 1)) });
      }
      let source: WordPressSource = sourceFromArgument(input, io.cwd);

      if (values.user) {
        if (!("url" in source)) throw new UsageProblem("--user is for reading a live site; an export file already includes drafts.");
        const variable = values["app-password-env"] ?? "WORDPRESS_APP_PASSWORD";
        const password = io.env[variable];

        if (!password) throw new UsageProblem(`Set the application password in the environment variable ${variable} (WordPress › Users › Profile › Application passwords). It's read from there so it never appears in your shell history.`);
        source = { url: source.url, auth: { user: values.user, password: password.replace(/\s+/g, " ").trim() } };
      }
      const root = resolve(io.cwd, target ?? values.into ?? ".");
      const dryRun = Boolean(values["dry-run"] || values.plan);
      const onProgress = progressPrinter(io, false);
      if (!existsSync(root)) throw new UsageProblem(`There's no folder at ${root} to import into. Name the site's folder, or run this from inside it.`);
      const site = await (io.openImportSite ?? defaultOpenSite)(root);

      try {
        const model = await site.model();
        const kinds = only as ImportKind[];
        const wp = await readWordPress(source, {
          ...(kinds.length ? { only: kinds } : {}),
          ...(values.limit ? { limit: positiveNumber("limit", values.limit)! } : {}),
          ...(values.since ? { since: values.since } : {}),
          ...(Object.keys(types).length ? { types: Object.keys(types) } : {}),
          ...(values.fresh ? { fresh: true } : {}),
          ...(io.fetch ? { fetch: io.fetch } : {}),
          onProgress,
        });
        const planDefaults = defaultsFromAnswers(model, defaults);
        const plan = planImport(wp, model, {
          ...(kinds.length ? { only: kinds } : {}),
          ...(values.limit ? { limit: positiveNumber("limit", values.limit)! } : {}),
          ...(values.since ? { since: values.since } : {}),
          ...(values["posts-into"] ? { postsCollection: values["posts-into"] } : {}),
          ...(values["pages-into"] ? { pagesCollection: values["pages-into"] } : {}),
          ...(Object.keys(types).length ? { types } : {}),
          ...(Object.keys(planDefaults).length ? { defaults: planDefaults } : {}),
          context: await planContext(site, model),
        });

        for (const note of wp.notes) io.err(`! ${note}`);
        const report = await runImport(site, wp, plan, {
          dryRun: dryRun || plan.questions.length > 0,
          onProgress,
          ...(values["write-redirects"] ? { writeRedirects: true } : {}),
          ...(values["max-file-mb"] ? { maxFileBytes: positiveNumber("max-file-mb", values["max-file-mb"])! * 1024 * 1024 } : {}),
          ...(values["max-total-mb"] ? { maxTotalBytes: positiveNumber("max-total-mb", values["max-total-mb"])! * 1024 * 1024 } : {}),
          ...(io.fetch ? { fetch: io.fetch } : {}),
        });

        io.out(values.json ? JSON.stringify(report, null, 2) : renderReport(report));
        if (plan.questions.length) return 1;
        // A finished live import clears its cache, so the next run sees what changed at the source.
        const cache = cacheDirFor(source);

        if (cache && !dryRun) rmSync(cache, { recursive: true, force: true });
        return 0;
      } finally {
        await site.dispose();
      }
    } catch (error) {
      if (error instanceof UsageProblem) {
        io.err(`${error.message} Run \`${PRODUCT.slug} import --help\` to see the options.`);
        return 2;
      }
      if (error instanceof ImportError) {
        io.err(error.message);
        return 1;
      }
      if (isGalleyError(error)) {
        io.err(error.message);
        return 1;
      }
      throw error;
    }
  },
};
