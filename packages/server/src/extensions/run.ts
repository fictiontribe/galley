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
import type { AssistantTurnNotice } from "@galley/core/ai";
import { outsideAnyPerson } from "@galley/core/install";
import { withoutSiteScope, type SiteActivityNotice, type SiteActor, type SiteFileWriteNotice } from "@galley/core/site";
import { GalleyError, isGalleyError } from "@galley/core";
import type { ServerEvent, SiteService } from "@galley/core/types";
import { checkExtensions, declaredEvents, declaredRoutes, EXTENSION_EVENT_BYTES, EXTENSION_EVENT_BYTES_A_SECOND, EXTENSION_EVENTS_A_SECOND, ExtensionError, type DeclaredRoute } from "./declare";
import { isJson, jsonBytes } from "./json";
import type { PeopleDesk } from "./people";
import { GET_CHANGES_NOTHING, guardSite, insideGet, STOPPED, UNREADABLE, unreadable } from "./site";
import type { ExtensionCaller, ExtensionEventRule, ExtensionEvents, ExtensionHooks, ExtensionHost, ExtensionParts, ExtensionPeople, ExtensionStream, GuardedSite, JsonValue, ServerExtension } from "./types";

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
  /** Notes that it has been handed this site: it may send events about it from then on. */
  handed(siteId: string): void;
  /** The rule for one of its events; undefined for a name it didn't declare. */
  rule(name: string): ExtensionEventRule<unknown> | undefined;
  /**
   * What one reader is sent of an event: the payload as its rule shapes it
   * for them, or null for nothing. `asIs`: the event has no rule of its own,
   * so every reader with the level is sent the same thing.
   */
  shape(name: string, payload: unknown, reader: ExtensionCaller): { payload: JsonValue; asIs: boolean } | null;
  /** One of its events was not sent to a window that had too much waiting already. Counted, and said in the log now and then. */
  skipped(): void;
  /**
   * A window's stream opened carrying a value for it. `refused`: its listener
   * didn't take the value (the stream opens all the same). `ended` runs what
   * its listeners handed back, once.
   */
  streamOpened(stream: ExtensionStream): { refused: { code: string; message: string } | null; ended(): void };
}

export interface StartedExtensions {
  /** The ids the server was started with, running now or not. */
  readonly ids: readonly string[];
  /** The ones running now. After `restart` these are new ones: ask again, don't keep one. */
  readonly list: readonly StartedExtension[];
  find(id: string): StartedExtension | undefined;
  /** Every environment variable the extensions named as secret. */
  secretEnv: string[];
  /**
   * A window's stream opened carrying a value for the extension `id`. Its
   * listeners are told, when it is running. `close` ends that stream, for
   * `endStreams`. `ended` is for when the stream ends.
   */
  streamOpened(id: string, stream: ExtensionStream, close: () => void): { refused: { code: string; message: string } | null; ended(): void };
  /**
   * Stops them all for good, each given its few seconds, and leaves what each
   * was handed doing nothing: its host, every site it holds, a controller it
   * took from one. Nothing is started after it, a `restart` still under way
   * included. Safe to call twice.
   */
  stop(): Promise<void>;
  /** Stops them the same way until `restart`: for while the data folder is replaced under the server. */
  stopForNow(): Promise<void>;
  /**
   * Stops whatever runs and starts them all again, each with a new host. One
   * that can't start again is said in the log and left stopped; the others
   * run. Resolves with the ids of those that couldn't start. The windows
   * that were there are not known to the ones running now: `endStreams`.
   */
  restart(): Promise<string[]>;
  /**
   * Ends every open stream that carried a value for an extension. Each
   * window opens another by itself, and the extension that runs now is told.
   */
  endStreams(): void;
}

export interface ExtensionHooksHub {
  onFileWrite(listener: (notice: SiteFileWriteNotice) => void): () => void;
  onActivity(listener: (notice: SiteActivityNotice) => void): () => void;
  beforeDiscard(guard: (info: { siteId: string; paths: string[]; actor: SiteActor }) => string | null | undefined | Promise<string | null | undefined>): () => void;
  onAssistantTurn(listener: (notice: AssistantTurnNotice) => void): () => void;
}

