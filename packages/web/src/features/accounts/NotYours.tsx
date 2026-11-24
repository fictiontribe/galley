/**
 * What a person sees at the address of a screen their account doesn't
 * include — an old bookmark, a link from someone else, or a role changed
 * while the page was open. A plain page, not an error.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ApiRouteKey } from "@galley/core/api";
import { useTopBar } from "@/app/chrome";
import { useMay } from "@/lib/may";
import { EmptyState, buttonClass } from "@/ui";

export const NOT_YOURS_TITLE = "This isn’t part of your account.";

export function NotYours() {
  useTopBar({ crumbs: [{ label: "Not part of your account" }] });
  return (
    <div className="app-screen app-screen--center">
      <EmptyState
        title={NOT_YOURS_TITLE}
        body="Your role on this editor doesn’t include this page. If you need it, ask an owner of this editor."
        mark="stet"
        actions={
          <Link className={buttonClass("primary")} to="/">
            Go to the site
          </Link>
        }
      />
    </div>
  );
}

/** Shows `children` when the signed-in person may call `route` (the page's own reason to exist); otherwise NotYours. */
export function Allowed({ route, children }: { route: ApiRouteKey; children: ReactNode }) {
  const may = useMay();
  return may(route) ? <>{children}</> : <NotYours />;
}
