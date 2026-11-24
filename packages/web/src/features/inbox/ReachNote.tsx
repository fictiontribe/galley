/**
 * “Can visitors reach the inbox?” — the honest note shown wherever the inbox
 * is offered as a destination. The form builder can mount
 * `<CaptureReachNote siteId={…} />` beside the "Galley inbox" destination.
 */
import type { CaptureSettings } from "@galley/core/api";
import { useHostedInstall } from "@/lib/stores/meta";
import { Icon, Skeleton, cx } from "@/ui";
import { useCaptureSettings } from "./data";
import { editorAddress, inboxReach } from "./reach";
import "./inbox.css";
import { useMay } from "@/lib/may";

export function ReachText({ settings, compact }: { settings: CaptureSettings; compact?: boolean }) {
  const reach = inboxReach(settings.captureReachable, useHostedInstall(), settings.captureReach);
  if (reach === "private-address") {
    return (
      <div className={cx("app-reach", "app-reach--warning", compact && "app-reach--compact")} role="note">
        <Icon name="warning" />
        <div>
          <p className="app-reach__lead">
            This editor’s address, <span className="g-mono">{editorAddress(settings.captureAddress)}</span>, isn’t one visitors’ browsers can reach, so the live site’s forms can’t send to this inbox.
          </p>
          <p>Give the editor a public address, or send the form to a webhook or your CRM instead.</p>
          {compact ? null : <p className="app-reach__address g-mono">{settings.captureAddress}</p>}
        </div>
      </div>
    );
  }
  if (reach === "reachable") {
    return (
      <div className={cx("app-reach", "app-reach--ok", compact && "app-reach--compact")} role="note">
        <Icon name="globe" />
        <div>
          <p>{settings.reachability}</p>
          <p className="app-reach__address g-mono">{settings.captureAddress}</p>
        </div>
      </div>
    );
  }
  return (
    <div className={cx("app-reach", "app-reach--warning", compact && "app-reach--compact")} role="note">
      <Icon name="warning" />
      <div>
        <p className="app-reach__lead">{settings.reachability}</p>
        {compact ? null : (
          <>
            <p>
              Visitors’ browsers can’t reach <span className="g-mono">{new URL(settings.captureAddress).host}</span>. To collect real submissions, run this app on a server with a public address (hosted mode), or send the form to a webhook or your CRM instead.
            </p>
            <p className="app-reach__address g-mono">{settings.captureAddress}</p>
          </>
        )}
      </div>
    </div>
  );
}

/** Loads the site's capture settings and says whether visitors can reach the inbox. */
export function CaptureReachNote({ siteId, compact }: { siteId: string; compact?: boolean }) {
  // The capture settings are read by people who may read the inbox; for anyone else there is no note to show.
  const mayRead = useMay()("GET /api/sites/:siteId/capture");
  const settings = useCaptureSettings(mayRead ? siteId : "");
  if (!mayRead) return null;
  if (settings.loading) return <Skeleton height={44} />;
  if (!settings.data) return null;
  return <ReachText settings={settings.data} compact={compact} />;
}
