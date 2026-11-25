/**
 * Where additions are drawn. With no additions every place renders nothing,
 * not even an empty element: the app is as it is without them.
 */
import { Component, createContext, useContext, useMemo, type ComponentType, type ReactNode } from "react";
import { accountOf } from "@/lib/may";
import { useMeta } from "@/lib/stores/meta";
import type { Addition, AdditionPlace } from "./types";

const ID = /^[a-z][a-z0-9-]{2,31}$/;
const PLACES: readonly AdditionPlace[] = ["root", "topBar", "listRow"];
const NONE: readonly Addition[] = Object.freeze([]);

const AdditionsContext = createContext<readonly Addition[]>(NONE);

/** The additions as the app keeps them: checked once, copied, and not to be changed afterwards. */
export function checkedAdditions(additions: readonly Addition[] | undefined): readonly Addition[] {
  if (!additions || additions.length === 0) return NONE;
  const seen = new Set<string>();

  return Object.freeze(
    additions.map((addition) => {
      if (typeof addition?.id !== "string" || !ID.test(addition.id)) throw new Error(`The addition id “${String(addition?.id)}” isn't usable. An id is lower-case letters, digits and dashes, 3 to 32 characters, starting with a letter.`);
      if (seen.has(addition.id)) throw new Error(`The addition id “${addition.id}” isn't usable: two additions have it.`);
      seen.add(addition.id);
      for (const place of PLACES) {
        if (addition[place] !== undefined && typeof addition[place] !== "function" && typeof addition[place] !== "object") throw new Error(`The addition “${addition.id}” gives something for ${place} that isn't a component.`);
      }
      return Object.freeze({ id: addition.id, ...(addition.root ? { root: addition.root } : {}), ...(addition.topBar ? { topBar: addition.topBar } : {}), ...(addition.listRow ? { listRow: addition.listRow } : {}) });
    }),
  );
}

export function AdditionsProvider({ additions, children }: { additions: readonly Addition[] | undefined; children: ReactNode }) {
  // Set once, when the app starts: what is passed on a later render is not looked at.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const checked = useMemo(() => checkedAdditions(additions), []);

  return <AdditionsContext.Provider value={checked}>{children}</AdditionsContext.Provider>;
}

/** Said once for each addition and place, however often it fails. */
const said = new Set<string>();

interface BoundaryProps {
  id: string;
  place: AdditionPlace;
  children: ReactNode;
}

/** An addition that crashes while it draws shows nothing in that place. The screen around it stays. */
class AdditionBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    const key = `${this.props.id} ${this.props.place}`;

    if (said.has(key)) return;
    said.add(key);
    console.error(`The addition “${this.props.id}” failed while drawing in ${this.props.place}, so nothing is shown there.`, error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function drawn<P extends object>(additions: readonly Addition[], place: AdditionPlace, props: P, keyed = ""): ReactNode {
  const parts = additions.flatMap((addition) => {
    const Part = addition[place] as ComponentType<P> | undefined;

    return Part
      ? [
          <AdditionBoundary key={`${addition.id}${keyed}`} id={addition.id} place={place}>
            <Part {...props} />
          </AdditionBoundary>,
        ]
      : [];
  });

  return parts.length ? parts : null;
}

/** Every addition's `root`, inside the signed-in app. Mounted again when the person signed in changes. */
export function AdditionRoots() {
  const additions = useContext(AdditionsContext);
  const signedIn = useMeta((s) => Boolean(s.meta?.authenticated));
  const who = useMeta((s) => accountOf(s.meta)?.id ?? "");

  return additions.length && signedIn ? drawn(additions, "root", {}, ` ${who}`) : null;
}

/** What additions draw at the right of the top bar. */
export function TopBarAdditions() {
  const additions = useContext(AdditionsContext);

  return additions.length ? drawn(additions, "topBar", {}) : null;
}

/** Whether any addition draws in a list's rows: a row is laid out for it only then. */
export function useHasListRowAdditions(): boolean {
  return useContext(AdditionsContext).some((addition) => addition.listRow);
}

/** What additions draw after the title in a row of a collection's list. */
export function ListRowAdditions({ siteId, path }: { siteId: string; path: string }) {
  const additions = useContext(AdditionsContext);

  return additions.length ? drawn(additions, "listRow", { siteId, path }) : null;
}
