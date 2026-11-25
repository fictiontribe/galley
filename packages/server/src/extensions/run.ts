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
import type { PeopleDesk } from "./people";
import { guardSite, insideGet } from "./site";
import type { ExtensionHost, ExtensionParts, ExtensionPeople, GuardedSite, ServerExtension } from "./types";
import type { SiteService } from "@galley/core/types";

/** How long an extension's setup may take. */
export const EXTENSION_SETUP_MS = 30_000;
/** How long an extension's stop may take. */
export const EXTENSION_STOP_MS = 10_000;
/** The most either may be set to. */
const MOST_MS = 10 * 60_000;
const within = (ms: number | undefined, otherwise: number) => (typeof ms === "number" && Number.isFinite(ms) ? Math.min(MOST_MS, Math.max(1, Math.round(ms))) : otherwise);

export interface StartedExtension {
  id: string;
  routes: DeclaredRoute[];
  /** Takes the declared secrets' values out of a line. */
  scrub(text: string): string;
  /** One line in the server's log, marked with the extension's id, on one line, its secrets taken out. */
  say(line: string): void;
  /** False once it has been stopped: every site it was handed refuses from then on. */
  alive(): boolean;
}

export interface StartedExtensions {
  list: StartedExtension[];
  /** Every environment variable the extensions named as secret. */
  secretEnv: string[];
  /** Stops them all, each given its few seconds, and leaves what each was handed doing nothing: its host, and every site it holds. Safe to call twice. */
  stop(): Promise<void>;
}

export interface StartOptions {
  home: string;
  mode: "local" | "hosted";
  env: NodeJS.ProcessEnv;
  log(line: string): void;
  /** Null where there are no accounts. */
  desk: PeopleDesk | null;
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
  return String(text).replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, " ");
}

/**
 * What takes a secret's value out of a line: every declared variable that is
 * set, in the environment the server was started with and in the process's
 * own, and long enough to be told from ordinary words (six characters). The
 * value as it stands is taken out; an encoded form of it is not.
 */
export function scrubberFor(names: readonly string[], ...envs: NodeJS.ProcessEnv[]): (text: string) => string {
  const values = [...new Set(names.flatMap((name) => envs.map((env) => env[name]?.trim() ?? "")).filter((value) => value.length >= 6))].sort((a, b) => b.length - a.length);

  return (text) => values.reduce((out, value) => out.split(value).join("•••"), text);
}

/**
 * Calls something an extension handed over that must answer at once. Never
 * throws. A promise is refused: it is watched so it can't reject unhandled,
 * and the call counts as having answered nothing. `say` is the extension's
 * own line in the log, so a failure carries its id and none of its secrets.
 */
export function callNow<T>(say: (line: string) => void, what: string, call: () => T): { ok: true; value: T } | { ok: false } {
  try {
    const value = outside(call);

    if (thenable(value)) {
      Promise.resolve(value).catch((error: unknown) => say(`${what} failed later: ${error instanceof Error ? error.message : String(error)}`));
      say(`${what} answered with a promise. It has to answer at once, so its answer was not used.`);
      return { ok: false };
    }
    return { ok: true, value };
  } catch (error) {
    say(`${what} failed: ${error instanceof Error ? error.message : String(error)}`);
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
  const started: Array<StartedExtension & { parts: ExtensionParts; end(): void }> = [];
  let stopped = false;

  const stopOne = async (extension: { id: string; say(line: string): void; parts: ExtensionParts; end(): void }) => {
    if (typeof extension.parts.stop === "function") {
      try {
        await timeLimit(Promise.resolve(outside(() => extension.parts.stop!())), within(options.stopMs, EXTENSION_STOP_MS), () => new Error("it took too long"));
      } catch (error) {
        extension.say(`its stop failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // From here on what it was handed does nothing, the sites it holds included: the data folder may be another server's the next moment.
    extension.end();
  };
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    for (const extension of [...started].reverse()) await stopOne(extension);
  };

  try {
    for (const extension of extensions) {
      const { id } = extension;
      const scrub = scrubberFor(extension.secrets ?? [], options.env, process.env);
      const stateDir = join(options.home, "extensions", id);
      const abort = new AbortController();
      const listening: Array<() => void> = [];
      let live = true;
      const say = (line: string) => {
        if (live) options.log(`[${id}] ${scrub(oneLine(line))}`);
      };
      const alive = () => live;
      const end = () => {
        live = false;
        abort.abort();
        for (const unlisten of listening.splice(0)) unlisten();
      };
      const desk = options.desk;
      const people: ExtensionPeople | null = desk
        ? Object.freeze({
            name: (account: string) => (live ? desk.name(account) : null),
            counts: (session: Parameters<ExtensionPeople["counts"]>[0]) => live && desk.counts(session),
            onChange(listener: () => void) {
              if (!live) return () => undefined;
              const unlisten = desk.onChanged(() => void callNow(say, "a people listener", listener));

              listening.push(unlisten);
              return unlisten;
            },
          })
        : null;

      await mkdir(stateDir, { recursive: true, mode: 0o700 });
      await chmod(stateDir, 0o700);
      const host: ExtensionHost = Object.freeze({
        people,
        sites: Object.freeze({
          async get(siteId: string): Promise<GuardedSite | null> {
            const site = live && typeof siteId === "string" ? await options.site(siteId) : null;

            // Asked from inside a GET's handler, the site is as read-only as the one the handler was handed.
            return site && live ? guardSite(site, { readOnly: insideGet(), alive }) : null;
          },
        }),
        outside,
        stateDir,
        log: say,
        mode: options.mode,
      });
      let parts: ExtensionParts;

      try {
        parts = await timeLimit(Promise.resolve(outside(() => extension.setup(host, { signal: abort.signal }))), within(options.setupMs, EXTENSION_SETUP_MS), () => new Error("it didn't finish starting in time"));
      } catch (error) {
        end();
        if (error instanceof ExtensionError) throw error;
        throw new ExtensionError(`Extension “${id}” couldn't start: ${scrub(oneLine(error instanceof Error ? error.message : String(error)))}`);
      }
      if (typeof parts !== "object" || parts === null) {
        end();
        throw new ExtensionError(`Extension “${id}” couldn't start: its setup returned nothing.`);
      }
      let routes: DeclaredRoute[];

      try {
        routes = declaredRoutes(id, parts);
      } catch (error) {
        // Its setup ran: whatever that started is stopped like any other's, before what it was handed goes dead.
        await stopOne({ id, say, parts, end });
        throw error;
      }
      started.push({ id, routes, scrub, say, alive, parts, end });
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return { list: started, secretEnv: [...new Set(extensions.flatMap((extension) => [...(extension.secrets ?? [])]))], stop };
}
