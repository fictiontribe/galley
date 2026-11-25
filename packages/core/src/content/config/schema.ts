/**
 * galley.config.json: the zod schema that validates it, the JSON Schema
 * editors use for autocompletion, and readable error messages.
 */
import { z } from "zod";

import { CONFIG_SCHEMA_URL, PRODUCT } from "../../brand";
import type { GalleyConfig } from "../../types";

const FIELD_TYPES = ["string", "text", "markdown", "number", "boolean", "date", "datetime", "image", "url", "color", "select", "tags", "list", "object", "blocks", "reference", "json"] as const;
const FORMATS = ["markdown", "mdx", "json", "yaml", "toml"] as const;
/** The built-in adapter ids — offered for autocompletion; any lowercase adapter id is accepted. */
export const KNOWN_FRAMEWORKS = ["astro", "eleventy", "hugo", "jekyll", "next", "nuxt", "sveltekit", "docusaurus", "generic"] as const;
const ADAPTER_ID = /^[a-z][a-z0-9-]*$/;
const FRAMEWORK_DESCRIPTION = "The adapter that describes this site, by id. Leave it out to let detection choose.";
const PLUGINS_DESCRIPTION =
  'Plugins to load from this site: package names installed in its node_modules, or paths to files inside it, such as "./tools/plugin.mjs". This runs the site\'s own code inside the app, so only what is listed is loaded.';
const ADAPTERS_DESCRIPTION =
  'Adapters to load from this site, before the built-in ones: package names installed in its node_modules, or paths to files inside it, such as "./tools/my-adapter.mjs".';

const jsonValue: z.ZodType<unknown> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)]));

const fieldConfig: z.ZodType<unknown> = z
  .object({
    key: z.string().min(1).describe("The field's key in the file."),
    label: z.string().optional(),
    type: z.enum(FIELD_TYPES).optional(),
    required: z.boolean().optional(),
    description: z.string().optional().describe("Help text shown under the field and given to the assistant."),
    options: z.array(z.string()).optional(),
    discriminator: z.string().optional(),
    collection: z.string().optional(),
    default: jsonValue.optional(),
    examples: z.array(jsonValue).optional(),
    hidden: z.boolean().optional(),
    dataSource: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/, { message: "must be a data source id, like “shopify-products”." })
      .optional()
      .describe("Pick the value from a plugin's data source (a product, a collection). The file keeps a plain string."),
    get of() {
      return fieldConfig.optional();
    },
    get fields() {
      return z.array(fieldConfig).optional();
    },
    get blocks() {
      return z
        .array(
          z
            .object({
              type: z.string().min(1),
              label: z.string().optional(),
              description: z.string().optional(),
              count: z.number().optional(),
              example: z.record(z.string(), jsonValue).optional(),
              thumbnail: z.string().min(1).optional().describe("A picture of this section, repo-relative, shown in the section palette."),
              fields: z.array(fieldConfig).optional(),
            })
            .strict()
        )
        .optional();
    },
  })
  .strict();

const collectionConfig = z
  .object({
    id: z.string().min(1).describe("Matches a detected collection to adjust it, or adds a new one."),
    label: z.string().optional(),
    singular: z.string().optional(),
    description: z.string().optional(),
    kind: z.enum(["entries", "data"]).optional(),
    path: z.string().optional().describe("Folder (entries) or file (data), relative to the repository root."),
    pattern: z.string().optional(),
    format: z.enum(FORMATS).optional(),
    body: z.boolean().optional(),
    url: z.string().nullable().optional().describe('Public URL pattern with {slug}, e.g. "/blog/{slug}/". null = no page of its own.'),
    titleField: z.string().optional(),
    dateField: z.string().optional(),
    imageField: z.string().optional(),
    draftField: z.string().optional(),
    create: z.boolean().optional(),
    hidden: z.boolean().optional(),
    fields: z.array(fieldConfig).optional(),
  })
  .strict();

