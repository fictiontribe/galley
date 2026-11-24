/**
 * Input validation. Every body and query is parsed with zod before it
 * reaches the engine; a failure becomes a 400 `invalid` in plain words.
 */
import type { Context } from "hono";
import { z } from "zod";
import { SECRET_NAMES } from "@galley/core/api";
import type {
  AgentMode,
  ChatAttachment,
  CloneSiteRequest,
  CreateEntryInput,
  CreateSiteRequest,
  EditOp,
  EntryQuery,
  ImageGenRequest,
  ImageSaveRequest,
  JsonValue,
  OpenSiteRequest,
  PublishRequest,
  ResolveRequest,
  SecretName,
  SendMessageRequest,
  SettingsPatch,
  SiteBrief,
} from "@galley/core/types";
import { invalid } from "./errors";

function describePath(path: PropertyKey[]): string {
  return path.map((part) => (typeof part === "number" ? `[${part}]` : String(part))).join(".").replace(/\.\[/g, "[");
}

/** One readable sentence for the first problem zod found. */
export function describeIssues(error: z.ZodError): string {
  const issue = error.issues[0];

  if (!issue) return "The request couldn't be read.";
  const where = describePath(issue.path);

  if (issue.code === "invalid_type" && (issue as { input?: unknown }).input === undefined) {
    return where ? `“${where}” is missing.` : "The request is missing its content.";
  }
  if (issue.code === "unrecognized_keys") return `“${issue.keys.join("”, “")}” isn't expected here.`;
  const text = issue.message.replace(/^Invalid input: /, "");

  return where ? `“${where}” isn't right: ${text}.` : `The request isn't right: ${text}.`;
}

export function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw invalid(
      describeIssues(result.error),
      result.error.issues.map((issue) => `${describePath(issue.path) || "(root)"}: ${issue.message}`).join("\n")
    );
  }
  return result.data;
}

export async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();

  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalid("The request body isn't valid JSON.");
  }
}

export async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  return parseWith(schema, await readJson(c));
}

export function query<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  return parseWith(schema, c.req.query());
}

// ─────────────────────────────────────────────────────────────── primitives

const text = z.string();
const nonEmpty = z.string().trim().min(1, "it can't be empty");
/** Repo-relative path. The engine does the containment check; this keeps obvious junk out. */
export const repoPath = z
  .string()
  .min(1, "it can't be empty")
  .max(4096)
  .refine((value) => !value.includes("\0"), "it contains a character paths can't have");
const intFromQuery = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)])
);
const jsonObject = z.record(z.string(), jsonValue);
const fieldPath = z.array(z.union([z.string(), z.number().int().min(0)])).min(1, "it needs at least one key");
const agentMode: z.ZodType<AgentMode> = z.enum(["content", "build"]);

// ─────────────────────────────────────────────────────────────── bodies

export const editOp: z.ZodType<EditOp> = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), path: fieldPath, value: jsonValue }),
  z.object({ op: z.literal("unset"), path: fieldPath }),
  z.object({ op: z.literal("insert"), path: fieldPath, index: z.number().int().min(0), value: jsonValue }),
  z.object({ op: z.literal("move"), path: fieldPath, from: z.number().int().min(0), to: z.number().int().min(0) }),
  z.object({ op: z.literal("remove"), path: fieldPath, index: z.number().int().min(0) }),
  z.object({ op: z.literal("body"), value: text }),
  z.object({ op: z.literal("body-replace"), find: z.string().min(1), replace: text, all: z.boolean().optional() }),
  z.object({ op: z.literal("raw"), value: text }),
]);

export const patchEntryBody = z.object({ ops: z.array(editOp).min(1, "there must be at least one edit"), baseHash: z.string().optional() });

export const createEntryBody: z.ZodType<CreateEntryInput> = z.object({
  collection: nonEmpty,
  slug: nonEmpty,
  data: jsonObject,
  body: z.string().optional(),
  /** A template's id from the site's `templates` (galley.config.json); the engine checks it. */
  template: z.string().trim().min(1).max(200).optional(),
});

export const resolveBody: z.ZodType<ResolveRequest> = z.object({
  // Empty is allowed: it means "no page given", and the whole site is searched alike.
  urlPath: z.string().max(4096),
  text: nonEmpty,
  occurrence: z.number().int().min(0).optional(),
  total: z.number().int().min(1).optional(),
});

export const pathsBody = z.object({ paths: z.array(repoPath).optional() }).optional().transform((value) => value ?? {});

export const writeFileBody = z.object({ content: text, baseHash: z.string().optional(), mode: agentMode.optional() });

export const uploadBody = z.object({
  filename: nonEmpty.max(255),
  directory: repoPath.optional(),
  data: z.string().min(1, "it can't be empty"),
});

const imageAspect = z.enum(["1:1", "16:9", "4:3", "3:2", "9:16", "3:4", "2:3"]);

export const imageGenBody: z.ZodType<ImageGenRequest> = z.object({
  prompt: nonEmpty.max(4000),
  provider: z.string().optional(),
  model: z.string().optional(),
  aspect: imageAspect.optional(),
  count: z.number().int().min(1).max(4).optional(),
  style: z.string().max(1000).optional(),
  referencePaths: z.array(repoPath).max(8).optional(),
  transparent: z.boolean().optional(),
});

export const imageSaveBody: z.ZodType<ImageSaveRequest> = z.object({
  candidateId: nonEmpty,
  directory: repoPath.optional(),
  filename: z.string().trim().min(1).max(200).optional(),
});

