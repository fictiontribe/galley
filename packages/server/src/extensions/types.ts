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
   * The environment variables it reads that are secret. They are kept from
   * the site's own commands (its preview, its build) and scrubbed from this
   * extension's log lines and from its error messages. One it doesn't name
   * reaches the site's commands, whose code editors can change.
   */
  secrets?: readonly string[];
  /**
   * Called once, after the engine is put together and before the app answers
   * any request (the port is open by then and answers 503, as it does while
   * any server starts). `signal` fires when the time for starting is up or
   * the server is stopping: stop what was started and return.
   */
  setup(host: ExtensionHost, start: { signal: AbortSignal }): ExtensionParts | Promise<ExtensionParts>;
}

export interface ExtensionParts {
  /** By `"<METHOD> /path"`, relative to the extension: `"GET /sites/:siteId"` is served at `/api/x/<id>/sites/:siteId`. */
  routes?: Record<string, ExtensionRoute<any>>;
  /** Runs when the server stops, before the data folder is let go. May take a few seconds; not more. */
  stop?(): void | Promise<void>;
}

export interface ExtensionRoute<B = undefined> {
  /** Required. */
  access: ExtensionAccess;
  /** Refuses the operator's access token: the route needs a person signed in. */
  person?: true;
  /**
   * Required on POST, PUT and PATCH, refused on GET and DELETE: turns the
   * parsed JSON (`undefined` for an empty body) into what the handler takes,
   * or throws `invalid(…)`.
   */
  body?: (input: unknown) => B;
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
   * `.git/` and `.env*` can't be read through it, and on GET it refuses
   * whatever would change the site.
   */
  site?: GuardedSite;
  /** Fires when whoever asked gave up on the request. */
  signal: AbortSignal;
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
  /** Whether that sign-in still counts: not signed out, its account there and switched on. One this server doesn't know (from before a restart) doesn't. */
  counts(session: SessionRef): boolean;
  /** Runs whenever either answer may have changed. Returns how to stop. The listener answers at once: a promise is refused. */
  onChange(listener: () => void): () => void;
}

export interface ExtensionHost {
  /** Null where there are no accounts (local mode, the desktop app). */
  people: ExtensionPeople | null;
  sites: { get(siteId: string): Promise<GuardedSite | null> };
  /**
   * Runs `run` outside any person, any publishing name and any site: the way
   * to start work that outlives a request. Work a handler merely leaves
   * running stops being its caller's once the handler has answered.
   */
  outside<T>(run: () => T): T;
  /** A folder of this extension's own under the data folder, readable by the server's user only. It is in backups, and a restore replaces it. */
  stateDir: string;
  /** One line in the server's log, marked with the extension's id. Line breaks and the declared secrets are taken out. */
  log(line: string): void;
  mode: "local" | "hosted";
}
