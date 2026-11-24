/**
 * Plugins in the words people read: where one came from, what it adds (and
 * where in the app that shows up), its problems as plain sentences, and a
 * secret's status. Pure, so it is tested without a screen.
 */
import type { PluginConflict, PluginContributions, PluginInfo, PluginSettingInfo, PluginSource } from "@galley/core/types";
import { count, joinWords } from "@/lib/format";

export const SOURCE_WORDS: Record<PluginSource, string> = {
  builtin: "Comes with the app",
  user: "Added on this computer",
  site: "Named by this site",
};

/** In hosted mode the app runs on a server, not "this computer". */
export function sourceWords(source: PluginSource, hosted: boolean): string {
  if (source === "user" && hosted) return "Added on this server";
  return SOURCE_WORDS[source];
}

/** One thing a plugin adds, as a line, and where it shows up in the app (none when it has no screen). */
export interface ContributionLine {
  kind: keyof PluginContributions;
  text: string;
  /** App path; absent when the thing has no screen (adapters, hooks) or needs a site and none is at hand. */
  to?: string;
  /** Where the link goes, for its tooltip and screen readers. */
  where?: string;
}

/** Names inline when they fit; "and N more" when they don't. */
function named(names: readonly string[], limit = 3): string {
  if (names.length <= limit) return joinWords([...names]);
  return `${names.slice(0, limit).join(", ")} and ${names.length - limit} more`;
}

const HOOK_WORDS: Record<string, string> = {
  beforePublish: "checks each publish first",
  afterPublish: "runs after each publish",
  afterDeploy: "runs after each time the site is put online",
  onSubmission: "runs on each form submission",
};

/**
 * "2 image generators: OpenRouter and Pictures", "3 assistant tools", each
 * pointed at the screen where it appears. `siteId` is the site whose screens
 * the site-wide things (forms, scripts, the assistant, hosting) link to.
 */
export function contributionLines(contributes: PluginContributions, siteId: string | null): ContributionLine[] {
  const lines: ContributionLine[] = [];
  const site = siteId ? `/sites/${siteId}` : null;
  const add = (kind: keyof PluginContributions, names: readonly string[], one: string, many: string, link?: { to: string; where: string } | null, withNames = true) => {
    if (names.length === 0) return;
    const head = count(names.length, one, many);
    lines.push({ kind, text: withNames ? `${head}: ${named(names)}` : head, ...(link ? link : {}) });
  };

  add("imageProviders", contributes.imageProviders, "image generator", "image generators", { to: "/settings#images", where: "App settings › Images" });
  add("videoProviders", contributes.videoProviders, "video generator", "video generators", { to: "/settings#videos", where: "App settings › Videos" });
  add("formProviders", contributes.formProviders, "form destination", "form destinations", site ? { to: `${site}/forms`, where: "Forms" } : null);
  add("scriptIntegrations", contributes.scriptIntegrations, "script", "scripts", site ? { to: `${site}/scripts`, where: "Scripts › Add a script" } : null);
  add("importers", contributes.importers, "importer", "importers");
  add("deployTargets", contributes.deployTargets, "host to put sites online", "hosts to put sites online", site ? { to: `${site}/online`, where: "Online" } : null);
  add("adapters", contributes.adapters, "kind of site it can read", "kinds of site it can read");
  add("tools", contributes.tools.map((tool) => tool.title), "assistant tool", "assistant tools", site ? { to: `${site}/edit`, where: "the assistant" } : null, false);
  add("dataSources", contributes.dataSources ?? [], "data source for fields", "data sources for fields");
  const hooks = contributes.hooks.map((hook) => HOOK_WORDS[hook] ?? `runs on “${hook}”`);
  if (hooks.length) lines.push({ kind: "hooks", text: `${hooks.length === 1 ? "A step that" : "Steps that"} ${joinWords(hooks)}` });
  return lines;
}

/** Whether a plugin adds anything at all (a broken one adds nothing). */
export function addsAnything(contributes: PluginContributions): boolean {
  return Object.values(contributes).some((list) => (list?.length ?? 0) > 0);
}

/**
 * The engine's problem sentences, made plain: the "<location>: " lead and
 * anything in parentheses (an error message, an environment variable) move
 * to the technical detail; the sentence that is left starts with a capital.
 */
