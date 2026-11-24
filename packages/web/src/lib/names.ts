import { useCallback } from "react";
import { nameOf, type NamedThing } from "./format";
import { useSite } from "./stores/site";

/** `nameOf` with the open site's collections, so a data file is called by its own name ("Stockists"). */
export function useNameOf(): (thing: NamedThing) => string {
  const collections = useSite((s) => s.detail?.model.collections);
  return useCallback((thing: NamedThing) => nameOf(thing, collections ?? []), [collections]);
}
