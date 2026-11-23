/**
 * `galley plugin …` — add, list, remove, enable and disable plugins for this
 * computer (or this server). Installed plugins live in `<home>/plugins`;
 * a running app loads them when it starts.
 */
import { PRODUCT } from "@galley/core/brand";
import { createFileSecretStore, createSettingsService } from "@galley/core/ai";
import { BUILTIN_PLUGIN_NAME, installPlugin, readInstalled, removePlugin, setPluginEnabled } from "@galley/core/plugins";
import type { PluginInfo } from "@galley/core/types";
import { createPluginSystem, defaultHome } from "@galley/server";
import { parse, plural, UsageError } from "../args";
import type { Io } from "../io";

export const PLUGIN_HELP = `Usage: ${PRODUCT.slug} plugin <command> [options]

Add plugins to ${PRODUCT.name} on this computer, or turn them on and off.

  ${PRODUCT.slug} plugin list              What is built in and installed, and what each adds
  ${PRODUCT.slug} plugin add <package>     Install a plugin: an npm name, a folder, or a packed .tgz
  ${PRODUCT.slug} plugin remove <name>     Uninstall it
  ${PRODUCT.slug} plugin enable <name>     Turn it on
  ${PRODUCT.slug} plugin disable <name>    Turn it off (it stays installed)

Options
      --json   Print the result as JSON
  -h, --help   Show this help

An installed plugin runs inside ${PRODUCT.name} with your permissions: add only
plugins you trust. npm runs with --ignore-scripts, so installing never runs a
package's own scripts, and the exact version that arrived is kept. A running
app picks up changes when it restarts.`;

function summary(info: PluginInfo): string {
  const c = info.contributes;
  const parts = [
    c.adapters.length && plural(c.adapters.length, "adapter"),
    c.imageProviders.length && `images: ${c.imageProviders.join(", ")}`,
    c.videoProviders.length && `video: ${c.videoProviders.join(", ")}`,
    c.formProviders.length && plural(c.formProviders.length, "form destination"),
    c.scriptIntegrations.length && plural(c.scriptIntegrations.length, "script integration"),
    c.importers.length && `import: ${c.importers.join(", ")}`,
    c.deployTargets.length && `deploy: ${c.deployTargets.join(", ")}`,
    c.tools.length && `tools: ${c.tools.map((tool) => tool.name).join(", ")}`,
    c.hooks.length && `hooks: ${c.hooks.join(", ")}`,
  ].filter(Boolean);

  return parts.join(" · ") || "adds nothing";
}

function where(info: PluginInfo): string {
  return info.source === "builtin" ? "built in" : info.source === "user" ? `installed${info.location ? ` from ${info.location}` : ""}` : "named by the site";
}

async function list(io: Io, home: string, json: boolean): Promise<number> {
  const secrets = createFileSecretStore(home);
  const settings = createSettingsService({ home, env: io.env, secretStore: secrets });
  const plugins = await createPluginSystem({ home, env: io.env, settings, secrets });

  try {
    const infos = await plugins.list(null);
    const conflicts = plugins.conflicts(null);

    if (json) {
      io.out(JSON.stringify({ plugins: infos, conflicts }, null, 2));
      return 0;
    }
    for (const info of infos) {
      const state = !info.enabled ? "off" : info.active ? "on" : "not working";

      io.out(`${info.active || !info.enabled ? "•" : "!"} ${info.name}${info.version ? ` ${info.version}` : ""} — ${state}, ${where(info)}`);
      io.out(`    ${summary(info)}`);
      for (const setting of info.settings.filter((field) => field.required && !field.configured)) io.out(`    needs: ${setting.label}`);
      for (const problem of info.problems) io.out(`    ${problem}`);
    }
    for (const conflict of conflicts) io.out(`! Both ${conflict.used} and ${conflict.ignored.join(", ")} offer “${conflict.id}”; ${conflict.used}'s is used.`);
    return 0;
  } finally {
    await plugins.dispose();
  }
}

export async function pluginCommand(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parse("plugin", argv, { json: { type: "boolean" } }, 2);
  const [action, target] = positionals;

  if (values.help || action === undefined) {
    io.out(PLUGIN_HELP);
    return action === undefined && !values.help ? 2 : 0;
  }
  const home = defaultHome(io.env);
  const json = Boolean(values.json);
  const say = (text: string, data: unknown) => io.out(json ? JSON.stringify(data, null, 2) : text);

  switch (action) {
    case "list":
      if (target !== undefined) throw new UsageError(`\`${PRODUCT.slug} plugin list\` takes no name. Run \`${PRODUCT.slug} plugin --help\`.`);
      return list(io, home, json);
    case "add": {
      if (!target) throw new UsageError(`Say which plugin to add: \`${PRODUCT.slug} plugin add galley-plugin-example\`, a folder, or a .tgz file.`);
      if (!json) io.err(`… installing ${target}`);
      const result = await installPlugin(home, target, { cwd: io.cwd, env: io.env });

      for (const warning of result.warnings) io.err(`! ${warning}`);
      say(`✓ Added ${result.plugin.name} ${result.plugin.version}. It loads the next time ${PRODUCT.name} starts.`, { added: result.plugin, warnings: result.warnings });
      return 0;
    }
    case "remove": {
      if (!target) throw new UsageError(`Say which plugin to remove, by name. \`${PRODUCT.slug} plugin list\` shows them.`);
      if (!(await removePlugin(home, target, { env: io.env }))) {
        io.err(`${target} isn't installed here. \`${PRODUCT.slug} plugin list\` shows what is.`);
        return 1;
      }
      say(`✓ Removed ${target}.`, { removed: target });
      return 0;
    }
    case "enable":
    case "disable": {
      if (!target) throw new UsageError(`Say which plugin to ${action}, by name. \`${PRODUCT.slug} plugin list\` shows them.`);
      const enabled = action === "enable";

      if (!enabled && target === BUILTIN_PLUGIN_NAME) {
        io.err(`${target} is part of the app and can't be turned off.`);
        return 1;
      }
      const known = new Set([...(await readInstalled(home)).map((item) => item.name)]);
      const secrets = createFileSecretStore(home);
      const plugins = await createPluginSystem({ home, env: io.env, settings: createSettingsService({ home, env: io.env, secretStore: secrets }), secrets, installed: false });

      try {
        for (const info of await plugins.list(null)) known.add(info.name);
      } finally {
        await plugins.dispose();
      }
      if (!known.has(target)) {
        io.err(`There is no plugin called ${target} here. \`${PRODUCT.slug} plugin list\` shows them.`);
        return 1;
      }
      await setPluginEnabled(home, target, enabled);
      say(`✓ ${target} is turned ${enabled ? "on" : "off"}. Restart ${PRODUCT.name} if it is running.`, { name: target, enabled });
      return 0;
    }
    default:
      throw new UsageError(`“${action}” isn't a plugin command. Run \`${PRODUCT.slug} plugin --help\`.`);
  }
}