export interface StartOptions {
  home: string;
  mode: "local" | "hosted";
  env: NodeJS.ProcessEnv;
  log(line: string): void;
  /** Null where there are no accounts. */
  desk: PeopleDesk | null;
  site(siteId: string): Promise<SiteService | null>;
  /** Puts an event on the server's stream, for every open window's own filter to decide on. Absent: events go nowhere. */
  emit?(event: ServerEvent): void;
  /** A hosted install's one site, when it has one: an extension may send events about it without having asked for it first. */
  siteId?(): string | null;
  /** Optional lifecycle hooks hub wired to the engine's sites and assistant runtime. */
  hooks?: ExtensionHooksHub;
  setupMs?: number;
  stopMs?: number;
}

/** What is said about one kind of failure at most this often: a rule that fails does so for every reader of every event. */
export const SAID_EVERY_MS = 60_000;
/**
 * The time that limits are counted by: one that only moves forward. The
 * wall clock can be set back (by hand, by a time service, by a machine that
 * was asleep), and a second counted on it would then last as long as the
 * step back.
 */
const clock = (): number => performance.now();
/** The most of a refusal's words that is sent to a window. */
const REFUSAL_CHARACTERS = 500;

/** A route table as it guards its addresses: what must be the same when an extension is started again. */
const guardsOf = (routes: readonly DeclaredRoute[]) => routes.map((declared) => `${declared.key} ${declared.route.access} ${declared.bodyLimit} ${declared.route.person === true}`).sort().join("\n");

/**
 * A copy that is plain data, or undefined when the value isn't JSON of at
 * most `limit` bytes. Looked at once, then copied, then the copy is what is
 * measured and sent: a property that answers differently each time it is
 * read can't pass as one thing and be sent as another.
 */
