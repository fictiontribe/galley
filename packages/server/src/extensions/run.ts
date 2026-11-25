/**
 * Starting and stopping extensions, and calling what they hand the server.
 *
 * Everything an extension gives the server to call (its setup, its stop, a
 * listener) is called outside any person, any publishing name and any site.
 * Otherwise it would run as whoever happened to cause the call: an owner
 * switching an account off, say, would lend the listener an owner's rights.
 *
 * Where an answer is expected at once, a promise is an error: it is caught
 * and logged, never left to reject on its own, which would end the process.
 */
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { outsideAnyPerson } from "@galley/core/install";
import { withoutSiteScope } from "@galley/core/site";
import { checkExtensions, declaredRoutes, ExtensionError, type DeclaredRoute } from "./declare";
import { guardSite } from "./site";
import type { ExtensionHost, ExtensionParts, ExtensionPeople, GuardedSite, ServerExtension } from "./types";
import type { SiteService } from "@galley/core/types";

/** How long an extension's setup may take. */
export const EXTENSION_SETUP_MS = 30_000;
/** How long an extension's stop may take. */
export const EXTENSION_STOP_MS = 10_000;

export interface StartedExtension {
  id: string;
  routes: DeclaredRoute[];
  /** Takes the declared secrets' values out of a line. */
  scrub(text: string): string;
}

export interface StartedExtensions {
  list: StartedExtension[];
  /** Every environment variable the extensions named as secret. */
  secretEnv: string[];
  /** Stops them all, each given its few seconds. Safe to call twice. */
  stop(): Promise<void>;
}

export interface StartOptions {
  home: string;
  mode: "local" | "hosted";
  env: NodeJS.ProcessEnv;
  log(line: string): void;
  people: ExtensionPeople | null;
  site(siteId: string): Promise<SiteService | null>;
  setupMs?: number;
  stopMs?: number;
}

/** Runs `run` outside any person and any site. */
export function outside<T>(run: () => T): T {
  return outsideAnyPerson(() => withoutSiteScope(run));
}

const thenable = (value: unknown): value is PromiseLike<unknown> => typeof (value as { then?: unknown } | null)?.then === "function";

/** Line breaks and other control characters can't be used to make one line look like two. */
export function oneLine(text: string): string {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/[\x00-\x1f\x7f\u2028\u2029]+/g, " ");
}

/** What takes a secret's value out of a line: every declared variable that is set and long enough to be told from ordinary words. */
export function scrubberFor(names: readonly string[], env: NodeJS.ProcessEnv): (text: string) => string {
  const values = [...new Set(names.map((name) => env[name] ?? "").filter((value) => value.length >= 6))].sort((a, b) => b.length - a.length);

  return (text) => values.reduce((out, value) => out.split(value).join("•••"), text);
}

/**
 * Calls something an extension handed over that must answer at once. Never
 * throws. A promise is refused: it is watched so it can't reject unhandled,
 * and the call counts as having answered nothing.
 */
export function callNow<T>(log: (line: string) => void, id: string, what: string, call: () => T): { ok: true; value: T } | { ok: false } {
  try {
    const value = outside(call);

    if (thenable(value)) {
      Promise.resolve(value).catch((error: unknown) => log(`[${id}] ${what} failed later: ${oneLine(error instanceof Error ? error.message : String(error))}`));
      log(`[${id}] ${what} answered with a promise. It has to answer at once, so its answer was not used.`);
      return { ok: false };
    }
    return { ok: true, value };
  } catch (error) {
    log(`[${id}] ${what} failed: ${oneLine(error instanceof Error ? error.message : String(error))}`);
    return { ok: false };
  }
}

function timeLimit<T>(work: Promise<T>, ms: number, late: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(late()), ms);

    timer.unref?.();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * The router's handling of addresses that the guards on added routes are
 * written for. A program that embeds the server brings its own versions of
 * its dependencies, so this is looked at once, on the router really loaded.
 */
export async function assertRouter(): Promise<void> {
  const app = new Hono();

  app.get("/api/x/probe/:name", (c) => c.json({ name: c.req.param("name") }));
  const ask = async (method: string, path: string) => app.request(path, { method });
  const decoded = await ask("GET", "/api/x/probe/a%2Fb");
  const lettered = await ask("GET", "/%61pi/x/probe/v");
  const slashed = await ask("GET", "/api/x/probe/v/");
  const head = await ask("HEAD", "/api/x/probe/v");
  const surprises = [
    decoded.status === 200 && ((await decoded.json()) as { name: string }).name === "a/b" ? null : "a parameter isn't decoded in full",
    lettered.status === 200 ? null : "an encoded letter in an address isn't decoded before routing",
    slashed.status === 404 ? null : "an address with a slash at its end is the same as one without",
    head.status === 200 ? null : "HEAD doesn't run the GET route",
  ].filter((surprise): surprise is string => surprise !== null);

  if (surprises.length) throw new ExtensionError(`The router isn't the one this was tested with: ${surprises.join("; ")}. Use the versions of hono and @hono/node-server this release was built with.`);
}

export async function startExtensions(extensions: readonly ServerExtension[], options: StartOptions): Promise<StartedExtensions> {
  checkExtensions(extensions);
  await assertRouter();
  const started: Array<StartedExtension & { parts: ExtensionParts; abort: AbortController }> = [];
  let stopped = false;

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    for (const extension of [...started].reverse()) {
      extension.abort.abort();
      if (typeof extension.parts.stop !== "function") continue;
      try {
        await timeLimit(Promise.resolve(outside(() => extension.parts.stop!())), options.stopMs ?? EXTENSION_STOP_MS, () => new Error("it took too long"));
      } catch (error) {
        options.log(`[${extension.id}] its stop failed: ${oneLine(error instanceof Error ? error.message : String(error))}`);
      }
    }
  };

  try {
    for (const extension of extensions) {
      const { id } = extension;
      const scrub = scrubberFor(extension.secrets ?? [], options.env);
      const stateDir = join(options.home, "extensions", id);
      const abort = new AbortController();

      await mkdir(stateDir, { recursive: true, mode: 0o700 });
      await chmod(stateDir, 0o700);
      const host: ExtensionHost = Object.freeze({
        people: options.people,
        sites: Object.freeze({
          async get(siteId: string): Promise<GuardedSite | null> {
            const site = typeof siteId === "string" ? await options.site(siteId) : null;

            return site ? guardSite(site, { readOnly: false }) : null;
          },
        }),
        outside,
        stateDir,
        log: (line: string) => options.log(`[${id}] ${scrub(oneLine(line))}`),
        mode: options.mode,
      });
      let parts: ExtensionParts;

      try {
        parts = await timeLimit(Promise.resolve(outside(() => extension.setup(host, { signal: abort.signal }))), options.setupMs ?? EXTENSION_SETUP_MS, () => new Error("it didn't finish starting in time"));
      } catch (error) {
        abort.abort();
        if (error instanceof ExtensionError) throw error;
        throw new ExtensionError(`Extension “${id}” couldn't start: ${scrub(oneLine(error instanceof Error ? error.message : String(error)))}`);
      }
      if (typeof parts !== "object" || parts === null) throw new ExtensionError(`Extension “${id}” couldn't start: its setup returned nothing.`);
      started.push({ id, routes: declaredRoutes(id, parts), scrub, parts, abort });
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return { list: started, secretEnv: [...new Set(extensions.flatMap((extension) => [...(extension.secrets ?? [])]))], stop };
}
