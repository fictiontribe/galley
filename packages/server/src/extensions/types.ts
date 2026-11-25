/**
 * Embedding: what a program that starts this server may add to it when it is
 * built. Experimental: these shapes may change in any 0.x release, and the
 * changelog says so under "Embedding".
 *
 * An extension is code the operator compiled into the server. It runs in the
 * server's process with Node's full reach, like any module of the server and
 * like an installed plugin: nothing here is a sandbox. What these types say
 * is what an extension is *handed* (never a cookie, a header, a password
 * hash, an e-mail or the operator's token) and what the server does for it
 * (every guard a built-in route has, a level that is always checked).
 */
import type { AccountRole } from "@galley/core/install";
import type { SiteService } from "@galley/core/types";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** The levels a route can ask for. An added route always needs someone signed in. */
export type ExtensionAccess = "edit" | "publish" | "manage";

export interface ServerExtension {
  /** Lower-case letters, digits and dashes, 3 to 32, starting with a letter. Names its routes (`/api/x/<id>/…`) and its folder. */
  id: string;
  /**
   * The environment variables it reads that are secret, as a list of their
   * names. On a hosted install they are kept from the site's own commands
   * (its preview, its build), from before anything is started. Everywhere,
   * their values are taken out of every line the server logs and of the
   * error messages this extension's routes answer with: the value as it
   * stands, when it is six characters or more; an encoded form of it is not
   * recognised. One it doesn't name reaches the site's commands, whose code
   * editors can change. A variable every program needs (PATH, HOME…) can't be
   * named: the server refuses to start.
   */
  secrets?: readonly string[];
  /**
   * Called once, after the engine is put together and before the app answers
   * any request (the port is open by then and answers 503, as it does while
   * any server starts). `signal` fires when the time for starting is up or
   * the server is stopping: stop what was started and return. A listener on
   * it must not throw: Node ends the process for one that does. If setup
   * fails, `startServer` rejects and the program should exit.
   */
  setup(host: ExtensionHost, start: { signal: AbortSignal }): ExtensionParts | Promise<ExtensionParts>;
}

export interface ExtensionParts {
  /** By `"<METHOD> /path"`, relative to the extension: `"GET /sites/:siteId"` is served at `/api/x/<id>/sites/:siteId`. */
  routes?: Record<string, ExtensionRoute<any>>;
  /** The events it may emit, by name (lower-case words joined by dots), each with who is sent it. */
  events?: Record<string, ExtensionEventRule<any>>;
  /**
   * Runs when the server stops, before the data folder is let go; before a
   * backup is put back (the data folder is replaced under the server, and
   * `setup` is called again afterwards with a new host, and must return the
   * routes it returned when the server started); and when a start ends after
   * this extension's setup had finished, however late. May take a few
   * seconds; not more. After it, what the extension was handed does nothing:
   * its host, every site it holds, and a controller it took from one.
   */
  stop?(): void | Promise<void>;
}

export interface ExtensionRoute<B = undefined> {
  /** Required. */
  access: ExtensionAccess;
  /** On an install with accounts, refuses the operator's access token: the route needs a person signed in. */
  person?: true;
  /**
   * Required on POST, PUT and PATCH, refused on GET and DELETE: turns the
   * parsed JSON (`undefined` for an empty body) into what the handler takes,
   * or throws `invalid(…)`. It may be async. What it throws is answered as
   * what the handler throws is.
   */
  body?: (input: unknown) => B | Promise<B>;
  /** The most the body may be, in bytes. Default and ceiling: 1 MB. */
  bodyLimit?: number;
  /**
   * A GET changes nothing: that is the rule for every route of the editor,
   * and on GET the site handed here refuses whatever would change it.
   */
  handle(request: ExtensionRequest<B>): JsonValue | Promise<JsonValue>;
}

export interface ExtensionRequest<B> {
  /** Each value is one part of the address: never with "/", "\" or a NUL in it, never "." or "..". */
  params: Readonly<Record<string, string>>;
  /** Each value a plain string; a repeated one keeps the first. */
  query: Readonly<Record<string, string | undefined>>;
  body: B;
  caller: ExtensionCaller;
  /**
   * The open site `:siteId` names; absent when the route has no `:siteId`.
   * What it answers with is a copy, from a change as from a read: plain
   * data copied, a thing to drive (the preview's controller, a checkpoint)
   * handed as a plain object with its public members only, behind the same
   * guards as the site. `.git/` and `.env*` can't be read through
   * it (by name; and, for reads that name a file and for searches, by where
   * a link inside the site leads). On GET it refuses whatever would change
   * the site, as does any site reached through `host.sites` while a GET is
   * being handled, and whatever that GET starts. Once the extension has been
   * stopped, every member of it refuses; so it does once the site has been
   * closed (SITE_CLOSED).
   */
  site?: GuardedSite;
  /** Fires when whoever asked gave up on the request. A listener on it must not throw. */
  signal: AbortSignal;
}

