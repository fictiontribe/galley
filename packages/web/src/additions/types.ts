/**
 * Additions: what a program that builds its own edition of the editor may
 * draw in the app. Experimental: these shapes may change in any 0.x
 * release, and the changelog says so under "Embedding".
 *
 * An addition is part of the one bundle. It is given to the root component
 * when the program is built (`<App additions={[…]} />`) and nowhere else:
 * no global, address, message or stored value adds one. It is not
 * sandboxed: it can import any module of the app, and a mistake in it is
 * its author's. What the app does for it: a place that crashes while it
 * draws shows nothing there and leaves the screen as it was.
 */
import type { ComponentType } from "react";

export interface Addition {
  /** The same id as its server half: lower-case letters, digits and dashes, 3 to 32, starting with a letter. */
  id: string;
  /**
   * Mounted once inside the signed-in app, and again whenever the person
   * signed in changes. For what an addition keeps going (a subscription, the
   * stream's value); what it draws should be nothing, or small.
   */
  root?: ComponentType;
  /** At the right of the top bar, before the account menu. Small. */
  topBar?: ComponentType;
  /** After the title in a row of a collection's list. Small, and drawn once for every row on screen. */
  listRow?: ComponentType<{ siteId: string; path: string }>;
}

/** The places an addition can draw in. */
export type AdditionPlace = "root" | "topBar" | "listRow";
