/**
 * A link to a settings page from somewhere else ("Open settings" when the
 * assistant has no key, "Open site settings" when the preview stopped). For
 * someone whose role doesn't include that page, a plain line saying who can
 * do it instead — never a link to a page they can't use.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ApiRouteKey } from "@galley/core/api";
import { useMay } from "@/lib/may";

export const ASK_AN_OWNER = "An owner of this editor can set this up.";

export function SettingsLink({ route, to, className, children, fallback = ASK_AN_OWNER }: { route: ApiRouteKey; to: string; className?: string; children: ReactNode; fallback?: ReactNode }) {
  const may = useMay();
  if (may(route)) {
    return (
      <Link className={className} to={to}>
        {children}
      </Link>
    );
  }
  return fallback === null ? null : <span className="g-hint">{fallback}</span>;
}
