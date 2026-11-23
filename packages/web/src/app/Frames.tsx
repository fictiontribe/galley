import { Suspense, useEffect, useRef } from "react";
import { Link, Outlet, useLocation, useParams } from "react-router-dom";
import { isApiFailure } from "@/lib/api";
import { useChanges } from "@/lib/stores/changes";
import { useSite } from "@/lib/stores/site";
import { useUi } from "@/lib/stores/ui";
import { EmptyState, ErrorState, Skeleton, buttonClass, cx } from "@/ui";
import { ErrorBoundary } from "./ErrorBoundary";
import { HomeSidebar, SiteSidebar } from "./Sidebar";
import { HomeStatusBar, SiteStatusBar } from "./StatusBar";
import { HomeTopBar, SiteTopBar } from "./TopBar";
import { useTopBar } from "./chrome";

/** What a lazily loaded screen shows while its code arrives: the shape of a screen, not a spinner. */
export function ScreenSkeleton() {
  return (
    <div className="app-screen" aria-busy="true">
      <div className="app-screen__inner">
        <Skeleton width={120} height={12} />
        <Skeleton width={280} height={28} style={{ marginBlock: "var(--space-3) var(--space-6)" }} />
        <Skeleton lines={4} height={14} />
      </div>
    </div>
  );
}

function Content() {
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  // When a screen change takes the focused control away (a link or button that
  // navigated), keyboard and screen-reader users continue from the new screen,
  // not from the top of the document.
  useEffect(() => {
    // The screen the app opened on starts at the top, where the skip link is.
    if (location.key === "default") return;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body) main.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, location.key]);
  return (
    <main className="app-content" id="main" ref={main} tabIndex={-1}>
      <ErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<ScreenSkeleton />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    </main>
  );
}

function SkipLink() {
  return (
    <a className="app-skip" href="#main">
      Skip to content
    </a>
  );
}

/** Sidebar + top bar + content + status bar for screens outside a site. */
export function HomeFrame() {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const closeSite = useSite((s) => s.close);
  const clearChanges = useChanges((s) => s.clear);
  useEffect(() => {
    closeSite();
    clearChanges();
  }, [closeSite, clearChanges]);
  return (
    <div className={cx("g-app app-frame", collapsed && "app-frame--collapsed")}>
      <SkipLink />
      <HomeSidebar />
      <div className="g-main app-main">
        <HomeTopBar />
        <Content />
      </div>
      <HomeStatusBar />
    </div>
  );
}

function SiteProblem({ error }: { error: unknown }) {
  useTopBar({ crumbs: [{ label: "Sites", to: "/" }, { label: "Site" }] });
  const notFound = isApiFailure(error) && error.status === 404;
  return (
    <div className="app-screen app-screen--center">
      {notFound ? (
        <EmptyState
          title="This site isn’t in your list."
          body="It may have been forgotten from this app. Its files are still wherever they were on disk."
          mark="dele"
          actions={
            <Link className={buttonClass("primary")} to="/?open=folder">
              Open a site
            </Link>
          }
        />
      ) : (
        <ErrorState title="Couldn’t open this site" error={error} onRetry={() => void useSite.getState().refresh()} />
      )}
    </div>
  );
}

function MissingFolder({ name, root }: { name: string; root: string }) {
  useTopBar({ crumbs: [{ label: "Sites", to: "/" }, { label: name }] });
  return (
    <div className="app-screen app-screen--center">
      <EmptyState
        title="This site’s folder is missing."
        body={
          <>
            Nothing was deleted by this app. The folder may have been moved or renamed — it used to be at <span className="g-mono">{root}</span>.
          </>
        }
        mark="bang"
        actions={
          <Link className={buttonClass("primary")} to="/?open=folder">
            Find the folder
          </Link>
        }
      />
    </div>
  );
}

/** The app frame for one site, matching the specimen: sidebar, top bar with Publish, status bar. */
export function SiteFrame() {
  const { siteId = "" } = useParams();
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const open = useSite((s) => s.open);
  const status = useSite((s) => s.status);
  const error = useSite((s) => s.error);
  const detail = useSite((s) => s.detail);
  const loadChanges = useChanges((s) => s.load);

  useEffect(() => {
    void open(siteId);
    void loadChanges(siteId);
  }, [siteId, open, loadChanges]);

  let body = <Content />;
  if (status === "error") body = <SiteProblem error={error} />;
  else if (detail?.missing) body = <MissingFolder name={detail.name} root={detail.root} />;

  return (
    <div className={cx("g-app app-frame", collapsed && "app-frame--collapsed")}>
      <SkipLink />
      <SiteSidebar siteId={siteId} />
      <div className="g-main app-main">
        <SiteTopBar siteId={siteId} />
        {body}
      </div>
      <SiteStatusBar siteId={siteId} />
    </div>
  );
}
