/**
 * Structural check of a value that should be a GalleyPlugin. Shared by the
 * registry (a plugin that fails is not used, with the reason as its problem)
 * and by the kit's `checkPlugin` (where the same sentences tell the author
 * what to change). Never throws.
 */
import { ADAPTER_ID, validateAdapter } from "../adapter/load";
import { PLUGIN_API_VERSION } from "./define";
import type { GalleyPlugin, ToolInputProperty } from "./types";

export const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
/** "galley-plugin-foo", "@scope/galley-plugin-foo", or a first-party "@galley/plugin-foo". */
export const CONVENTIONAL_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?galley-plugin-[a-z0-9][a-z0-9._~-]*$|^@galley\/plugin-[a-z0-9][a-z0-9._~-]*$/;
export const SETTING_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const TOOL_NAME = /^[a-z][a-z0-9_]{1,63}$/;
export const SECRET_NAME = /^[a-z][a-z0-9_.-]{1,63}$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const CONTRIBUTIONS = ["adapters", "imageProviders", "videoProviders", "formProviders", "scriptIntegrations", "importers", "deployTargets", "editorHosts", "tools", "dataSources", "hooks", "settings", "setup"] as const;
const KNOWN_KEYS = new Set<string>(["name", "displayName", "description", "version", "apiVersion", ...CONTRIBUTIONS]);
const HOOKS = ["beforePublish", "afterPublish", "afterDeploy", "onSubmission"] as const;
const SCRIPT_CATEGORIES = ["tag-manager", "analytics", "advertising", "marketing", "support", "other"];
const CONSENT = ["necessary", "analytics", "marketing", "preferences"];
const PLACEMENTS = ["head", "body-start", "body-end"];

export type PluginCheck = { ok: true; plugin: GalleyPlugin; warnings: string[] } | { ok: false; problems: string[]; warnings: string[] };

export interface ValidateOptions {
  /** Tool names a plugin may not take (the built-in tools). */
  reservedTools?: readonly string[];
  /** The engine's own built-in plugin: its script kinds need no snippet (the site runtime writes them). */
  builtin?: boolean;
}

type Rec = Record<string, unknown>;

const isObject = (value: unknown): value is Rec => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const quote = (value: unknown) => (typeof value === "string" ? `“${value}”` : JSON.stringify(value) ?? String(value));

function checkProperty(property: unknown, at: string, problems: string[], depth = 0): void {
  if (!isObject(property)) {
    problems.push(`${at} should be an object like { "type": "string", "description": "…" }.`);
    return;
  }
  const p = property as Partial<ToolInputProperty> & Rec;

  switch (p.type) {
    case "string":
      if (p.enum !== undefined && (!Array.isArray(p.enum) || p.enum.some((item) => typeof item !== "string") || p.enum.length === 0)) problems.push(`${at}.enum should be a list of strings.`);
      if (p.pattern !== undefined) {
        try {
          new RegExp(String(p.pattern));
        } catch {
          problems.push(`${at}.pattern isn't a regular expression that can be read.`);
        }
      }
      return;
    case "number":
    case "integer":
    case "boolean":
      return;
    case "array":
      if (depth > 4) problems.push(`${at} is nested too deeply; keep inputs to four levels.`);
      else checkProperty(p.items, `${at}.items`, problems, depth + 1);
      return;
    case "object":
      if (depth > 4) {
        problems.push(`${at} is nested too deeply; keep inputs to four levels.`);
        return;
      }
      if (!isObject(p.properties)) {
        problems.push(`${at}.properties should list the object's fields.`);
        return;
      }
      for (const [key, child] of Object.entries(p.properties)) checkProperty(child, `${at}.properties.${key}`, problems, depth + 1);
      if (p.required !== undefined && (!Array.isArray(p.required) || p.required.some((key) => !(String(key) in (p.properties as Rec))))) {
        problems.push(`${at}.required should name properties it declares.`);
      }
      return;
    default:
      problems.push(`${at}.type should be "string", "number", "integer", "boolean", "array" or "object", not ${quote(p.type)}.`);
  }
}

