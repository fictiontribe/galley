/**
 * Who a published version is recorded as. The most specific choice wins:
 *
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
export type AuthorSource = "site" | "repository" | "app" | "machine" | "default";

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

const complete = (identity: Partial<Identity> | null | undefined): identity is Identity => Boolean(identity?.name?.trim() && identity.email?.trim());
const clean = (identity: Identity): Identity => ({ name: identity.name.trim(), email: identity.email.trim() });

export function chooseAuthor(layers: { site?: Partial<Identity> | null; repository?: Partial<Identity> | null; app?: Partial<Identity> | null; machine?: Partial<Identity> | null }): ChosenAuthor {
  for (const from of ["site", "repository", "app", "machine"] as const) {
    const identity = layers[from];

    if (complete(identity)) return { ...clean(identity), from };
  }
  return { ...DEFAULT_AUTHOR, from: "default" };
}
