import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { RouteResponse } from "@galley/core/api";
import { api, isApiFailure } from "@/lib/api";
import { loginUrl } from "@/lib/session";
import { useMeta } from "@/lib/stores/meta";
import { useSites } from "@/lib/stores/sites";
import { Button, ErrorState, Logo, Spinner, buttonClass } from "@/ui";
import { editorAddress } from "./address";

type Answer = RouteResponse<"GET /api/open">;

type State =
  | { kind: "loading" }
  | { kind: "unregistered"; name: string; root: string }
  | { kind: "signed-out" }
  | { kind: "invalid" }
  | { kind: "error"; error: unknown };

/**
 * /open?root=<folder>&url=<page> — the site's own dev toolbar links here.
 * Opens the editor at that page, asks before adding a folder that isn't in
 * the list yet, and explains plainly when the link can't be followed.
 */
export function OpenScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const root = params.get("root") ?? "";
  const url = params.get("url");
  const meta = useMeta((s) => s.meta);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [opening, setOpening] = useState(false);
  const product = meta?.brand.productName ?? "";

  const go = useCallback(
    async (answer: Extract<Answer, { state: "ready" }>) => {
      // A session made since this page loaded (the printed link opened meanwhile) has to be known first.
      if (!useMeta.getState().meta?.authenticated) await useMeta.getState().load();
      navigate(editorAddress(answer.siteId, answer.entry, url), { replace: true });
    },
    [navigate, url],
  );

  const resolve = useCallback(async () => {
    if (!root) {
      setState({ kind: "invalid" });
      return;
    }
    setState({ kind: "loading" });
    try {
      const answer = await api("GET /api/open", { query: { root, ...(url ? { url } : {}) } });
      if (answer.state === "ready") await go(answer);
      else setState({ kind: "unregistered", name: answer.name, root: answer.root });
    } catch (error) {
      if (isApiFailure(error) && (error.status === 401 || error.shape.code === "unauthorized")) {
        if (useMeta.getState().meta?.mode === "hosted") navigate(loginUrl(window.location.pathname + window.location.search), { replace: true });
        else setState({ kind: "signed-out" });
      } else if (isApiFailure(error) && (error.status === 400 || error.shape.code === "invalid")) setState({ kind: "invalid" });
      else setState({ kind: "error", error });
    }
  }, [root, url, go, navigate]);

  useEffect(() => {
    document.title = product ? `Open a site · ${product}` : "";
    void resolve();
  }, [resolve, product]);

  const openSite = async () => {
    if (state.kind !== "unregistered") return;
    setOpening(true);
    try {
      await api("POST /api/sites/open", { body: { path: state.root } });
      void useSites.getState().load();
      await resolve();
    } catch (error) {
      setState({ kind: "error", error });
    } finally {
      setOpening(false);
    }
  };

  let body;
  switch (state.kind) {
    case "loading":
      body = (
        <p className="app-login__body app-open__working" role="status">
          <Spinner label="Opening" />
          Opening the page…
        </p>
      );
      break;
    case "unregistered":
      body = (
        <>
          <h1 className="app-login__title">{`Open “${state.name}” in ${product}?`}</h1>
          <p className="app-login__body">It isn’t in your list of sites yet. Opening it adds it to the list; nothing in the folder changes until you publish.</p>
          <p className="app-open__folder g-mono" title={state.root}>
            {state.root}
          </p>
          <div className="app-open__actions">
            <Link className={buttonClass("quiet", "md")} to="/">
              Not now
            </Link>
            <Button variant="primary" busy={opening} busyLabel="Opening…" onClick={() => void openSite()} data-autofocus autoFocus>
              Open site
            </Button>
          </div>
        </>
      );
      break;
    case "signed-out":
      body = (
        <>
          <h1 className="app-login__title">Open the app from its link first.</h1>
          <p className="app-login__body">For safety, this app only opens from the link it printed when it started. Open that link in this browser, then try again.</p>
          <div className="app-open__actions">
            <Button variant="primary" onClick={() => void resolve()} autoFocus>
              Try again
            </Button>
          </div>
        </>
      );
      break;
    case "invalid":
      body = (
        <>
          <h1 className="app-login__title">That link isn’t one this app can open.</h1>
          <p className="app-login__body">It needs the folder of a site on this computer. Choose the site from your list instead.</p>
          <div className="app-open__actions">
            <Link className={buttonClass("primary", "md")} to="/">
              Go to your sites
            </Link>
          </div>
        </>
      );
      break;
    case "error":
      body = <ErrorState compact title="Couldn’t open that page" error={state.error} onRetry={() => void resolve()} />;
      break;
  }

  return (
    <div className="app-login">
      <div className="g-sheet g-crop app-login__sheet app-open" aria-busy={state.kind === "loading"}>
        <div className="app-login__brand">
          <Logo />
          <span className="g-brand__name">{product}</span>
        </div>
        {body}
      </div>
    </div>
  );
}
