import { useCallback, useMemo } from "react";
import type { Collection, FileChange } from "@galley/core/types";
import { useSite } from "@/lib/stores/site";
import { sectionLabels, titleOf } from "./changes";

const NONE: Collection[] = [];

/** The site's collections, for naming and grouping changes. */
export function useCollections(): Collection[] {
  return useSite((s) => s.detail?.model.collections) ?? NONE;
}

/** The site's section types by their labels ("faq" → "FAQ"), for naming a section that was added or removed. */
export function useSectionLabels(): ReadonlyMap<string, string> {
  const collections = useCollections();
  return useMemo(() => sectionLabels(collections), [collections]);
}

/** `name(change)`: what a person calls a changed file on this site. */
export function useChangeName(): (change: FileChange) => string {
  const collections = useCollections();
  return useCallback((change: FileChange) => titleOf(change, collections), [collections]);
}
