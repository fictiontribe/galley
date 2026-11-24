import type { PreviewState } from "@galley/core/types";
import { useConnection } from "@/lib/events";
import { count, relativeTime } from "@/lib/format";
import { usePendingCount } from "@/lib/stores/changes";
import { useHostedInstall } from "@/lib/stores/meta";
import { usePreviewStatus } from "@/lib/stores/preview";
import { useSite } from "@/lib/stores/site";
import { useState } from "react";
import { sendNowWithToast } from "@/features/proof/sendNow";
import { Kbd, ProofMark, Spinner } from "@/ui";
import { DeployStatusItem } from "@/features/deploy/DeployStatusItem";
import { AttentionIndicator } from "@/features/sites/AttentionIndicator";

const PREVIEW_TEXT: Record<PreviewState, string> = {
  idle: "Preview off",
  stopped: "Preview off",
  installing: "Preparing preview",
  starting: "Preview starting",
  ready: "Preview running",
  error: "Preview stopped",
};

function PreviewItem({ siteId }: { siteId: string }) {
  const status = usePreviewStatus(siteId);
  const state = status?.state ?? "idle";
  const working = state === "installing" || state === "starting";
  return (
    <span className={`g-statusbar__item app-status--${state}`} title={status?.detail}>
      {working ? <Spinner label={PREVIEW_TEXT[state]} /> : <ProofMark kind={state === "error" ? "bang" : "reg"} className="app-status__mark" />}
      {PREVIEW_TEXT[state]}
    </span>
  );
}

/** "3 sites need attention" — only where there are other sites. */
function OtherSitesItem() {
  const hosted = useHostedInstall();
  return hosted ? null : <AttentionIndicator />;
}

function ConnectionItem() {
  const { state, retryIn } = useConnection();
  if (state !== "down") return null;
  return (
    <span className="g-statusbar__item app-status--offline" role="status">
      <ProofMark kind="bang" />
      Live updates paused — reconnecting{retryIn ? ` in ${retryIn} s` : ""}
    </span>
  );
}

/** Versions published here that haven't reached the host: "2 versions not sent yet · Send now". */
function UnsentItem({ siteId }: { siteId: string }) {
  const git = useSite((s) => s.detail?.git);
  const [sending, setSending] = useState(false);
  const ahead = git?.hasRemote ? git.ahead : 0;
  if (ahead <= 0) return null;
  return (
    <span className="g-statusbar__item app-status--unsent">
      <ProofMark kind="bang" />
      {count(ahead, "version")} not sent yet
      <span aria-hidden="true">·</span>
      <button
        type="button"
        className="app-link-button app-status__action"
        disabled={sending}
        onClick={() => {
          setSending(true);
          void sendNowWithToast(siteId, ahead).finally(() => setSending(false));
        }}
      >
        {sending ? "Sending…" : "Send now"}
      </button>
    </span>
  );
}

/** Bottom status line: preview, unpublished changes, last publish, connection. */
export function SiteStatusBar({ siteId }: { siteId: string }) {
  const pending = usePendingCount();
  const lastCommit = useSite((s) => s.detail?.git.lastCommit);
  return (
    <footer className="g-statusbar app-statusbar">
      <PreviewItem siteId={siteId} />
      <span className="g-statusbar__item app-hide-narrow">{pending > 0 ? count(pending, "unpublished change") : "Everything is published"}</span>
      {lastCommit ? <span className="g-statusbar__item app-hide-narrow">Last published {relativeTime(lastCommit.date)}</span> : null}
      <UnsentItem siteId={siteId} />
      <DeployStatusItem siteId={siteId} />
      <span className="g-toolbar__spacer" />
      <OtherSitesItem />
      <ConnectionItem />
      <span className="g-statusbar__item app-hide-narrow">
        <Kbd keys={["mod", "K"]} /> to jump
      </span>
    </footer>
  );
}

export function HomeStatusBar() {
  return (
    <footer className="g-statusbar app-statusbar">
      <span className="g-toolbar__spacer" />
      <OtherSitesItem />
      <ConnectionItem />
      <span className="g-statusbar__item">
        <Kbd keys={["mod", "K"]} /> to jump
      </span>
    </footer>
  );
}
