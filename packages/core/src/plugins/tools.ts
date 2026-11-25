/**
 * Plugin tools as registry tools: the small JSON Schema a plugin declares
 * becomes the engine's own zod validator (so the assistant and MCP validate
 * and describe it exactly like a built-in tool), and the declared effect is
 * enforced on the site the tool is handed.
 */
import { z } from "zod";
import { GalleyError } from "../errors";
import type { AssistantTool, ToolContext, ToolOutcome } from "../ai/tools/types";
import { json } from "../ai/tools/types";
import type { AgentMode, Checkpoint, PreviewController, SiteService, WriteOptions } from "../types";
import type { PluginContext, SiteToolContribution, ToolCallContext, ToolInputProperty, ToolInputSchema } from "./types";

function propertySchema(property: ToolInputProperty): z.ZodType {
  let schema: z.ZodType;

  switch (property.type) {
    case "string": {
      if (property.enum?.length) {
        schema = z.enum(property.enum as [string, ...string[]]);
        break;
      }
      let text = z.string();

      if (property.minLength !== undefined) text = text.min(property.minLength);
      if (property.maxLength !== undefined) text = text.max(property.maxLength);
      if (property.pattern !== undefined) text = text.regex(new RegExp(property.pattern));
      schema = text;
      break;
    }
    case "number":
    case "integer": {
      let number = property.type === "integer" ? z.number().int() : z.number();

      if (property.minimum !== undefined) number = number.min(property.minimum);
      if (property.maximum !== undefined) number = number.max(property.maximum);
      schema = number;
      break;
    }
    case "boolean":
      schema = z.boolean();
      break;
    case "array": {
      let list = z.array(propertySchema(property.items));

      if (property.minItems !== undefined) list = list.min(property.minItems);
      if (property.maxItems !== undefined) list = list.max(property.maxItems);
      schema = list;
      break;
    }
    case "object":
      schema = objectSchema({ type: "object", properties: property.properties, ...(property.required ? { required: property.required } : {}) });
      break;
  }
  return property.description ? schema.describe(property.description) : schema;
}

/** The engine's validator for a plugin tool's declared input. */
export function objectSchema(input: ToolInputSchema): z.ZodObject {
  const required = new Set(input.required ?? []);
  const shape: Record<string, z.ZodType> = {};

  for (const [key, property] of Object.entries(input.properties)) {
    const schema = propertySchema(property);

    shape[key] = required.has(key) ? schema : schema.optional();
  }
  return z.object(shape);
}

const WRITES = new Set(["updateEntry", "createEntry", "deleteEntry", "writeFile", "deleteFile", "saveMedia", "saveConfig", "discard", "publish", "send", "revert", "pull", "catchUp", "build", "checkpoint"]);

/**
 * The site a tool is handed: a read-only tool gets one that refuses every
 * write; any other tool's file writes are made in the call's mode, whatever
 * the tool asks for — SiteService enforces the mode again underneath.
 */
/** What a plugin's site never has: closing it (the app closes sites), and what the open site carries for the registry. */
const WITHHELD_FROM_PLUGINS = new Set<string>(["dispose", "snapshot", "previewHandle", "liveUrl", "undoOffered", "isClosed", "letGoOfStaleCheckpoints"]);

/**
 * A checkpoint as a plugin is handed it: its public members only, each going
 * to the engine's own. What the engine's object carries for its own use is not
 * on it (offering it as an Undo that keeps the site open is the engine's).
 */
function publicCheckpoint(checkpoint: Checkpoint): Checkpoint {
  // What each member answers is the plugin's own copy, never an object the engine goes on using.
  return Object.freeze({
    id: checkpoint.id,
    paths: () => [...checkpoint.paths()],
    run: <T>(work: () => T) => checkpoint.run(work),
    close: () => checkpoint.close(),
    restore: () => checkpoint.restore().then((paths) => [...paths]),
    left: () => [...checkpoint.left()],
    release: () => checkpoint.release().then(() => undefined),
  });
}

/** The site's preview as a plugin is handed it: its four public members; one that only reads can't start, stop or restart it. */
function scopedPreview(preview: PreviewController, scope: { readOnly: boolean; name: string; refusal?: string }): PreviewController {
  const refuse = () => Promise.reject(new GalleyError("forbidden", scope.refusal ?? `The tool “${scope.name}” said it only reads, so it can't change the site.`));

  // Answers are the plugin's own copies: a status, or a new promise, never the engine's own.
  return Object.freeze({
    status: () => structuredClone(preview.status()),
    start: scope.readOnly ? refuse : () => preview.start().then((status) => structuredClone(status)),
    stop: scope.readOnly ? refuse : () => preview.stop().then(() => undefined),
    restart: scope.readOnly ? refuse : () => preview.restart().then((status) => structuredClone(status)),
  });
}