const templateConfig = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/i, { message: "must be letters, digits and dashes, like “landing-page”." }),
    label: z.string().min(1),
    description: z.string().optional(),
    collection: z.string().min(1).describe("The collection a new entry made from it goes in."),
    file: z.string().min(1).describe("The template file, repo-relative, in the same format as that collection's entries."),
    thumbnail: z.string().min(1).optional().describe("A picture of the finished page, repo-relative."),
  })
  .strict();

const mediaRoot = z.object({ dir: z.string().min(1), publicPath: z.string().min(1) }).strict();

/** An https:// address (http:// only for this computer, which the engine allows only when not hosted). */
const webAddress = z.string().url().refine((value) => /^https:\/\//i.test(value) || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(value), { message: "must start with https://." });

/** Ids only: the access key and its secret are kept in the site's key store, never in this file. */
const mediaStorage = z
  .object({
    connector: z.string().regex(ADAPTER_ID, { message: "must be a connector id, like “r2”, “s3” or “s3-compatible”." }).describe("Which kind of bucket: “r2” (Cloudflare R2), “s3” (Amazon S3), or “s3-compatible” (another S3-compatible store)."),
    bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, { message: "must be a bucket name: 3 to 63 lowercase letters, digits, dots and dashes." }).describe("The bucket's name."),
    account: z.string().max(64).optional().describe("Cloudflare R2: the account ID the bucket is in."),
    region: z.string().max(40).optional().describe("Amazon S3: the bucket's Region code (“eu-west-1”). S3-compatible: the store's region name."),
    endpoint: webAddress.optional().describe("The store's S3 address. S3-compatible stores, and R2 buckets in a jurisdiction. https:// only."),
    pathStyle: z.boolean().optional().describe("The bucket name in the path (address/bucket/key) rather than the host name. Default: true except for Amazon S3."),
    prefix: z.string().max(200).optional().describe("The folder inside the bucket this site's files are kept under (“lowfield/”). Absent: the bucket's top."),
    publicUrl: webAddress.describe("Where visitors load the files from (“https://media.example.com”). Pages store full addresses under it."),
  })
  .strict()
  .describe("New media goes to this bucket instead of the repository. Set by Media › Storage (or `galley media connect`).");

/** Ids only: the API token is kept in the site's key store, never in this file. */
const mediaImages = z
  .object({
    connector: z.literal("cloudflare-images").describe("Cloudflare Images."),
    account: z.string().regex(/^[0-9a-f]{32}$/, { message: "must be the 32-character Cloudflare account ID." }).describe("The Cloudflare account ID."),
    accountHash: z.string().min(8).max(64).describe("The Images account hash, from Hosted Images › Developer Resources."),
    scope: z.string().regex(/^[a-z0-9-]{8,64}$/, { message: "must be the mark Galley made: lowercase letters, digits and dashes." }).optional().describe("This site's mark on its pictures in the account (Cloudflare's creator field); made by Galley when connecting. Only pictures with it are listed, shown, moved or deleted."),
    variant: z.string().regex(/^[A-Za-z0-9_-]{1,99}$/, { message: "must be a variant's name, like “public”." }).optional().describe("The variant pages ask for. Default: public."),
    deliveryUrl: webAddress.optional().describe("Deliver from a domain of the same Cloudflare account (its /cdn-cgi/imagedelivery/ path). Default: https://imagedelivery.net."),
  })
  .strict()
  .describe("Pictures go to Cloudflare Images instead; files it doesn't take go to `media.storage`, else the repository.");

/** Project names both built-in hosts accept, short enough for a preview address label (`<8 chars>-<name>`). */
const DEPLOY_PROJECT = /^[a-z0-9](?:[a-z0-9-]{0,52}[a-z0-9])?$/;

