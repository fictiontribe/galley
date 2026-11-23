/**
 * Plugins installed for this user or server: `<home>/plugins` is a small npm
 * project of its own (package.json + node_modules) holding them, and
 * `<home>/plugins/installed.json` records what was asked for and the exact
 * version that arrived. npm runs with --ignore-scripts, so installing never
 * runs a package's own install scripts; the plugin's code runs only when
 * the server loads it.
 *
 * Only packages that say they are plugins are accepted: the keyword
 * "galley-plugin" or a "galley" field in their package.json, and a module
 * that exports a valid plugin.
 */
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { packageEntry } from "../adapter/load";
import { PRODUCT } from "../brand";
import { GalleyError } from "../errors";
import { ALL_TOOLS } from "../ai/tools/index";
import type { PluginRegistry } from "./registry";
import { PACKAGE_NAME, pluginFromModule, validatePlugin } from "./validate";

export const PLUGIN_KEYWORD = "galley-plugin";

export interface InstalledPlugin {
  name: string;
  /** The exact version that was installed. */
  version: string;
  /** What was asked for: a package name (and version) or a local folder or tarball. */
  spec: string;
  installedAt: string;
}

export interface InstallOptions {
  /** Where a relative path in the spec is resolved. */
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Runs npm. Test seam; default: the npm on PATH. */
  npm?: (args: string[], cwd: string, env: NodeJS.ProcessEnv) => Promise<{ stdout: string; stderr: string }>;
}

export function pluginsDir(home: string): string {
  return join(home, "plugins");
}

const MANIFEST = "installed.json";

function runNpm(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";

  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { cwd, env, timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024, shell: process.platform === "win32" }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout: String(stdout), stderr: String(stderr) }));
      else resolvePromise({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;

  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, path);
}

export async function readInstalled(home: string): Promise<InstalledPlugin[]> {
  const list = await readJsonFile<{ plugins?: InstalledPlugin[] }>(join(pluginsDir(home), MANIFEST));

  return Array.isArray(list?.plugins) ? list.plugins.filter((item) => typeof item?.name === "string" && PACKAGE_NAME.test(item.name)) : [];
}

async function writeInstalled(home: string, plugins: InstalledPlugin[]): Promise<void> {
  await writeJsonFile(join(pluginsDir(home), MANIFEST), { plugins: [...plugins].sort((a, b) => a.name.localeCompare(b.name)) });
}

async function ensureProject(home: string): Promise<string> {
  const dir = pluginsDir(home);

  await mkdir(dir, { recursive: true });
  if (!existsSync(join(dir, "package.json"))) {
    await writeJsonFile(join(dir, "package.json"), {
      name: `${PRODUCT.slug}-installed-plugins`,
      private: true,
      description: `Plugins installed with \`${PRODUCT.slug} plugin add\`. Managed by the app; edit with its commands.`,
      dependencies: {},
    });
  }
  return dir;
}

/** A local folder or tarball (resolved to an absolute path), or null for a registry package spec. */
function localSource(spec: string, cwd: string): string | null {
  const expanded = spec.startsWith("~/") ? join(homedir(), spec.slice(2)) : spec;
  const path = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  const looksLocal = /^(\.{1,2}[\\/]|[\\/]|~[\\/]|[A-Za-z]:[\\/])/.test(spec) || /\.(tgz|tar\.gz)$/i.test(spec);

  if (looksLocal || existsSync(path)) {
    if (!existsSync(path)) throw new GalleyError("not-found", `There is nothing at ${spec}. Check the path.`);
    if (statSync(path).isDirectory() && !existsSync(join(path, "package.json"))) {
      throw new GalleyError("invalid", `${spec} has no package.json, so it isn't a package that can be installed.`);
    }
    return path;
  }
  return null;
}

/** "name", "name@1.2.3", "@scope/name@^1" → the package name. */
function nameOfSpec(spec: string): string | null {
  const match = /^(@[^/@\s]+\/[^@\s]+|[^@/\s][^@\s]*)(?:@[^\s]+)?$/.exec(spec.trim());

  return match && PACKAGE_NAME.test(match[1]!) ? match[1]! : null;
}

function npmProblem(error: unknown): string {
  const stderr = (error as { stderr?: string }).stderr ?? "";
  const line = stderr
    .split("\n")
    .map((text) => text.replace(/^npm (ERR!|error)\s*/, "").trim())
    .find((text) => text && !/^(A complete log|code |errno |syscall |path )/.test(text));

  return line ?? (error instanceof Error ? error.message.split("\n")[0]! : String(error));
}

export interface InstallResult {
  plugin: InstalledPlugin;
  /** Things the plugin's author should fix; it was installed anyway. */
  warnings: string[];
}

/**
 * Installs a plugin into `<home>/plugins`, pinned to the exact version that
 * arrived, and checks it really is one — a package that isn't a plugin, or
 * whose plugin doesn't pass the structural check, is removed again with the
 * reason.
 */