export interface ExtensionEventRule<P = JsonValue> {
  /** The least a reader's role must have to be sent it at all. Required. */
  level: ExtensionAccess;
  /**
   * What this reader is sent, or null for nothing. Called only for readers
   * who have `level` (so it can narrow, never widen), with the reader as they
   * are at that event and a copy of the payload that is this reader's alone.
   * It answers at once: a promise is refused and nothing is sent. What it
   * answers is copied, and the copy is measured and sent. Absent: the
   * payload as it is.
   */
  for?(payload: P, reader: ExtensionCaller): JsonValue | null;
}

/** A browser window's stream that named this extension when it opened. */
export interface ExtensionStream {
  caller: ExtensionCaller;
  /**
   * What the window sent for this extension: 1 to 128 of `A-Z a-z 0-9 . _ ~ -`.
   * Untrusted: any signed-in browser chooses it, and a proxy in front writes
   * it to its log, so it must not be a secret.
   */
  value: string;
  // Both are frozen, and each extension is handed objects of its own.
}

export interface ExtensionEvents {
  /**
   * Sends an event to every open window whose reader its rule allows.
   * `name` is one this extension declared; `siteId` a site it has been
   * handed; `payload` JSON of at most 64 KB. Otherwise it throws, here. In
   * any one second an extension may send 50 events and 256 KB of payload:
   * past either they are dropped and counted in the log. A window that
   * already has half of what it may have waiting is not sent it either; it
   * is sent `stream.missed` with `{ count }` once it has room again. Not
   * before `setup` has returned.
   */
  emit(name: string, siteId: string, payload: JsonValue): void;
  /**
   * Called when a window's stream opens carrying a value for this extension
   * (`/api/events?x-<id>=<value>`): the sign that the window is there.
   * What the listener returns runs once when that stream ends, however it
   * ends; it is not called once the extension has been stopped. Throwing
   * refuses the value, never the stream: the stream opens as usual and the
   * window is sent `stream.refused` with the error's code and one line of
   * its message, 500 characters at most. Both answer at once: a promise is
   * refused. A value from anywhere but the editor's own page is refused
   * before the listener hears of it.
   */
  onStream(listener: (stream: ExtensionStream) => (() => void) | void): void;
}

export type ExtensionCaller =
  | { kind: "person"; account: string; role: AccountRole; name: string; session: SessionRef }
  /** The operator's access token. */
  | { kind: "operator" }
  /** No accounts: one person on their own computer. */
  | { kind: "local" };

/**
 * Stands for one sign-in for as long as the server runs: the same person
 * signing in again is another. Not the cookie and not its nonce, and of use
 * only to `host.people.counts`.
 */
export type SessionRef = string & { readonly __sessionRef: unique symbol };

/** A site as an extension is handed it: everything but closing it. */
export type GuardedSite = Omit<SiteService, "dispose">;

export interface ExtensionPeople {
  /** The person's name as it is now; null once the account is gone or switched off. */
  name(account: string): string | null;
  /**
   * Whether that sign-in still counts: not signed out, its account there and
   * switched on. One this server doesn't know (from before a restart, or
   * pushed out by thousands of newer ones) doesn't: it can turn false early,
   * never true late.
   */
  counts(session: SessionRef): boolean;
  /** Runs whenever either answer may have changed. Returns how to stop. The listener answers at once: a promise is refused. */
  onChange(listener: () => void): () => void;
}

export interface ExtensionHost {
  events: ExtensionEvents;
  /** Null where there are no accounts (local mode, the desktop app). */
  people: ExtensionPeople | null;
  /**
   * The site as it is open now, or null. Ask each time rather than keep one:
   * a site is closed after an hour without use (unless its preview is
   * running, a job is, or an Undo is still offered on it), when it is removed,
   * when a backup is put back and when the server stops, and one kept from
   * before then refuses every call (SITE_CLOSED).
   */
  sites: { get(siteId: string): Promise<GuardedSite | null> };
  /**
   * Runs `run` outside any person, any publishing name and any site: the way
   * to start work that outlives a request. Work a handler merely leaves
   * running loses its caller's access once the handler has answered, but
   * what it records still carries that person's publishing name.
   */
  outside<T>(run: () => T): T;
  /** A folder of this extension's own under the data folder, readable by the server's user only. It is in backups, and a restore replaces it. */
  stateDir: string;
  /** One line in the server's log, marked with the extension's id. Line breaks and the declared secrets are taken out. Does nothing once the extension has been stopped. */
  log(line: string): void;
  mode: "local" | "hosted";
}