export const publishBody: z.ZodType<PublishRequest> = z
  .object({
    message: z.string().max(10_000).optional(),
    paths: z.array(repoPath).optional(),
    mode: z.enum(["commit", "pull-request"]).optional(),
  })
  .optional()
  .transform((value) => value ?? {});

export const revertBody = z.object({ commit: z.string().regex(/^[0-9a-f]{4,64}$/i, "it must be a version id") });

export const loginBody = z.object({ password: z.string().min(1, "it can't be empty").max(1024) });

export const secretBody = z.object({ value: z.string().min(1, "it can't be empty").max(4096).nullable() });

export const secretName: z.ZodType<SecretName> = z.enum(SECRET_NAMES as [SecretName, ...SecretName[]]);

export const settingsPatchBody: z.ZodType<SettingsPatch> = z.object({
  ai: z.object({ model: nonEmpty.optional(), effort: z.enum(["low", "medium", "high", "xhigh"]).optional() }).optional(),
  images: z.object({ provider: z.string().nullable().optional(), model: z.string().nullable().optional() }).optional(),
  videos: z.object({ provider: z.string().max(100).nullable().optional(), model: z.string().max(200).nullable().optional() }).optional(),
  author: z.object({ name: z.string().max(200).optional(), email: z.string().max(320).optional() }).optional(),
  appearance: z.object({ theme: z.enum(["system", "light", "dark"]).optional(), look: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "choose one of the themes listed").optional() }).optional(),
  previews: z.object({ maxRunning: z.number().int().optional(), idleMinutes: z.number().int().optional() }).optional(),
});

export const openSiteBody: z.ZodType<OpenSiteRequest> = z.object({ path: nonEmpty });

export const cloneSiteBody: z.ZodType<CloneSiteRequest> = z.object({
  url: nonEmpty.max(2048).refine((value) => /^(https?:\/\/|ssh:\/\/|git@|[\w.-]+@[\w.-]+:)/i.test(value), "it must be an https or ssh address"),
  branch: z.string().trim().min(1).max(255).optional(),
  directory: z.string().trim().min(1).optional(),
});

const siteBrief: z.ZodType<SiteBrief> = z.object({
  description: nonEmpty.max(10_000),
  audience: z.string().max(2000).optional(),
  tone: z.string().max(2000).optional(),
  pages: z.array(z.string().max(200)).max(50).optional(),
  brandColor: z.string().regex(/^#[0-9a-f]{3,8}$/i, "it must be a hex color like #1a2b3c").optional(),
  notes: z.string().max(10_000).optional(),
});

export const createSiteBody: z.ZodType<CreateSiteRequest> = z.object({
  name: nonEmpty.max(200),
  directory: z.string().trim().min(1).optional(),
  starter: nonEmpty,
  look: z.string().trim().min(1).max(100).optional(),
  brief: siteBrief.optional(),
});

export const createThreadBody = z
  .object({ title: z.string().max(200).optional(), mode: agentMode.optional() })
  .optional()
  .transform((value) => value ?? {});

const attachment: z.ZodType<ChatAttachment> = z.object({
  name: z.string().max(255),
  mime: z.string().max(255),
  dataUrl: z.string().optional(),
  path: z.string().optional(),
  url: z.string().optional(),
});

export const sendMessageBody: z.ZodType<SendMessageRequest> = z.object({
  text: z.string().max(100_000),
  mode: agentMode.optional(),
  context: z
    .object({
      entryPath: z.string().optional(),
      urlPath: z.string().optional(),
      selection: z.object({ text: z.string(), sourcePath: z.string().optional() }).optional(),
    })
    .optional(),
  attachments: z.array(attachment).max(10).optional(),
  brief: siteBrief.optional(),
});

export const undoBody = z.object({ turnId: nonEmpty });

/** A conversation's new name: trimmed, 1–120 characters. */
export const renameThreadBody = z.object({
  title: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, "give the conversation a name").max(120, "keep the name under 120 characters")),
});

// ─────────────────────────────────────────────────────────────── queries

export const pathQuery = z.object({ path: repoPath });

export const rawQuery = z.object({ path: repoPath, rev: z.literal("base").optional() });

export const entriesQuery = z.object({
  collection: nonEmpty,
  search: z.string().optional(),
  status: z.enum(["clean", "added", "modified", "deleted"]).optional(),
  sort: z.enum(["title", "date", "modified"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  offset: intFromQuery(0, 1_000_000).optional(),
  limit: intFromQuery(1, 10_000).optional(),
}) satisfies z.ZodType<{ collection: string } & EntryQuery>;

export const searchQuery = z.object({
  q: nonEmpty,
  collection: z.string().optional(),
  limit: intFromQuery(1, 500).optional(),
});

export const routeQuery = z.object({ url: nonEmpty });

export const filesQuery = z.object({ glob: z.string().max(1000).optional(), limit: intFromQuery(1, 100_000).optional() });

export const historyQuery = z.object({ limit: intFromQuery(1, 1000).optional() });

export const fsListQuery = z.object({ path: z.string().optional() });

/**
 * A path on the site itself: starts with one "/", no scheme, no host, at most
 * 2,048 characters. The query and fragment are dropped — only the page matters.
 */
export const sitePathValue = z
  .string()
  .max(2048, "keep it under 2,048 characters")
  .refine((value) => value.startsWith("/") && !value.startsWith("//") && !/[\\\u0000-\u001f]/.test(value), "it must be a path on the site, starting with /")
  .transform((value) => value.split(/[?#]/)[0] || "/");

export const starterPreviewQuery = z.object({ look: z.string().min(1).max(100).optional() });

export const openQuery = z.object({ root: z.string().min(1).max(4096), url: sitePathValue.optional() });
