/**
 * What an addition may ask the app about where it is and who is signed in.
 * Less than the app itself knows: a convenience for an addition, not a wall
 * around it.
 */
import { useMatch } from "react-router-dom";
import type { AccessLevel, AccountRole } from "@galley/core/install/accounts";
import { accountOf, useMayLevel } from "@/lib/may";
import { useMeta } from "@/lib/stores/meta";

/** The site whose screens are open; null outside a site. */
export function useSiteId(): string | null {
  const inside = useMatch("/sites/:siteId/*");

  return inside?.params.siteId ?? null;
}

/** The signed-in person's name and role; null where there are no accounts (one person on their own computer). */
export function useAccount(): { name: string; role: AccountRole } | null {
  const name = useMeta((s) => accountOf(s.meta)?.name ?? null);
  const role = useMeta((s) => accountOf(s.meta)?.role ?? null);

  return name !== null && role !== null ? { name, role } : null;
}

/** Whether the signed-in person's role has `level`. Always true where there are no accounts. The server decides again at every request. */
export function useRoleMay(level: AccessLevel): boolean {
  return useMayLevel()(level);
}