export function scopedSite(site: SiteService, scope: { readOnly: boolean; mode: AgentMode; name: string; refusal?: string }): SiteService {
  /** A member as the plugin may use it: refused, scoped, or the site's own bound to it. */
  const member = (target: SiteService, property: PropertyKey, value: unknown): unknown => {
      // The engine's own members (keyed by a symbol) are not a plugin's, whatever its scope.
      if (typeof property !== "string" || WITHHELD_FROM_PLUGINS.has(property)) return undefined;
      if (typeof value !== "function") return value;
      if (scope.readOnly && WRITES.has(property)) {
        return () => Promise.reject(new GalleyError("forbidden", scope.refusal ?? `The tool “${scope.name}” said it only reads, so it can't change the site.`));
      }
      if (property === "writeFile" || property === "deleteFile") {
        return (path: string, ...rest: unknown[]) => {
          const options = (property === "writeFile" ? rest[1] : rest[0]) as WriteOptions | undefined;
          const forced: WriteOptions = { ...(options ?? { origin: "agent" }), mode: scope.mode, origin: "agent" };

          return property === "writeFile" ? target.writeFile(path, rest[0] as string | Uint8Array, forced) : target.deleteFile(path, forced);
        };
      }
      if (property === "updateEntry" || property === "createEntry" || property === "deleteEntry") {
        // The assistant's, whatever the plugin says: in a content conversation its writes are held below build level
        // (site/content-code.ts), and a plugin can't step out of that by calling itself the person.
        return (first: unknown, ...rest: unknown[]) => {
          const at = property === "updateEntry" ? 1 : 0;
          const options = { ...((rest[at] as Record<string, unknown> | undefined) ?? {}), origin: "agent", mode: scope.mode };
          const args = [...rest];

          args[at] = options;
          return (target[property] as (...args: unknown[]) => unknown).call(target, first, ...args);
        };
      }
      if (property === "saveConfig") {
        // The plugin may say which version its settings were made from; the mode is the scope's, whatever it sends.
        return (config: Parameters<SiteService["saveConfig"]>[0], options?: { baseHash?: string }) => target.saveConfig(config, { ...(options?.baseHash ? { baseHash: options.baseHash } : {}), mode: scope.mode });
      }
      if (property === "build") return () => target.build({ mode: scope.mode });
      if (property === "checkpoint") return (label: string) => publicCheckpoint(target.checkpoint(label));
      if (property === "preview") return () => scopedPreview(target.preview(), scope);
      return (value as (...args: unknown[]) => unknown).bind(target);
  };

  return new Proxy(site, {
    get: (target, property, receiver) => member(target, property, Reflect.get(target, property, receiver)),
    // Looked at another way, a member is the same scoped one; and the site itself can't be changed through it.
    getOwnPropertyDescriptor(target, property) {
      const described = Reflect.getOwnPropertyDescriptor(target, property);

      if (!described || !("value" in described)) return described;
      return { ...described, value: member(target, property, described.value) };
    },
    has: (target, property) => (typeof property !== "string" || WITHHELD_FROM_PLUGINS.has(property) ? false : Reflect.has(target, property)),
    ownKeys: (target) => Reflect.ownKeys(target).filter((key) => typeof key === "string" && !WITHHELD_FROM_PLUGINS.has(key)),
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
    setPrototypeOf: () => false,
    preventExtensions: () => false,
  });
}

export interface ToolBinding {
  pluginName: string;
  tool: SiteToolContribution;
  /** Builds the plugin's context for one call (settings are read fresh). */
  context(): Promise<PluginContext>;
  /** Reports a failure against the plugin, scrubbed. */
  report(message: string): void;
}

/** A plugin tool, shaped as a registry tool. */
export function adaptTool(binding: ToolBinding): AssistantTool {
  const { tool } = binding;
  const input = objectSchema(tool.input);

  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    input,
    mode: tool.mode === "build" ? "build" : "any",
    effect: {
      readOnly: tool.effect.readOnly,
      destructive: !tool.effect.readOnly && Boolean(tool.effect.destructive),
      idempotent: tool.effect.idempotent ?? tool.effect.readOnly,
      openWorld: Boolean(tool.effect.openWorld),
    },
    label(args) {
      return tool.label?.(args as Record<string, unknown>) ?? tool.title;
    },
    async run(args, ctx: ToolContext): Promise<ToolOutcome> {
      const base = await binding.context();

      // The switch is read again for every call: a list made before it was turned off must not still work.
      if (tool.enabledBy && !/^(on|yes|true|1)$/i.test(base.settings[tool.enabledBy]?.trim() ?? "")) {
        return {
          content: `“${tool.title}” is switched off in the plugin's settings, so it didn't run. Tell the person it has to be switched on there first.`,
          isError: true,
          doneLabel: "Switched off in settings",
        };
      }
      const call: ToolCallContext = {
        ...base,
        site: scopedSite(ctx.site, { readOnly: tool.effect.readOnly, mode: ctx.mode, name: tool.title }),
        siteId: ctx.siteId,
        mode: ctx.mode,
        signal: ctx.signal,
      };
      let result: Awaited<ReturnType<SiteToolContribution["run"]>>;

      try {
        result = await tool.run(args as Record<string, unknown>, call);
      } catch (error) {
        if (error instanceof GalleyError) throw error;
        binding.report(`The tool “${tool.name}” failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
      if (typeof result === "string") return { content: result };
      if (result && typeof result === "object" && !Array.isArray(result) && typeof (result as { content?: unknown }).content === "string") {
        const outcome = result as { content: string; isError?: boolean };

        return { content: outcome.content, ...(outcome.isError ? { isError: true } : {}) };
      }
      return { content: json(result ?? null) };
    },
  };
}