const deployConfig = z
  .object({
    target: z.string().regex(ADAPTER_ID, { message: "must be a host id, like “cloudflare” or “vercel”." }),
    account: z.string().min(1).max(100),
    project: z.string().regex(DEPLOY_PROJECT, { message: "must be lowercase letters, digits and dashes (up to 54), like “my-site”." }),
    productionUrl: z.string().url().optional(),
    defaultUrl: z.string().url().optional(),
    domain: z
      .object({
        hostname: z.string().regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, { message: "must be a host name like “www.example.com”." }),
        attached: z.boolean(),
        pending: z.boolean().optional(),
      })
      .strict()
      .optional(),
    autoDeploy: z.boolean().optional(),
    previewOnShare: z.boolean().optional(),
  })
  .strict();

/**
 * Where the site's editor is hosted ("Host the editor online"): its address
 * and the host's id. Written by the app once the hosted editor has the site;
 * no secrets, safe to publish with the site.
 */
const editorConfig = z
  .object({
    url: z
      .string()
      .url()
      .regex(/^https:\/\/[^/?#]+\/?$/, { message: "must be the editor's https:// address, with nothing after the name, like “https://cms.example.com”." })
      .describe("The editor's address, like https://cms.example.com."),
    host: z.string().regex(ADAPTER_ID, { message: "must be a host id, like “fly”, “cloudflare” or “own-server”." }).optional().describe("Where it is hosted: fly, cloudflare, own-server, or a plugin's host."),
  })
  .strict();

const redirectsConfig = z
  .object({
    file: z
      .string()
      .regex(/^(?!\/)(?!.*\.\.)[^\\]+\.json$/, { message: "must be a JSON file inside the site, like “src/data/redirects.json”." })
      .optional()
      .describe("The redirects list, relative to the repository root. Default: beside the site's data files."),
    host: z.enum(["cloudflare", "netlify", "vercel", "other"]).optional().describe("Where the site is served from, when `deploy` doesn't say. Decides which redirect file is generated."),
    cloudflare: z
      .object({
        account: z.string().min(1).max(100).optional(),
        hostnames: z.array(z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, { message: "must be a domain name, like “www.example.com”." })).max(20).optional(),
      })
      .strict()
      .optional()
      .describe("Setting the redirects on Cloudflare itself (Bulk Redirects): the account and the site's own domains. Ids only."),
  })
  .strict();

export const galleyConfigSchema = z
  .object({
    $schema: z.string().optional(),
    name: z.string().optional(),
    framework: z
      .string()
      .regex(ADAPTER_ID, { message: "must be an adapter id: lowercase letters, digits and dashes, like “astro” or “eleventy”." })
      .optional()
      .describe(FRAMEWORK_DESCRIPTION),
    adapters: z.array(z.string().min(1)).optional().describe(ADAPTERS_DESCRIPTION),
    plugins: z.array(z.string().min(1)).optional().describe(PLUGINS_DESCRIPTION),
    dev: z
      .object({
        command: z.string().optional(),
        port: z.number().int().positive().optional(),
        trustPort: z
          .boolean()
          .optional()
          .describe(
            "Take whatever answers on the dev server's port for the dev server, without checking which program on the computer has it. For a dev command that runs its server where Galley can't see it as its own, such as a container. Only an owner can set it (it switches a safety check off)."
          ),
      })
      .strict()
      .optional(),
    build: z.object({ command: z.string().optional(), outDir: z.string().optional(), sources: z.array(z.string()).optional() }).strict().optional(),
    urls: z.object({ production: z.string().url().optional(), staging: z.string().url().optional() }).strict().optional(),
    media: z.object({ dir: z.string().optional(), publicPath: z.string().optional(), roots: z.array(mediaRoot).optional(), storage: mediaStorage.optional(), images: mediaImages.optional() }).strict().optional(),
    publish: z
      .object({ branch: z.string().optional(), mode: z.enum(["commit", "pull-request"]).optional(), remote: z.string().nullable().optional(), push: z.boolean().optional() })
      .strict()
      .optional(),
    ai: z.object({ instructions: z.array(z.string()).optional(), allowBuild: z.boolean().optional() }).strict().optional(),
    writable: z.object({ content: z.array(z.string()).optional(), build: z.array(z.string()).optional() }).strict().optional(),
    collections: z.array(collectionConfig).optional(),
    templates: z.array(templateConfig).optional().describe("Ready-made entries to start a new one from (a landing page, a pricing page)."),
    deploy: deployConfig.optional().describe("Where the site is put online. Ids only: the host's access key is kept in the app's secrets, never in this file."),
    redirects: redirectsConfig.optional().describe("Where the redirects list lives and which host applies it. See the redirects guide."),
    editor: editorConfig.optional().describe("Where this site's editor is hosted online, when it has one. An address and the host's id: no secrets, safe to publish."),
    siteBrand: z
      .object({
        dir: z.string().regex(/^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+$/, { message: "must be a folder inside the site, like “galley/brand”." }).optional(),
        largeFileMB: z.number().min(0).max(1000).optional(),
        tokensFile: z.string().regex(/^(?!\/)(?!.*\.\.)[^\\]+\.(css|scss|less|pcss)$/, { message: "must be a stylesheet inside the site, like “src/styles/tokens.css”." }).optional(),
      })
      .strict()
      .optional()
      .describe("The site's own brand (look and voice): where its files live, the size above which added material stays out of the repository, and the stylesheet that holds its design values. See the brand guide."),
  })
  .strict()
  .superRefine((config, ctx) => {
    const seen = new Set<string>();

    (config.templates ?? []).forEach((template, index) => {
      if (seen.has(template.id)) ctx.addIssue({ code: "custom", path: ["templates", index, "id"], message: `“${template.id}” is used by another template too.` });
      seen.add(template.id);
    });
  });

function where(path: PropertyKey[]): string {
  if (path.length === 0) return "The config";
  return path.reduce<string>((out, segment) => (typeof segment === "number" ? `${out}[${segment}]` : out ? `${out}.${String(segment)}` : String(segment)), "");
}

/** Turns zod issues into sentences: `collections[1].format: must be one of markdown, mdx, …`. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const at = where(issue.path);

    switch (issue.code) {
      case "unrecognized_keys":
        return `${at}: “${issue.keys.join("”, “")}” ${issue.keys.length === 1 ? "is not a setting" : "are not settings"} ${PRODUCT.name} knows.`;
      case "invalid_value":
        return `${at}: must be one of ${issue.values.map((value) => JSON.stringify(value)).join(", ")}.`;
      case "invalid_type":
        // zod does not echo the input back, but its message says when nothing was given.
        return /received undefined/.test(issue.message) ? `${at}: is required.` : `${at}: should be ${issue.expected === "array" ? "a list" : `a ${issue.expected}`}.`;
      case "invalid_format":
        if (issue.format === "regex") return `${at}: ${issue.message}`;
        return `${at}: should be a valid ${issue.format === "url" ? "web address (https://…)" : issue.format}.`;
      case "too_small":
        return `${at}: must not be empty.`;
      default:
        return `${at}: ${issue.message}`;
    }
  });
}

export function validateConfig(value: unknown): { ok: true; config: GalleyConfig } | { ok: false; errors: string[] } {
  const result = galleyConfigSchema.safeParse(value);

  if (result.success) return { ok: true, config: result.data as GalleyConfig };
  return { ok: false, errors: describeIssues(result.error) };
}

export { CONFIG_SCHEMA_URL };

export function configJsonSchema(): object {
  const schema = z.toJSONSchema(galleyConfigSchema, { unrepresentable: "any" }) as Record<string, unknown>;
  const properties = schema.properties as Record<string, unknown> | undefined;

  // Editors autocomplete an enum, so list the built-in ids while still accepting any adapter's.
  if (properties) {
    properties.framework = { description: FRAMEWORK_DESCRIPTION, anyOf: [{ enum: [...KNOWN_FRAMEWORKS] }, { type: "string", pattern: ADAPTER_ID.source }] };
  }
  return { ...schema, $id: CONFIG_SCHEMA_URL, title: `${PRODUCT.name} site configuration`, description: `Optional corrections and additions to what ${PRODUCT.name} detects in a site.` };
}
