/**
 * What an extension declares, checked before the server starts: a mistake
 * here stops the start with one sentence that names the extension, rather
 * than being found by the first person who calls the route.
 */
import type { ExtensionParts, ExtensionRoute, ServerExtension } from "./types";

/** A wrong declaration. The message is the one sentence the start-up ends with. */
export class ExtensionError extends Error {}

/** Where every added route lives. No route of the editor's own is under it. */
export const EXTENSION_PREFIX = "/api/x";
/** The most an added route's body may be, and what it is when the route doesn't say. */
export const EXTENSION_BODY_LIMIT = 1024 * 1024;

const ID = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * Variables every program is started with. Named as a secret by mistake, one
 * of them would be kept from the site's commands (a preview without PATH
 * doesn't start) and its value struck out of every line of the log.
 */
const NOT_SECRETS = new Set(
  ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "PWD", "OLDPWD", "TMPDIR", "TMP", "TEMP", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "TERM", "TZ", "HOSTNAME", "PORT", "CI", "EDITOR", "NODE_ENV", "NODE_OPTIONS", "NODE_PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "USERNAME", "PROGRAMFILES"]
);
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const WITH_BODY = new Set<string>(["POST", "PUT", "PATCH"]);
const LEVELS = new Set<unknown>(["edit", "publish", "manage"]);
const PART = /^(?:[a-z0-9][a-z0-9-]*|:[a-z][A-Za-z0-9]*)$/;

export type ExtensionMethod = (typeof METHODS)[number];

export interface DeclaredRoute {
  /** As the extension wrote it: "GET /sites/:siteId". */
  key: string;
  method: ExtensionMethod;
  /** The whole address: "/api/x/<id>/sites/:siteId". */
  path: string;
  siteScoped: boolean;
  bodyLimit: number;
  route: ExtensionRoute<unknown>;
}

/** For typing an extension where it is written. Changes nothing. */
export function defineExtension<T extends ServerExtension>(extension: T): T {
  return extension;
}

/** Every environment variable the extensions name as secret. Call after `checkExtensions`. */
export function declaredSecrets(extensions: readonly ServerExtension[]): string[] {
  return [...new Set(extensions.flatMap((extension) => [...(extension.secrets ?? [])]))];
}

/** Ids well formed and each used once; secrets named as environment variables are. */
export function checkExtensions(extensions: readonly ServerExtension[]): void {
  const seen = new Set<string>();

  for (const extension of extensions) {
    const id = (extension as { id?: unknown } | null)?.id;

    if (typeof id !== "string" || !ID.test(id)) throw new ExtensionError(`The extension id “${String(id)}” isn't usable: it is 3 to 32 lower-case letters, digits and dashes, starting with a letter.`);
    if (seen.has(id)) throw new ExtensionError(`The extension id “${id}” isn't usable: two extensions have it.`);
    seen.add(id);
    if (typeof extension.setup !== "function") throw new ExtensionError(`Extension “${id}” couldn't start: it has no setup.`);
    const secrets: unknown = extension.secrets ?? [];

    // A name given on its own, not in a list, would be read letter by letter.
    if (!Array.isArray(secrets)) throw new ExtensionError(`Extension “${id}”: its secrets are a list of the names of environment variables.`);
    for (const name of secrets) {
      if (typeof name !== "string" || !ENV_NAME.test(name)) throw new ExtensionError(`Extension “${id}”: “${String(name)}” isn't the name of an environment variable.`);
      if (NOT_SECRETS.has(name.toUpperCase())) throw new ExtensionError(`Extension “${id}”: ${name} can't be named as a secret. The site's own commands need it, and its value would be struck out of every line of the log.`);
    }
  }
}

/** The routes an extension's setup returned, each checked and given its whole address. */
export function declaredRoutes(id: string, parts: ExtensionParts): DeclaredRoute[] {
  const out: DeclaredRoute[] = [];
  const routes = parts.routes ?? {};

  if (typeof routes !== "object" || routes === null) throw new ExtensionError(`Extension “${id}” couldn't start: its routes aren't a list of routes.`);
  for (const [key, route] of Object.entries(routes)) {
    const space = key.indexOf(" ");
    const method = key.slice(0, space) as ExtensionMethod;
    const relative = key.slice(space + 1);
    const parts = relative.split("/").slice(1);
    const notARoute = () => new ExtensionError(`Extension “${id}”: the route “${key}” isn't a route. It is a method (GET, POST, PUT, PATCH or DELETE), a space, and a path of up to 8 parts, each lower-case letters, digits and dashes or a :name.`);

    if (space < 1 || !METHODS.includes(method) || !relative.startsWith("/") || parts.length < 1 || parts.length > 8 || parts.some((part) => !PART.test(part))) throw notARoute();
    if (new Set(parts.filter((part) => part.startsWith(":"))).size !== parts.filter((part) => part.startsWith(":")).length) throw notARoute();
    if (typeof route !== "object" || route === null || typeof route.handle !== "function") throw notARoute();
    if (!LEVELS.has(route.access)) throw new ExtensionError(`Extension “${id}”: the route “${key}” has no access level. It is edit, publish or manage.`);
    const takesBody = WITH_BODY.has(method);
    const limit = route.bodyLimit ?? EXTENSION_BODY_LIMIT;

    if (takesBody !== (typeof route.body === "function") || (!takesBody && route.bodyLimit !== undefined) || !Number.isInteger(limit) || limit < 1 || limit > EXTENSION_BODY_LIMIT) {
      throw new ExtensionError(`Extension “${id}”: the route “${key}” must say how its body is read: POST, PUT and PATCH need a body reader and may set a limit of up to 1 MB; GET and DELETE take none.`);
    }
    if (route.person !== undefined && route.person !== true) throw new ExtensionError(`Extension “${id}”: the route “${key}” isn't a route: person is true or left out.`);
    out.push({ key, method, path: `${EXTENSION_PREFIX}/${id}${relative}`, siteScoped: parts.includes(":siteId"), bodyLimit: limit, route: route as ExtensionRoute<unknown> });
  }
  return out;
}
