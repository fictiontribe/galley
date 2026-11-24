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
import type { AgentMode, SiteService, WriteOptions } from "../types";
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
export function scopedSite(site: SiteService, scope: { readOnly: boolean; mode: AgentMode; name: string; refusal?: string }): SiteService {
  return new Proxy(site, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;

      if (typeof property !== "string" || typeof value !== "function") return value;
      if (scope.readOnly && WRITES.has(property)) {
        return () => Promise.reject(new GalleyError("forbidden", scope.refusal ?? `The tool “${scope.name}” said it only reads, so it can't change the site.`));
      }
      if (property === "writeFile" || property === "deleteFile") {
        return (path: string, ...rest: unknown[]) => {
          const options = (property === "writeFile" ? rest[1] : rest[0]) as WriteOptions | undefined;
          const forced: WriteOptions = { ...(options ?? { origin: "agent" }), mode: scope.mode, origin: options?.origin ?? "agent" };

          return property === "writeFile" ? target.writeFile(path, rest[0] as string | Uint8Array, forced) : target.deleteFile(path, forced);
        };
      }
      if (property === "saveConfig") {
        return (config: Parameters<SiteService["saveConfig"]>[0]) => target.saveConfig(config, { mode: scope.mode });
      }
      if (property === "build") return () => target.build({ mode: scope.mode });
      return (value as (...args: unknown[]) => unknown).bind(target);
    },
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