function plainJson(value: unknown, limit: number): { value: JsonValue; bytes: number } | undefined {
  if (!isJson(value)) return undefined;
  let copy: unknown;

  try {
    copy = structuredClone(value);
  } catch {
    return undefined;
  }
  if (!isJson(copy)) return undefined;
  const bytes = jsonBytes(copy);

  return bytes <= limit ? { value: copy, bytes } : undefined;
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
  type Running = StartedExtension & { parts: ExtensionParts; end(): void };

  checkExtensions(extensions);
  await assertRouter();
  let started: Running[] = [];
  /** Stopped for good: nothing more is started. */
  let over = false;
  /** The setup under way, to be told when the server stops under it. */
  let starting: AbortController | null = null;
  /** Stopping and starting again never overlap: each waits for the one before. */
  let turn: Promise<unknown> = Promise.resolve();
  /** How to end each open stream that carried a value for an extension. */
  const openStreams = new Set<() => void>();
  /** What guards each extension's addresses, as they were mounted when the server started. */
  const mounted = new Map<string, string>();
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const mine = turn.then(work, work);

    turn = mine.catch(() => undefined);
    return mine;
  };

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
  const stopAll = async () => {
    const running = started;

    started = [];
    for (const extension of [...running].reverse()) await stopOne(extension);
  };
  const stop = () => {
    over = true;
    starting?.abort();
    return inTurn(stopAll);
  };

  async function startOne(extension: ServerExtension): Promise<Running> {
    const { id } = extension;
    const scrub = scrubberFor(extension.secrets ?? [], options.env, process.env);
    const stateDir = join(options.home, "extensions", id);
    const abort = new AbortController();
    const listening: Array<() => void> = [];
    const streamListeners: Array<(stream: ExtensionStream) => (() => void) | void> = [];
    const handedSites = new Set<string>();
    const saidAt = new Map<string, number>();
    let rules: Map<string, ExtensionEventRule<unknown>> | null = null;
    let live = true;
    /** What it sent in the last second, oldest first, and their bytes together. */
    const sent: Array<{ at: number; bytes: number }> = [];
    let sentBytes = 0;
    /** Since this was last said: events dropped for being too many or too much, and times one was not sent to a window that was behind. */
    const counted = { dropped: 0, skipped: 0 };
    let countsTimer: ReturnType<typeof setTimeout> | null = null;
    let countsSaidAt = -Infinity;
    const say = (line: string) => {
      if (live) options.log(`[${id}] ${scrub(oneLine(line))}`);
    };
    /** The same, at most once a minute for each kind of thing said. */
    const sayNowAndThen = (kind: string, line: string) => {
      const now = clock();

      if (now - (saidAt.get(kind) ?? -Infinity) < SAID_EVERY_MS) return;
      saidAt.set(kind, now);
      say(line);
    };
    /** What was dropped and what was not sent since this was last said: a second after the first of them, and at most once a minute. */
    const sayCounts = () => {
      countsTimer = null;
      if (!live) return;
      const { dropped, skipped } = counted;

      if (dropped === 0 && skipped === 0) return;
      countsSaidAt = clock();
      counted.dropped = counted.skipped = 0;
      if (dropped) say(`it sent more than ${EXTENSION_EVENTS_A_SECOND} events, or more than ${EXTENSION_EVENT_BYTES_A_SECOND / 1024} KB of them, in a second: ${dropped} ${dropped === 1 ? "was" : "were"} dropped.`);
      if (skipped) say(`${skipped} ${skipped === 1 ? "time an event of its" : "times an event of its"} was not sent to a window that had fallen behind in reading.`);
    };
    const countSoon = () => {
      if (countsTimer) return;
      countsTimer = setTimeout(sayCounts, Math.max(1000, countsSaidAt + SAID_EVERY_MS - clock()));
      countsTimer.unref?.();
    };
    const alive = () => live;
    const end = () => {
      live = false;
      abort.abort();
      if (countsTimer) clearTimeout(countsTimer);
      for (const unlisten of listening.splice(0)) unlisten();
      streamListeners.length = 0;
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
    const events: ExtensionEvents = Object.freeze({
      emit(name: string, siteId: string, payload: JsonValue) {
        if (!live) throw new GalleyError("forbidden", "This extension has been stopped, so it can no longer send events.");
        if (rules === null) throw new GalleyError("invalid", "An event can be sent once setup has returned: that is when the server learns which events there are.");
        if (!rules.has(name)) throw new GalleyError("invalid", `“${oneLine(String(name)).slice(0, 80)}” isn't an event this extension declared.`);
        if (typeof siteId !== "string" || !(handedSites.has(siteId) || options.siteId?.() === siteId)) throw new GalleyError("invalid", "An event is about a site this extension has been handed. Ask for the site first.");
        // A copy, and the copy is what is measured: what the extension does to its own object afterwards changes nothing that is on its way.
        const copy = plainJson(payload, EXTENSION_EVENT_BYTES);

        if (!copy) throw new GalleyError("invalid", "An event's payload is JSON of at most 64 KB.");
        const now = clock();

        while (sent.length > 0 && now - sent[0]!.at >= 1000) sentBytes -= sent.shift()!.bytes;
        // In any one second, so many events and so many bytes: every window reads what every extension sends.
        if (sent.length >= EXTENSION_EVENTS_A_SECOND || sentBytes + copy.bytes > EXTENSION_EVENT_BYTES_A_SECOND) {
          counted.dropped += 1;
          countSoon();
          return;
        }
        sent.push({ at: now, bytes: copy.bytes });
        sentBytes += copy.bytes;
        const event: ServerEvent = { type: "extension", source: id, name, siteId, payload: copy.value };

        outside(() => options.emit?.(event));
      },
      onStream(listener: (stream: ExtensionStream) => (() => void) | void) {
        if (live && typeof listener === "function") streamListeners.push(listener);
      },
    });

    const hooksHub = options.hooks;
    const hooks: ExtensionHooks = Object.freeze({
      onFileWrite(listener: (notice: SiteFileWriteNotice) => void) {
        if (!live || !hooksHub || typeof listener !== "function") return () => undefined;
        const unlisten = hooksHub.onFileWrite((notice) => {
          if (!live) return;
          void callNow(say, "a file-write listener", () => listener(structuredClone(notice)));
        });

        listening.push(unlisten);
        return unlisten;
      },
      onActivity(listener: (notice: SiteActivityNotice) => void) {
        if (!live || !hooksHub || typeof listener !== "function") return () => undefined;
        const unlisten = hooksHub.onActivity((notice) => {
          if (!live) return;
          void callNow(say, "a site-activity listener", () => listener(structuredClone(notice)));
        });

        listening.push(unlisten);
        return unlisten;
      },
      beforeDiscard(guard: (info: { siteId: string; paths: string[]; actor: SiteActor }) => string | null | undefined | Promise<string | null | undefined>) {
        if (!live || !hooksHub || typeof guard !== "function") return () => undefined;
        const unlisten = hooksHub.beforeDiscard(async (info) => {
          if (!live) return null;
          try {
            return (await outside(() => guard(structuredClone(info)))) ?? null;
          } catch (error) {
            say(`a discard guard failed: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          }
        });

        listening.push(unlisten);
        return unlisten;
      },
      onAssistantTurn(listener: (notice: AssistantTurnNotice) => void) {
        if (!live || !hooksHub || typeof listener !== "function") return () => undefined;
        const unlisten = hooksHub.onAssistantTurn((notice) => {
          if (!live) return;
          void callNow(say, "an assistant-turn listener", () => listener(structuredClone(notice)));
        });

        listening.push(unlisten);
        return unlisten;
      },
    });

    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await chmod(stateDir, 0o700);
    const host: ExtensionHost = Object.freeze({
      events,
      people,
      sites: Object.freeze({
        async get(siteId: string): Promise<GuardedSite | null> {
          const site = live && typeof siteId === "string" ? await options.site(siteId) : null;

          if (!site || !live) return null;
          handedSites.add(site.id);
          // Asked from inside a GET's handler, the site is as read-only as the one the handler was handed.
          return guardSite(site, { readOnly: insideGet(), alive });
        },
        async withPathLock<T>(siteId: string, path: string, run: (site: GuardedSite) => Promise<T>): Promise<T> {
          if (!live) throw new GalleyError("forbidden", STOPPED);
          if (insideGet()) throw new GalleyError("forbidden", GET_CHANGES_NOTHING);
          if (typeof path !== "string" || unreadable(path)) throw new GalleyError("forbidden", UNREADABLE);
          const site = typeof siteId === "string" ? await options.site(siteId) : null;

          if (!site || !live) throw new GalleyError("not-found", "That site isn't open.");
          handedSites.add(site.id);
          const guarded = guardSite(site, { readOnly: false, alive });
          const lockable = site as SiteService & { withPathLock?: <R>(p: string, fn: () => Promise<R>) => Promise<R> };

          if (typeof lockable.withPathLock === "function") return lockable.withPathLock(path, () => run(guarded));
          return run(guarded);
        },
      }),
      hooks,
      outside,
      stateDir,
      log: say,
      mode: options.mode,
    });
    let parts: ExtensionParts;
    let ranOut = false;
    // Always a promise: a setup that throws where it stands is one that failed.
    const settingUp = (async () => outside(() => extension.setup(host, { signal: abort.signal })))();

    starting = abort;
    try {
      parts = await timeLimit(settingUp, within(options.setupMs, EXTENSION_SETUP_MS), () => ((ranOut = true), new Error("it didn't finish starting in time")));
    } catch (error) {
      end();
      // Its time ran out and its signal said so. If it finishes after all, what it started is stopped: the server may carry on
      // without it. That stop takes its turn like every other start and stop, so it never runs in the middle of one; it can
      // still come while a newer start of the same extension is running, which is why a stop closes only what its own setup opened.
      if (ranOut) {
        void settingUp.then(
          (late) =>
            inTurn(async () => {
              try {
                // Read in here: an extension's object can fail on being looked at.
                const stopLate = late?.stop;

                if (typeof stopLate !== "function") return;
                await timeLimit(Promise.resolve(outside(() => stopLate.call(late))), within(options.stopMs, EXTENSION_STOP_MS), () => new Error("it took too long"));
              } catch (failure) {
                options.log(`[${id}] ${scrub(oneLine(`its setup finished after its time was up, and its stop then failed: ${failure instanceof Error ? failure.message : String(failure)}`))}`);
              }
            }),
          () => undefined
        );
      }
      // An error of its own making is in its own words: its secrets are taken out of those too.
      if (error instanceof ExtensionError) throw new ExtensionError(scrub(oneLine(error.message)));
      throw new ExtensionError(`Extension “${id}” couldn't start: ${scrub(oneLine(error instanceof Error ? error.message : String(error)))}`);
    } finally {
      if (starting === abort) starting = null;
    }
    if (typeof parts !== "object" || parts === null) {
      end();
      throw new ExtensionError(`Extension “${id}” couldn't start: its setup returned nothing.`);
    }
    let routes: DeclaredRoute[];

    try {
      routes = declaredRoutes(id, parts);
      rules = declaredEvents(id, parts);
    } catch (error) {
      // Its setup ran: whatever that started is stopped like any other's, before what it was handed goes dead.
      await stopOne({ id, say, parts, end });
      throw error instanceof ExtensionError ? new ExtensionError(scrub(oneLine(error.message))) : error;
    }
    const declared = rules;

    return {
      id,
      routes,
      scrub,
      say,
      alive,
      parts,
      end,
      handed: (siteId) => void handedSites.add(siteId),
      rule: (name) => (live ? declared.get(name) : undefined),
      shape(name, payload, reader) {
        const rule = live ? declared.get(name) : undefined;

        if (!rule) return null;
        if (!rule.for) return { payload: payload as JsonValue, asIs: true };
        // This reader's own copy: what one rule does to it is not what the next reader's rule is given.
        const answer = callNow((line) => sayNowAndThen(`rule ${name}`, line), `the rule for “${name}”`, () => rule.for!(structuredClone(payload), reader));

        if (!answer.ok || answer.value === null) return null;
        // Copied before it is measured, and the copy is what is sent.
        const shaped = plainJson(answer.value, EXTENSION_EVENT_BYTES);

        if (!shaped) {
          sayNowAndThen(`shape ${name}`, `the rule for “${name}” answered with something that isn't JSON of at most 64 KB, so nothing was sent to that reader.`);
          return null;
        }
        return { payload: shaped.value, asIs: false };
      },
      skipped() {
        if (!live) return;
        counted.skipped += 1;
        countSoon();
      },
      streamOpened(stream) {
        const ends: Array<() => void> = [];
        const ended = () => {
          // Stopped since: its stop was the end of everything it kept, and nothing of it is called after that.
          if (!live) return void ends.splice(0);
          for (const end_ of ends.splice(0)) void callNow(say, "what a stream listener handed back", end_);
        };

        for (const listener of [...streamListeners]) {
          try {
            const answer = outside(() => listener(stream));

            // Anyone signed in can open and close streams as fast as they like: what a listener does wrong is said now and then, not each time.
            if (thenable(answer)) {
              Promise.resolve(answer).catch((error: unknown) => sayNowAndThen("stream listener later", `a stream listener failed later: ${error instanceof Error ? error.message : String(error)}`));
              sayNowAndThen("stream listener promise", "a stream listener answered with a promise. It has to answer at once, so its answer was not used.");
            } else if (typeof answer === "function") ends.push(answer);
          } catch (error) {
            // It didn't take the value. The stream itself is not its to refuse: the window is told, and nothing else changes.
            ended();
            // Its words go to a browser: one line of them, so many characters, its secrets taken out.
            if (isGalleyError(error)) return { refused: { code: error.code, message: scrub(oneLine(error.message)).slice(0, REFUSAL_CHARACTERS) }, ended: () => undefined };
            sayNowAndThen("stream listener", `a stream listener failed: ${error instanceof Error ? error.message : String(error)}`);
            return { refused: { code: "internal", message: "That couldn't be taken because of an unexpected problem." }, ended: () => undefined };
          }
        }
        return { refused: null, ended };
      },
    };
  }

  try {
    for (const extension of extensions) started.push(await startOne(extension));
  } catch (error) {
    await stop();
    throw error;
  }
  for (const extension of started) mounted.set(extension.id, guardsOf(extension.routes));
  const find = (id: string) => started.find((extension) => extension.id === id);

  return {
    ids: extensions.map((extension) => extension.id),
    get list() {
      return started;
    },
    find,
    secretEnv: [...new Set(extensions.flatMap((extension) => [...(extension.secrets ?? [])]))],
    streamOpened(id, stream, close) {
      // Kept whether or not it is running or took the value: the one started next is told when the window's new stream opens.
      openStreams.add(close);
      const outcome = find(id)?.streamOpened(stream) ?? { refused: null, ended: () => undefined };

      return {
        refused: outcome.refused,
        ended() {
          openStreams.delete(close);
          outcome.ended();
        },
      };
    },
    stop,
    stopForNow: () => inTurn(stopAll),
    restart: () =>
      inTurn(async () => {
        const failed: string[] = [];

        await stopAll();
        for (const extension of extensions) {
          // The server is stopping: nothing more is started.
          if (over) break;
          try {
            const again = await startOne(extension);

            // An address keeps the level, the size limit and the "a person only" it was mounted with when the server started.
            // A setup that now declares something else would be run behind the wrong guards: it is stopped instead.
            if (mounted.get(extension.id) !== guardsOf(again.routes)) {
              await stopOne(again);
              throw new ExtensionError(`Extension “${extension.id}” returned other routes than it did when the server started (an address, a level, a size limit or “a person only” differs), and an address keeps the guards it was mounted with`);
            }
            started.push(again);
          } catch (error) {
            failed.push(extension.id);
            options.log(`${oneLine(error instanceof Error ? error.message : String(error)).replace(/[.]$/, "")}. It was stopped and couldn't be started again: its routes answer that it isn't running until the server is restarted.`);
          }
        }
        return failed;
      }),
    endStreams() {
      for (const close of [...openStreams]) close();
      openStreams.clear();
    },
  };
}
