import { useCallback, useState } from "react";

/** State remembered on this computer (localStorage), for small view preferences. */
export function useStoredState<T extends string | number | boolean>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return fallback;
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === typeof fallback ? (parsed as T) : fallback;
    } catch {
      return fallback;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Private windows may refuse storage; the choice still holds for this visit.
      }
    },
    [key],
  );
  return [value, set];
}
