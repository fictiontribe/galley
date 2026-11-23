/**
 * The generated parts of docs/mcp.md: the tool reference (from the same
 * catalog the server registers) and the client setup snippets (from the same
 * functions `galley mcp config` prints). A test fails when the document
 * falls behind; `pnpm --filter @galley/mcp docs` rewrites it.
 */
import { z } from "zod";
import { toolCatalog, type CatalogEntry } from "./catalog";
import { clientConfig, CLIENT_TITLES, MCP_CLIENTS, type ConfigRequest } from "./config";
import { harnessTools, type ToolGroup } from "./tools";

const GROUP_TITLES: Record<ToolGroup, string> = {
  orientation: "Orientation",
  content: "Content",
  proof: "Proof",
  publish: "Publish",
  preview: "Preview",
  build: "Build mode only",
};

interface Argument {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

function typeName(schema: Record<string, unknown>): string {
  if (Array.isArray(schema.enum)) return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  const variants = (schema.oneOf ?? schema.anyOf) as Array<Record<string, unknown>> | undefined;

  if (Array.isArray(variants)) {
    // A discriminated union of edits reads best as its kinds: "edit (set | unset | …)".
    const kinds = variants.map((v) => ((v.properties as Record<string, Record<string, unknown>> | undefined)?.op?.const as string | undefined));

    if (kinds.every((kind) => typeof kind === "string")) return `edit (${kinds.join(" | ")})`;
    return variants.map(typeName).join(" or ");
  }
  if (schema.type === "array") return `list of ${typeName((schema.items as Record<string, unknown>) ?? {})}`;
  if (typeof schema.type === "string") return schema.type === "integer" ? "number" : schema.type;
  if (schema.type === undefined && Object.keys(schema).filter((k) => k !== "description").length === 0) return "any";
  return "object";
}

export function argumentsOf(input: z.ZodObject): Argument[] {
  const schema = z.toJSONSchema(input, { target: "draft-7", io: "input" }) as { properties?: Record<string, Record<string, unknown>>; required?: string[] };

  return Object.entries(schema.properties ?? {}).map(([name, prop]) => ({
    name,
    type: typeName(prop),
    required: (schema.required ?? []).includes(name),
    description: typeof prop.description === "string" ? prop.description : "",
  }));
}

function hints(entry: CatalogEntry): string {
  const { effect } = entry;
  const parts = [effect.readOnly ? "read-only" : effect.destructive ? "destructive" : "writes"];

  if (!effect.readOnly && effect.idempotent) parts.push("idempotent");
  if (effect.openWorld) parts.push("open world");
  return parts.join(", ");
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function entryMarkdown(entry: CatalogEntry, note?: string): string[] {
  const args = argumentsOf(entry.input);
  const lines = [`#### \`${entry.name}\` — ${entry.title}`, "", `*${hints(entry)}*${note ? ` · ${note}` : ""}`, "", entry.description, ""];

  if (args.length) {
    lines.push("| Argument | Type | Required | Meaning |", "| --- | --- | --- | --- |");
    for (const arg of args) lines.push(`| \`${arg.name}\` | ${cell(arg.type)} | ${arg.required ? "yes" : "no"} | ${cell(arg.description)} |`);
    lines.push("");
  }
  return lines;
}

/** Every tool any connection can offer, grouped, with its arguments. */
export function toolReference(): string {
  const all = toolCatalog({ mode: "build", allowPublish: true, readOnly: false, images: true, transport: "stdio", sites: "many" });
  const lines: string[] = [];
  let group: ToolGroup | null = null;

  for (const entry of all) {
    if (entry.group !== group) {
      group = entry.group;
      lines.push(`### ${GROUP_TITLES[group]}`, "");
    }
    const note =
      entry.name === "list_sites"
        ? "HTTP only"
        : entry.name === "generate_image"
          ? "only when an image provider is configured"
          : entry.name === "add_media"
            ? "stdio form; over HTTP it takes `data` (base64) and `filename` instead of `file`"
            : entry.group === "publish" && !entry.effect.readOnly
              ? "not listed with publishing turned off"
              : entry.source === "registry"
                ? "shared with the built-in assistant"
                : undefined;

    lines.push(...entryMarkdown(entry, note));
  }
  const http = harnessTools("http").find((tool) => tool.name === "add_media")!;

  lines.push("Over HTTP, `add_media` takes:", "", "| Argument | Type | Required | Meaning |", "| --- | --- | --- | --- |");
  for (const arg of argumentsOf(http.input)) lines.push(`| \`${arg.name}\` | ${cell(arg.type)} | ${arg.required ? "yes" : "no"} | ${cell(arg.description)} |`);
  lines.push("", "Over HTTP every tool also takes an optional `site` (an id or name from `list_sites`), required only while more than one site is open.");
  return lines.join("\n").trimEnd();
}

/** The setup section: every client, stdio then HTTP, with placeholder paths. */
export function setupReference(base: Pick<ConfigRequest, "serverName" | "productName" | "cliName" | "tokenEnv">): string {
  const request = (client: ConfigRequest["client"], transport: ConfigRequest["transport"]): ConfigRequest => ({
    ...base,
    client,
    transport,
    launcher: { command: "node", args: ["/path/to/galley/packages/cli/bin/galley.js"] },
    sitePath: "/path/to/your-site",
    flags: [],
    url: "http://127.0.0.1:4400/mcp",
  });
  const lines: string[] = [];

  for (const client of MCP_CLIENTS) {
    lines.push(`### ${CLIENT_TITLES[client]}`, "");
    for (const transport of ["stdio", "http"] as const) {
      const config = clientConfig(request(client, transport));

      lines.push(`**${transport === "stdio" ? "On this computer (stdio)" : "Over HTTP"}** — ${config.where}`, "");
      lines.push(`\`\`\`${config.kind === "command" ? "sh" : config.kind === "json" ? "json" : "text"}`, config.text, "```", "");
      for (const note of config.notes) lines.push(`> ${note}`, "");
    }
  }
  return lines.join("\n").trimEnd();
}

export function replaceBetween(document: string, marker: string, content: string): string {
  const start = `<!-- generated:${marker} -->`;
  const end = `<!-- /generated:${marker} -->`;
  const from = document.indexOf(start);
  const to = document.indexOf(end);

  if (from === -1 || to === -1 || to < from) throw new Error(`docs/mcp.md is missing the ${start} … ${end} markers.`);
  return `${document.slice(0, from + start.length)}\n${content}\n${document.slice(to)}`;
}