function checkList(plugin: Rec, key: string, problems: string[], each: (item: Rec, at: string) => void): void {
  const value = plugin[key];

  if (value === undefined) return;
  if (!Array.isArray(value)) {
    problems.push(`“${key}” should be a list, or left out.`);
    return;
  }
  value.forEach((item, index) => {
    const at = `${key}[${index}]`;

    if (!isObject(item)) problems.push(`${at} should be an object.`);
    else each(item, at);
  });
}

function uniqueIds(plugin: Rec, key: string, field: string, problems: string[]): void {
  const list = plugin[key];

  if (!Array.isArray(list)) return;
  const seen = new Set<string>();

  for (const item of list) {
    const id = isObject(item) ? item[field] : undefined;

    if (typeof id !== "string") continue;
    if (seen.has(id)) problems.push(`Two ${key} share the ${field} “${id}”; each needs its own.`);
    seen.add(id);
  }
}

const SETTING_KINDS = ["text", "toggle", "select"];

/** A setting's `type` and what each kind needs: a toggle is plain and saves "on"/"off"; a select names its choices. */
function checkSettingKind(field: Rec, at: string, problems: string[]): void {
  if (field.type === undefined) {
    for (const key of ["options", "consequence"]) if (field[key] !== undefined) problems.push(`${at}.${key} is only for a setting with a type (“select” or “toggle”).`);
    return;
  }
  if (typeof field.type !== "string" || !SETTING_KINDS.includes(field.type)) {
    problems.push(`${at}.type should be "text", "toggle" or "select", not ${quote(field.type)}.`);
    return;
  }
  if (field.type !== "text" && field.secret === true) problems.push(`${at} is a secret, so it can only be typed: leave its type out.`);
  if (field.consequence !== undefined && (field.type !== "toggle" || typeof field.consequence !== "string")) problems.push(`${at}.consequence is one sentence of text, for a toggle.`);
  if (field.type === "toggle") {
    if (field.options !== undefined) problems.push(`${at} is a toggle, which is on or off; options are for a select.`);
    if (field.default !== undefined && field.default !== "on" && field.default !== "off") problems.push(`${at}.default should be "on" or "off" for a toggle.`);
  }
  if (field.type === "select") {
    const options = field.options;
    if (!Array.isArray(options) || options.length === 0 || options.some((option) => !isObject(option) || typeof option.value !== "string" || !nonEmpty(option.label))) {
      problems.push(`${at}.options should list the choices, each { value, label }.`);
    } else {
      const values = options.map((option) => (option as Rec).value as string);
      if (new Set(values).size !== values.length) problems.push(`${at}.options has the same value twice.`);
      if (field.default !== undefined && !values.includes(String(field.default))) problems.push(`${at}.default should be one of its options' values.`);
    }
  }
}

function checkFields(fields: unknown, at: string, problems: string[]): void {
  if (!Array.isArray(fields)) {
    problems.push(`${at}.settings should be a list of the settings it asks for (it may be empty).`);
    return;
  }
  fields.forEach((field, index) => {
    if (!isObject(field) || !nonEmpty(field.key) || !nonEmpty(field.label)) problems.push(`${at}.settings[${index}] needs a key and a label.`);
  });
}

