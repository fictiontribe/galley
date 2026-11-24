/**
 * Who a published version is recorded as. The most specific choice wins:
 *
 *   0. on a hosted install, the signed-in person whose request it is
 *      (`withAccountAuthor`, set by the server for the whole request and the
 *      work it starts),
 *   1. this site's own author (Site settings › Connections),
 *   2. the site repository's own git settings (`git config --local`),
 *   3. the app's author (App settings › You), when someone saved one,
 *   4. this computer's global git identity,
 *   5. a neutral "Site editor".
 *
 * A repository that names its author on purpose (a team's shared identity,
 * a client's bot account) is honoured over the app-wide setting; the app's
 * setting still beats whatever the computer happens to be configured with.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { tidyName } from "../install/names";

export type AuthorSource = "account" | "site" | "repository" | "app" | "machine" | "default";

export interface Identity {
  name: string;
  email: string;
}

export interface ChosenAuthor extends Identity {
  from: AuthorSource;
}

/** The layers that live outside the repository: the site's own author and the app's, as saved (never filled in). */
export interface AuthorLayers {
  site?: Identity | null;
  app?: Identity | null;
}

export const DEFAULT_AUTHOR: Identity = { name: "Site editor", email: "site-editor@localhost" };

// A publishing name is shown beside every version it made: kept, like a person's name, without what nobody sees (install/names.ts).
const complete = (identity: Partial<Identity> | null | undefined): identity is Identity => Boolean(tidyName(identity?.name ?? "") && identity?.email?.trim());
const clean = (identity: Identity): Identity => ({ name: tidyName(identity.name), email: identity.email.trim() });

export function chooseAuthor(layers: { site?: Partial<Identity> | null; repository?: Partial<Identity> | null; app?: Partial<Identity> | null; machine?: Partial<Identity> | null }): ChosenAuthor {
  for (const from of ["site", "repository", "app", "machine"] as const) {
    const identity = layers[from];

    if (complete(identity)) return { ...clean(identity), from };
  }
  return { ...DEFAULT_AUTHOR, from: "default" };
}

const accountAuthor = new AsyncLocalStorage<Identity>();

/**
 * Runs `run` as the signed-in person: everything it records in a repository
 * — a publish, undoing one, the work it starts that outlives the request —
 * carries their name and e-mail. Like the site's scope (site/scope.ts) it
 * follows the asynchronous work, so no id has to be threaded through. An
 * incomplete identity (no e-mail yet) changes nothing.
 */
export function withAccountAuthor<T>(identity: Partial<Identity> | null, run: () => T): T {
  return complete(identity) ? accountAuthor.run(clean(identity), run) : run();
}

/** Runs `run` as nobody's work: what it records later falls back to the site's, the repository's or the app's author. */
export function withoutAccountAuthor<T>(run: () => T): T {
  return accountAuthor.exit(run);
}

/** The signed-in person whose work this is, or null outside such a request (local mode, a script's token, a timer). */
export function currentAccountAuthor(): Identity | null {
  return accountAuthor.getStore() ?? null;
}
