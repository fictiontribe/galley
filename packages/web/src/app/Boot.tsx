import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api, setUnauthorizedHandler } from "@/lib/api";
import { exchangeToken, takeTokenFromUrl } from "@/lib/auth";
import { connectEvents, disconnectEvents } from "@/lib/events";
import { invalidate, setQueryData } from "@/lib/query";
import { loginUrl, session } from "@/lib/session";
import { useMeta } from "@/lib/stores/meta";
import { useToasts } from "@/lib/stores/toasts";
import { useChanges } from "@/lib/stores/changes";
import { useSite } from "@/lib/stores/site";
import { useSites } from "@/lib/stores/sites";
import { useUi } from "@/lib/stores/ui";
import { keys, startSync } from "@/lib/sync";
import { ErrorState, Skeleton } from "@/ui";

/** The frame's silhouette while the app finds its server. */
function BootSkeleton() {
  return (
    <div className="g-app app-frame" aria-busy="true" aria-label="Loading">
      <div className="g-sidebar app-sidebar">
        <Skeleton width={140} height={20} style={{ margin: "6px 8px 16px" }} />
        {[96, 72, 110, 84].map((width, index) => (
          <Skeleton key={index} width={width} height={12} style={{ margin: "9px 8px" }} />
        ))}
      </div>
      <div className="g-main app-main">
        <div className="g-toolbar app-toolbar" />
        <div />
      </div>
      <div className="g-statusbar app-statusbar" />
    </div>
  );
}

/**
 * Loads /api/meta before anything else renders (the brand and the session
 * live there), hands off a `?token=`, sends signed-out visitors to /login and
 * starts the event stream once signed in.
 */
export function Boot({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { meta, status, error, load } = useMeta();
  const [tokenChecked, setTokenChecked] = useState(false);

  useEffect(() => {
    const token = takeTokenFromUrl();
    void (token ? exchangeToken(token) : Promise.resolve(true)).then(() => {
      setTokenChecked(true);
      void load();
    });
  }, [load]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      const target = session.lost(window.location.pathname + window.location.search);
      if (target === null) return;
      // Once: stop live updates, clear the errors this caused, and go to sign in.
      disconnectEvents();
      useToasts.setState({ toasts: [] });
      const current = useMeta.getState().meta;
      if (current) useMeta.setState({ meta: { ...current, authenticated: false } });
      navigate(target, { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  const authenticated = Boolean(meta?.authenticated);
  useEffect(() => {
    if (!authenticated) return;
    if (session.isLost) {
      // Signed in again: pick up where the stream and the screens left off.
      session.restored();
      connectEvents();
      invalidate([]);
      void useSite.getState().refresh();
      void useChanges.getState().refresh();
    }
    startSync();
    void useSites.getState().load();
    api("GET /api/settings")
      .then((settings) => {
        setQueryData(keys.settings(), settings);
        useUi.getState().setTheme(settings.appearance.theme);
      })
      .catch(() => undefined);
  }, [authenticated]);

  if (!tokenChecked || (status === "loading" && !meta)) return <BootSkeleton />;
  if (status === "error" || !meta) {
    return (
      <div className="app-boot-error">
        <ErrorState title="Can’t reach the app’s server" error={error} onRetry={() => void load()} />
      </div>
    );
  }
  // /open explains a missing session itself in local mode (open the printed link, then try again).
  const explainsItself = location.pathname === "/open" && meta.mode === "local";
  if (!meta.authenticated && location.pathname !== "/login" && !explainsItself) {
    return <Navigate to={loginUrl(location.pathname + location.search)} replace />;
  }
  return <>{children}</>;
}