/** `label` names the plugin in messages ("./tools/plugin.mjs", "galley-plugin-foo"). */
export function validatePlugin(value: unknown, label = "The plugin", options: ValidateOptions = {}): PluginCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  const done = (): PluginCheck =>
    problems.length === 0
      ? { ok: true, plugin: value as GalleyPlugin, warnings: warnings.map((w) => `${label}: ${w}`) }
      : { ok: false, problems: problems.map((p) => `${label}: ${p}`), warnings: warnings.map((w) => `${label}: ${w}`) };

  if (!isObject(value)) {
    problems.push("it should be an object with a name and apiVersion: 1 (export it as the module's default export, or as `plugin`).");
    return done();
  }
  const plugin = value;

  if (typeof plugin.name !== "string" || !PACKAGE_NAME.test(plugin.name)) {
    problems.push(`its name should be an npm package name like "galley-plugin-example", not ${quote(plugin.name)}.`);
  } else if (!CONVENTIONAL_NAME.test(plugin.name)) {
    warnings.push(`its name “${plugin.name}” doesn't follow the convention "galley-plugin-<name>" (or "@scope/galley-plugin-<name>"), which is how people find plugins.`);
  }
  if (plugin.apiVersion !== PLUGIN_API_VERSION) {
    problems.push(
      typeof plugin.apiVersion === "number"
        ? `it was written for plugin API version ${plugin.apiVersion}, and this engine speaks version ${PLUGIN_API_VERSION}. Update the plugin.`
        : `it needs "apiVersion: ${PLUGIN_API_VERSION}" — the plugin API version it was written for.`
    );
  }
  for (const key of ["displayName", "description", "version"]) {
    if (plugin[key] !== undefined && typeof plugin[key] !== "string") problems.push(`“${key}” should be text, or left out.`);
  }
  for (const key of Object.keys(plugin)) {
    if (!KNOWN_KEYS.has(key)) warnings.push(`“${key}” isn't something a plugin can contribute, so it is ignored.`);
  }

  // settings
  const settingKeys = new Map<string, Rec>();

  checkList(plugin, "settings", problems, (field, at) => {
    if (typeof field.key !== "string" || !SETTING_KEY.test(field.key)) problems.push(`${at}.key should be letters, digits, dashes or underscores, starting with a letter, not ${quote(field.key)}.`);
    else if (settingKeys.has(field.key)) problems.push(`Two settings use the key “${field.key}”.`);
    else settingKeys.set(field.key, field);
    if (!nonEmpty(field.label)) problems.push(`${at} needs a label people will read in the app.`);
    for (const flag of ["secret", "required"]) if (field[flag] !== undefined && typeof field[flag] !== "boolean") problems.push(`${at}.${flag} should be true or false.`);
    if (field.pattern !== undefined) {
      try {
        new RegExp(String(field.pattern));
      } catch {
        problems.push(`${at}.pattern isn't a regular expression that can be read.`);
      }
    }
    if (field.env !== undefined && (!Array.isArray(field.env) || field.env.some((name) => typeof name !== "string" || !ENV_NAME.test(name)))) {
      problems.push(`${at}.env should be a list of environment variable names like "EXAMPLE_API_KEY".`);
    }
    if (field.secretName !== undefined) {
      if (typeof field.secretName !== "string" || !SECRET_NAME.test(field.secretName)) problems.push(`${at}.secretName should be lowercase letters, digits, dots and dashes.`);
      if (field.secret !== true) problems.push(`${at} has a secretName but isn't marked secret: true.`);
    }
    checkSettingKind(field, at, problems);
  });

  const keySetting = (item: Rec, at: string) => {
    if (item.keySetting === undefined) return;
    const field = typeof item.keySetting === "string" ? settingKeys.get(item.keySetting) : undefined;

    if (!field) problems.push(`${at}.keySetting names ${quote(item.keySetting)}, which isn't one of the plugin's settings.`);
    else if (field.secret !== true) problems.push(`${at}.keySetting names “${String(item.keySetting)}”, which should be marked secret: true.`);
  };
  const providerId = (item: Rec, at: string) => {
    if (typeof item.id !== "string" || !ADAPTER_ID.test(item.id)) problems.push(`${at}.id should be lowercase letters, digits and dashes, like "example", not ${quote(item.id)}.`);
    if (!nonEmpty(item.label)) problems.push(`${at} needs a label.`);
    if (typeof item.models !== "function") problems.push(`${at}.models should be a function returning the models to offer.`);
    if (!nonEmpty(item.defaultModel)) problems.push(`${at} needs a defaultModel.`);
    keySetting(item, at);
  };

  checkList(plugin, "adapters", problems, (adapter, at) => {
    const check = validateAdapter(adapter, at);

    if (!check.ok) problems.push(check.problem);
    else warnings.push(...check.warnings);
  });
  checkList(plugin, "imageProviders", problems, (provider, at) => {
    providerId(provider, at);
    if (typeof provider.generate !== "function") problems.push(`${at}.generate should be a function.`);
    for (const flag of ["supportsReferences", "supportsTransparency"]) {
      if (provider[flag] !== undefined && typeof provider[flag] !== "boolean") problems.push(`${at}.${flag} should be true or false.`);
    }
  });
  checkList(plugin, "videoProviders", problems, (provider, at) => {
    providerId(provider, at);
    for (const hook of ["start", "poll", "download"]) if (typeof provider[hook] !== "function") problems.push(`${at}.${hook} should be a function.`);
  });
  checkList(plugin, "formProviders", problems, (provider, at) => {
    if (typeof provider.id !== "string" || !ADAPTER_ID.test(provider.id)) problems.push(`${at}.id should be lowercase letters, digits and dashes, not ${quote(provider.id)}.`);
    if (!nonEmpty(provider.name) || !nonEmpty(provider.description)) problems.push(`${at} needs a name and a description.`);
    checkFields(provider.settings, at, problems);
    if (typeof provider.canImportFields !== "boolean") problems.push(`${at}.canImportFields should be true or false.`);
    if (provider.canImportFields === true && typeof provider.introspect !== "function") {
      warnings.push(`${at} says it can import fields but has no introspect function, so the app can only offer that where the engine itself knows the provider.`);
    }
    for (const hook of ["forward", "introspect"]) if (provider[hook] !== undefined && typeof provider[hook] !== "function") problems.push(`${at}.${hook} should be a function, or left out.`);
  });
  checkList(plugin, "scriptIntegrations", problems, (integration, at) => {
    if (typeof integration.kind !== "string" || !ADAPTER_ID.test(integration.kind)) problems.push(`${at}.kind should be lowercase letters, digits and dashes, not ${quote(integration.kind)}.`);
    if (!nonEmpty(integration.name) || !nonEmpty(integration.description)) problems.push(`${at} needs a name and a description.`);
    if (!SCRIPT_CATEGORIES.includes(String(integration.category))) problems.push(`${at}.category should be one of ${SCRIPT_CATEGORIES.join(", ")}.`);
    if (!CONSENT.includes(String(integration.defaultConsent))) problems.push(`${at}.defaultConsent should be one of ${CONSENT.join(", ")}.`);
    if (!PLACEMENTS.includes(String(integration.defaultPlacement))) problems.push(`${at}.defaultPlacement should be one of ${PLACEMENTS.join(", ")}.`);
    checkFields(integration.settings, at, problems);
    const snippet = integration.snippet;

    if (snippet === undefined && options.builtin) return;
    if (!isObject(snippet) || (!nonEmpty(snippet.src) && !nonEmpty(snippet.inline))) {
      problems.push(`${at}.snippet needs a src (a script address) or inline code — the site can't load the integration without it.`);
    } else {
      const declared = new Set(Array.isArray(integration.settings) ? integration.settings.map((field) => (isObject(field) ? field.key : null)) : []);
      const text = [snippet.src, snippet.inline, ...Object.values(isObject(snippet.attributes) ? snippet.attributes : {})].filter((part) => typeof part === "string").join("\n");

      for (const match of text.matchAll(/\{\{\s*([A-Za-z][\w-]*)\s*\}\}/g)) {
        if (!declared.has(match[1]!)) problems.push(`${at}.snippet uses {{${match[1]}}}, which isn't one of its settings.`);
      }
      if (nonEmpty(snippet.src) && !/^https:\/\//.test(snippet.src)) problems.push(`${at}.snippet.src should start with https://.`);
    }
  });
  checkList(plugin, "importers", problems, (importer, at) => {
    if (typeof importer.id !== "string" || !ADAPTER_ID.test(importer.id)) problems.push(`${at}.id should be lowercase letters, digits and dashes, not ${quote(importer.id)}.`);
    if (!nonEmpty(importer.name) || !nonEmpty(importer.description)) problems.push(`${at} needs a name and a description.`);
    if (!["url", "file", "url-or-file"].includes(String(importer.input))) problems.push(`${at}.input should be "url", "file" or "url-or-file".`);
    if (importer.command !== undefined && (!isObject(importer.command) || typeof importer.command.run !== "function" || typeof importer.command.help !== "string")) {
      problems.push(`${at}.command should be { help, run(argv, io) }, or left out.`);
    }
  });
  checkList(plugin, "deployTargets", problems, (target, at) => {
    if (typeof target.id !== "string" || !ADAPTER_ID.test(target.id)) problems.push(`${at}.id should be lowercase letters, digits and dashes, not ${quote(target.id)}.`);
    if (!nonEmpty(target.name)) problems.push(`${at} needs a name.`);
    if (!isObject(target.info) || !Array.isArray(target.credentials)) problems.push(`${at} needs the setup screen's info and its credentials list.`);
    for (const hook of ["connect", "checkProject", "ensureProject", "deploy"]) if (typeof target[hook] !== "function") problems.push(`${at}.${hook} should be a function.`);
  });
  checkList(plugin, "editorHosts", problems, (host, at) => {
    if (typeof host.id !== "string" || !ADAPTER_ID.test(host.id)) problems.push(`${at}.id should be lowercase letters, digits and dashes, not ${quote(host.id)}.`);
    if (!nonEmpty(host.name)) problems.push(`${at} needs a name.`);
    if (!isObject(host.info) || !Array.isArray(host.info.credentials) || !Array.isArray(host.info.options) || !isObject(host.info.cost)) {
      problems.push(`${at} needs the first screen's info: its credentials, options and cost.`);
    } else if (host.info.kind !== "managed" && host.info.kind !== "self-run") problems.push(`${at}.info.kind should be "managed" or "self-run".`);
    if (!isObject(host.apis)) problems.push(`${at}.apis should name the origins of the APIs it talks to (an empty object when it talks to none).`);
    for (const hook of ["inspect", "plan", "create", "removal", "remove"]) if (typeof host[hook] !== "function") problems.push(`${at}.${hook} should be a function.`);
    for (const hook of ["upgrade", "backup", "pending"]) if (host[hook] !== undefined && typeof host[hook] !== "function") problems.push(`${at}.${hook} should be a function, or left out.`);
  });
  const reserved = new Set(options.reservedTools ?? []);

  checkList(plugin, "tools", problems, (tool, at) => {
    if (typeof tool.name !== "string" || !TOOL_NAME.test(tool.name)) problems.push(`${at}.name should be snake_case letters and digits, like "count_words", not ${quote(tool.name)}.`);
    else if (reserved.has(tool.name)) problems.push(`${at}.name “${tool.name}” is a built-in tool's name. Choose another.`);
    if (!nonEmpty(tool.title) || !nonEmpty(tool.description)) problems.push(`${at} needs a title and a description (the model reads the description to decide when to use it).`);
    if (tool.mode !== "content" && tool.mode !== "build") problems.push(`${at}.mode should be "content" (offered in both modes) or "build" (build mode only).`);
    if (!isObject(tool.effect) || typeof tool.effect.readOnly !== "boolean") problems.push(`${at}.effect should say at least { readOnly: true } or { readOnly: false }.`);
    if (typeof tool.run !== "function") problems.push(`${at}.run should be a function.`);
    if (tool.label !== undefined && typeof tool.label !== "function") problems.push(`${at}.label should be a function, or left out.`);
    if (tool.enabledBy !== undefined) {
      const field = typeof tool.enabledBy === "string" ? settingKeys.get(tool.enabledBy) : undefined;

      if (!field) problems.push(`${at}.enabledBy names ${quote(tool.enabledBy)}, which isn't one of the plugin's settings.`);
      else if (field.secret === true) problems.push(`${at}.enabledBy names “${String(tool.enabledBy)}”, a secret; the switch has to be a plain setting the person can see.`);
      else if (field.type === "select") problems.push(`${at}.enabledBy names “${String(tool.enabledBy)}”, a choice list; the switch has to be a toggle (or a text setting).`);
      else if (field.type === "toggle" && !nonEmpty(field.consequence)) {
        warnings.push(`setting “${String(tool.enabledBy)}” switches on ${quote(tool.name)}; give it a consequence — one sentence on what switching it on lets the assistant do — so the switch reads as a decision.`);
      }
    }
    if (!isObject(tool.input) || tool.input.type !== "object" || !isObject(tool.input.properties)) {
      problems.push(`${at}.input should be { type: "object", properties: { … } }.`);
    } else {
      for (const [key, property] of Object.entries(tool.input.properties)) checkProperty(property, `${at}.input.properties.${key}`, problems);
      if (tool.input.required !== undefined && (!Array.isArray(tool.input.required) || tool.input.required.some((key) => !(String(key) in (tool.input as Rec & { properties: Rec }).properties)))) {
        problems.push(`${at}.input.required should name properties it declares.`);
      }
    }
  });
  checkList(plugin, "dataSources", problems, (source, at) => {
    if (typeof source.id !== "string" || !ADAPTER_ID.test(source.id)) problems.push(`${at}.id should be lowercase letters, digits and dashes, like "store-products", not ${quote(source.id)}.`);
    if (!nonEmpty(source.label)) problems.push(`${at} needs a label people will read in the picker.`);
    for (const fn of ["search", "get"]) if (typeof source[fn] !== "function") problems.push(`${at}.${fn} should be a function.`);
  });
  uniqueIds(plugin, "dataSources", "id", problems);
  uniqueIds(plugin, "imageProviders", "id", problems);
  uniqueIds(plugin, "videoProviders", "id", problems);
  uniqueIds(plugin, "formProviders", "id", problems);
  uniqueIds(plugin, "scriptIntegrations", "kind", problems);
  uniqueIds(plugin, "importers", "id", problems);
  uniqueIds(plugin, "deployTargets", "id", problems);
  uniqueIds(plugin, "editorHosts", "id", problems);
  uniqueIds(plugin, "tools", "name", problems);
  uniqueIds(plugin, "adapters", "id", problems);

  if (plugin.hooks !== undefined) {
    if (!isObject(plugin.hooks)) problems.push("“hooks” should be an object of hook functions.");
    else {
      for (const [hook, fn] of Object.entries(plugin.hooks)) {
        if (!(HOOKS as readonly string[]).includes(hook)) warnings.push(`the hook “${hook}” isn't one the engine calls (${HOOKS.join(", ")}), so it never runs.`);
        else if (typeof fn !== "function") problems.push(`hooks.${hook} should be a function.`);
      }
    }
  }
  if (plugin.setup !== undefined && typeof plugin.setup !== "function") problems.push("“setup” should be a function, or left out.");
  const contributes = CONTRIBUTIONS.some((key) => key !== "settings" && plugin[key] !== undefined && !(Array.isArray(plugin[key]) && (plugin[key] as unknown[]).length === 0));

  if (!contributes) warnings.push("it contributes nothing yet — add an adapter, a provider, a tool, a hook or another contribution.");
  return done();
}

/** The plugin a module exports: its default export, or a named `plugin` export. */
export function pluginFromModule(module: unknown): unknown {
  if (module === null || typeof module !== "object") return module;
  const record = module as Rec;
  let value = record.default ?? record.plugin;

  // A CommonJS module imported from ESM arrives as { default: module.exports }.
  if (isObject(value) && !("apiVersion" in value) && "default" in value) value = value.default;
  return value;
}
