import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api, getSetupCode, setForbiddenHandler, setSetupCode, setUnauthorizedHandler } from "@/lib/api";
import { exchangeToken, takeTokenFromUrl } from "@/lib/auth";
import { connectEvents, disconnectEvents } from "@/lib/events";
import { invalidate, setQueryData } from "@/lib/query";
import { SETUP_PATH, hostedInstall, isHostedInstall, resumesAfterSignIn } from "@/lib/hosted";
import { loginUrl, session } from "@/lib/session";
import { accountOf } from "@/lib/may";
import { linkKindAt, takeLinkCode } from "@/features/accounts/logic";
import { useMeta } from "@/lib/stores/meta";
import { useToasts } from "@/lib/stores/toasts";
import { useChanges } from "@/lib/stores/changes";
import { useSite } from "@/lib/stores/site";
import { useSites } from "@/lib/stores/sites";
import { keys, startSync } from "@/lib/sync";
import { ErrorState, Skeleton } from "@/ui";
import { followSettingsTheme } from "./theme";

const FORBIDDEN_RELOAD_MS = 5_000;

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
    // A one-time link's code leaves the address bar before anything else happens; its page picks it up.
    if (linkKindAt(window.location.pathname)) takeLinkCode();
    const token = takeTokenFromUrl();
    // On /setup the code is a hosted install's one-time setup code, not a
    // session: kept in memory for the setup screens, never exchanged.
    if (token && window.location.pathname === SETUP_PATH) {
      setSetupCode(token);
      setTokenChecked(true);
      void load();
      return;
    }
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

  useEffect(() => {
    // A refusal may mean an owner changed this person's role meanwhile: ask again, at most every few seconds.
    let last = 0;
    setForbiddenHandler(() => {
      if (!accountOf(useMeta.getState().meta) || Date.now() - last < FORBIDDEN_RELOAD_MS) return;
      last = Date.now();
      void useMeta.getState().load();
    });
    return () => setForbiddenHandler(null);
  }, []);

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
        // Local mode: the saved theme is the computer's. Hosted: it is where a browser starts, until its person chooses.
        followSettingsTheme(settings);
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
  // First run left half-way (a password exists): signing in carries it on, unless this visit brought a setup link, which /setup explains.
  const resumes = resumesAfterSignIn(meta);
  // /open explains a missing session itself in local mode (open the printed link, then try again);
  // a hosted install's first run happens before there is a password to sign in with.
  // A one-time link (an invitation, a new password) is how someone without a password gets one.
  const explainsItself =
    (location.pathname === "/open" && meta.mode === "local") ||
    (location.pathname === SETUP_PATH && isHostedInstall(meta) && !(resumes && getSetupCode() === null)) ||
    (isHostedInstall(meta) && linkKindAt(location.pathname) !== null);
  if (!meta.authenticated && location.pathname !== "/login" && !explainsItself) {
    if (resumes) return <Navigate to={loginUrl(SETUP_PATH)} replace />;
    // First run isn't over and no password exists yet: /setup says what to do.
    if (hostedInstall(meta)?.setupNeeded) return <Navigate to={SETUP_PATH} replace />;
    return <Navigate to={loginUrl(location.pathname + location.search)} replace />;
  }
  return <>{children}</>;
}
