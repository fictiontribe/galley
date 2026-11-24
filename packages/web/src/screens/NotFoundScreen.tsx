import { Link, useLocation, useParams } from "react-router-dom";
import { useTopBar } from "@/app/chrome";
import { useHostedInstall } from "@/lib/stores/meta";
import { EmptyState, buttonClass } from "@/ui";

/** Any address the app doesn't know. */
export function NotFoundScreen() {
  const location = useLocation();
  const { siteId } = useParams();
  const hosted = useHostedInstall();
  useTopBar({ crumbs: [{ label: "Not found" }] });
  return (
    <div className="app-screen app-screen--center">
      <EmptyState
        title="Nothing lives at this address."
        body={
          <>
            <span className="g-mono">{location.pathname}</span> doesn’t match any screen. It may be an old link.
          </>
        }
        mark="dele"
        actions={
          <Link className={buttonClass("primary")} to={siteId ? `/sites/${siteId}` : "/"}>
            {siteId ? "Go to site home" : hosted ? "Go to the site" : "Go to sites"}
          </Link>
        }
      />
    </div>
  );
}