export function plainProblem(problem: string, plugin: Pick<PluginInfo, "name" | "location">): { plain: string; detail: string | null } {
  let text = problem.trim();
  for (const lead of [plugin.name, plugin.location].filter((value): value is string => Boolean(value))) {
    if (text.startsWith(`${lead}: `)) text = text.slice(lead.length + 2);
  }
  // Parenthesised detail (one level of nesting): "It couldn't start (TypeError: x is not a function), so …".
  text = text.replace(/\s*\([^()]*(?:\([^()]*\)[^()]*)*\)/g, "");
  text = text.replace(/\s+([,.;])/g, "$1").replace(/\s{2,}/g, " ").trim();
  const plain = text ? text.charAt(0).toUpperCase() + text.slice(1) : problem;
  // The full sentence goes behind "Technical details" only when something was taken out of it.
  return { plain, detail: plain.toLowerCase() !== problem.trim().toLowerCase() ? problem : null };
}

const CONFLICT_WORDS: Record<PluginConflict["kind"], string> = {
  adapter: "kind of site",
  imageProvider: "image generator",
  videoProvider: "video generator",
  formProvider: "form destination",
  scriptIntegration: "script",
  importer: "importer",
  deployTarget: "host",
  editorHost: "place to host the editor",
  tool: "assistant tool",
  dataSource: "data source for fields",
};

/** "Both Harbour tools and Example plugin add the script “fathom”. Harbour tools’s is used." — said on the plugin that lost. */
export function conflictSentence(conflict: PluginConflict, nameOf: (plugin: string) => string): string {
  const used = nameOf(conflict.used);
  const others = joinWords(conflict.ignored.map(nameOf));
  return `${others} and ${used} both add the ${CONFLICT_WORDS[conflict.kind]} “${conflict.id}”. The one from ${used} is used.`;
}

/** The conflicts a plugin is part of, from its own side: won or lost. */
export function conflictsOf(name: string, conflicts: readonly PluginConflict[]): { lost: PluginConflict[]; won: PluginConflict[] } {
  return {
    lost: conflicts.filter((conflict) => conflict.ignored.includes(name)),
    won: conflicts.filter((conflict) => conflict.used === name),
  };
}

/** A secret's state in one line, never its value: "Set · ends in 4f2a". */
export function secretLine(setting: PluginSettingInfo): string {
  if (!setting.configured) return setting.required ? "Not set — needed" : "Not set";
  const end = setting.hint ? ` · ends in ${setting.hint}` : "";
  return setting.source === "env" ? `Set by this computer’s environment${end}` : `Set${end}`;
}

/** Whether a value would be accepted, and the plain sentence when it wouldn't. */
export function settingProblem(setting: PluginSettingInfo, value: string): string | null {
  const text = value.trim();
  if (!text) return setting.required ? `${setting.label} is needed.` : null;
  if (!setting.pattern) return null;
  let pattern: RegExp;
  try {
    pattern = new RegExp(setting.pattern);
  } catch {
    // The server checks again; a pattern the browser can't read isn't the person's problem.
    return null;
  }
  const article = /^[aeiou]/i.test(setting.label) ? "an" : "a";
  return pattern.test(text) ? null : `That doesn’t look like ${article} ${setting.label}${setting.placeholder ? ` — it looks like ${setting.placeholder}` : ""}`.replace(/…?$/, (end) => (end ? "…" : "."));
}

/** Settings the plugin needs that aren't there yet — why an enabled plugin may still do nothing. */
export function missingSettings(plugin: Pick<PluginInfo, "settings">): PluginSettingInfo[] {
  return plugin.settings.filter((setting) => setting.required && !setting.configured);
}

/** Sort for the list: what needs attention first, then the built-ins, then by name. */
export function sortPlugins(plugins: readonly PluginInfo[]): PluginInfo[] {
  const rank = (plugin: PluginInfo) => (plugin.problems.length ? 0 : plugin.source === "builtin" ? 1 : plugin.source === "user" ? 2 : 3);
  return [...plugins].sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName));
}

/** The command that installs a plugin for this computer, quoted where the shell needs it. */
export function addCommand(slug: string, name = "<name>"): string {
  const safe = /^[@\w./:<>-]+$/.test(name) ? name : `'${name.replace(/'/g, "'\\''")}'`;
  return `${slug} plugin add ${safe}`;
}