export async function installPlugin(home: string, spec: string, options: InstallOptions = {}): Promise<InstallResult> {
  const trimmed = spec.trim();

  if (!trimmed) throw new GalleyError("invalid", "Say which plugin to add: a package name, a folder, or a .tgz file.");
  const dir = await ensureProject(home);
  const npm = options.npm ?? runNpm;
  const env = { ...(options.env ?? process.env), npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false" };
  const local = localSource(trimmed, options.cwd ?? process.cwd());
  const expected = local ? null : nameOfSpec(trimmed);

  if (!local && !expected) throw new GalleyError("invalid", `“${trimmed}” isn't a package name, a folder or a .tgz file.`);
  const before = (await readJsonFile<{ dependencies?: Record<string, string> }>(join(dir, "package.json")))?.dependencies ?? {};
  // --install-links copies a local folder instead of linking to it, so the installed plugin doesn't change under the server.
  const args = ["install", "--ignore-scripts", "--save-exact", "--install-links", "--no-audit", "--no-fund", "--no-package-lock", ...(local ? ["--prefer-offline"] : []), local ?? trimmed];

  try {
    await npm(args, dir, env);
  } catch (error) {
    throw new GalleyError("invalid", `npm couldn't install ${trimmed}: ${npmProblem(error)}`, npmProblem(error));
  }
  const after = (await readJsonFile<{ dependencies?: Record<string, string> }>(join(dir, "package.json")))?.dependencies ?? {};
  const name = expected ?? Object.keys(after).find((key) => before[key] !== after[key]) ?? null;

  if (!name || !after[name]) throw new GalleyError("invalid", `npm finished, but ${trimmed} didn't show up among the installed plugins.`);
  const packageDir = join(dir, "node_modules", ...name.split("/"));
  const manifest = await readJsonFile<{ version?: string; keywords?: unknown; galley?: unknown }>(join(packageDir, "package.json"));
  const undo = async () => {
    await npm(["uninstall", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", name], dir, env).catch(() => undefined);
  };
  const declares = Array.isArray(manifest?.keywords) && manifest.keywords.includes(PLUGIN_KEYWORD);

  if (!manifest || (!declares && manifest.galley === undefined)) {
    await undo();
    throw new GalleyError(
      "invalid",
      `${name} isn't a ${PRODUCT.name} plugin: its package.json needs the keyword "${PLUGIN_KEYWORD}" (or a "galley" field). It was removed again.`
    );
  }
  const loaded = await loadPluginModule(packageDir, name);

  if (!loaded.ok) {
    await undo();
    throw new GalleyError("invalid", `${name} was installed but isn't a working plugin, so it was removed again. ${loaded.problems.join(" ")}`);
  }
  const record: InstalledPlugin = { name, version: manifest.version ?? after[name]!, spec: local ?? trimmed, installedAt: new Date().toISOString() };
  const list = (await readInstalled(home)).filter((item) => item.name !== name);

  await writeInstalled(home, [...list, record]);
  return { plugin: record, warnings: loaded.warnings };
}

export async function removePlugin(home: string, name: string, options: InstallOptions = {}): Promise<boolean> {
  const list = await readInstalled(home);

  if (!list.some((item) => item.name === name)) return false;
  const npm = options.npm ?? runNpm;

  try {
    await npm(["uninstall", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", name], pluginsDir(home), { ...(options.env ?? process.env), npm_config_update_notifier: "false" });
  } catch (error) {
    throw new GalleyError("invalid", `npm couldn't remove ${name}: ${npmProblem(error)}`, npmProblem(error));
  }
  await writeInstalled(
    home,
    list.filter((item) => item.name !== name)
  );
  return true;
}

/** Turns a plugin on or off for every later start (the same file a running registry keeps). */
export async function setPluginEnabled(home: string, name: string, enabled: boolean): Promise<void> {
  const file = join(home, "plugin-state.json");
  const state = (await readJsonFile<{ disabled?: string[] }>(file)) ?? {};
  const disabled = new Set(Array.isArray(state.disabled) ? state.disabled : []);

  if (enabled) disabled.delete(name);
  else disabled.add(name);
  await mkdir(home, { recursive: true });
  await writeJsonFile(file, { ...state, disabled: [...disabled].sort() });
}

type ModuleLoad = { ok: true; plugin: unknown; warnings: string[] } | { ok: false; problems: string[] };

async function loadPluginModule(packageDir: string, name: string): Promise<ModuleLoad> {
  const entry = packageEntry(packageDir);

  if (!entry) return { ok: false, problems: [`${name} has no entry file to load.`] };
  let module: unknown;

  try {
    module = await import(`${pathToFileURL(entry).href}?v=${statSync(entry).mtimeMs}`);
  } catch (error) {
    return { ok: false, problems: [`${name} could not be loaded (${error instanceof Error ? error.message.split("\n")[0] : String(error)}).`] };
  }
  const plugin = pluginFromModule(module);
  const check = validatePlugin(plugin, name, { reservedTools: ALL_TOOLS.map((tool) => tool.name) });

  return check.ok ? { ok: true, plugin, warnings: check.warnings } : { ok: false, problems: check.problems };
}

/**
 * Registers every installed plugin as a "user" plugin. One that won't load
 * is listed with the reason and contributes nothing — it never stops the server.
 */
export async function loadInstalledPlugins(registry: PluginRegistry, home: string): Promise<void> {
  for (const record of await readInstalled(home)) {
    const packageDir = join(pluginsDir(home), "node_modules", ...record.name.split("/"));

    if (!existsSync(join(packageDir, "package.json"))) {
      registry.registerFailure(record.name, `${record.name} is listed as installed but its files are missing. Add it again with \`${PRODUCT.slug} plugin add ${record.spec}\`.`, {
        source: "user",
        location: record.spec,
      });
      continue;
    }
    const loaded = await loadPluginModule(packageDir, record.name);

    if (!loaded.ok) {
      registry.registerFailure(record.name, `${loaded.problems.join(" ")} It is turned off until that is fixed.`, { source: "user", location: record.spec });
      continue;
    }
    registry.register(loaded.plugin, { source: "user", location: record.spec });
  }
}
