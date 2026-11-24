/**
 * The site's online state where people look for it: a card on Site home and
 * in Site settings, "Put live" beside the newest version in Version history,
 * the note in the Publish dialog's result, and the Online screen with every
 * deployment made from here.
 */
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Deployment } from "@galley/core/types";
import { useTopBar } from "@/app/chrome";
import { EditorOnlineSection } from "@/features/hosting/EditorOnline";
import { api, errorShape } from "@/lib/api";
import { absoluteTime, bytes, count, relativeTime } from "@/lib/format";
import { useQuery } from "@/lib/query";
import { notify } from "@/lib/stores/toasts";
import { keys } from "@/lib/sync";
import { Badge, Button, EmptyState, ErrorState, Icon, PageHeader, Skeleton, Toggle, buttonClass } from "@/ui";
import { putLive } from "./DeployStatusItem";
import { hostOf, statusLine, targetName } from "./logic";
export { onlineOutcome } from "./logic";
import { copyText, DeployProgress } from "./parts";
import { DomainSection } from "./Domain";
import { SharePreviewButton } from "./SharePreview";
import { deployKeys, setAutoDeploy, useDeployStatus, useDeployTargets, useDeployUi, useLatestDeployJob } from "./useDeploy";
import { useMay } from "@/lib/may";
import "./deploy.css";

/** The label the engine gives a deploy that publishing started by itself. */
const AUTO_LABEL = "Putting the published version live";

/** Site home / Site settings: where the site lives, and the buttons that change it. */
export function OnlineCard({ siteId, variant = "home", listLink = true }: { siteId: string; variant?: "home" | "settings"; listLink?: boolean }) {
  const status = useDeployStatus(siteId);
  const targets = useDeployTargets();
  const data = status.data;
  const line = statusLine(data, status.job);
  const config = data?.config;
  /** The switch's new position while it is being saved. */
  const [saving, setSaving] = useState<boolean | null>(null);
  const may = useMay();
  // Choosing where the site is hosted is the install's business; putting it live is a publish.
  const maySetUp = may("PUT /api/sites/:siteId/deploy");
  const mayPutLive = may("POST /api/sites/:siteId/deploy");

  if (status.loading) return <Skeleton height={120} />;
  if (!data) return <ErrorState compact title="Couldn’t check whether the site is online" error={status.error} onRetry={() => void status.refetch()} />;

  return (
    <div className="app-card app-card--pad deploy-card">
      {!config ? (
        <>
          {maySetUp ? (
            <>
              <p className="deploy-card__text">Put the site at a real address with Cloudflare or Vercel. After that, publishing can put changes live by itself, and you can share a preview link before you publish.</p>
              <div className="deploy-card__actions">
                <Button variant="primary" size="sm" icon="globe" onClick={() => useDeployUi.getState().openSetup()}>
                  Put this site online
                </Button>
              </div>
            </>
          ) : (
            <p className="deploy-card__text">The site isn’t at an address of its own yet. An owner of this editor can put it online.</p>
          )}
        </>
      ) : (
        <>
          {data.production ? (
            // The copy control sits beside the address it copies, with its name on it.
            <div className="deploy-card__address-row">
              <a className="deploy-card__address" href={data.production.url} target="_blank" rel="noopener noreferrer">
                {hostOf(data.production.url)}
                <Icon name="external" />
              </a>
              <Button variant="quiet" size="sm" icon="copy" aria-label="Copy the address" onClick={() => copyText(data.production!.url)}>
                Copy
              </Button>
            </div>
          ) : null}
          <p className={`deploy-card__line deploy-card__line--${line.tone}`}>{line.tone === "success" && data.production ? `Live · updated ${relativeTime(data.production.createdAt)}` : line.text}</p>
          {status.job?.state === "running" ? <DeployProgress job={status.job} intent={status.job.label.startsWith("Making") ? "preview" : "production"} /> : null}
          <p className="g-hint">
            On {targetName(targets.data, config.target)} · project <span className="g-mono">{config.project}</span>
          </p>
          <div className="deploy-card__actions">
            {mayPutLive && (data.behind !== 0 || !data.production) ? (
              <Button variant="primary" size="sm" disabled={status.job?.state === "running"} onClick={() => void putLive(siteId)}>
                Put live
              </Button>
            ) : null}
            {variant === "home" ? <SharePreviewButton siteId={siteId} /> : null}
            {listLink ? (
              <Link className={buttonClass("quiet", "sm")} to={`/sites/${siteId}/online`}>
                Deployments
              </Link>
            ) : null}
          </div>
          {variant === "settings" && maySetUp ? <DomainSection siteId={siteId} /> : null}
          {variant === "settings" && maySetUp ? (
            <div className="deploy-card__settings">
              <Toggle
                checked={saving ?? Boolean(config.autoDeploy)}
                onChange={(checked) => {
                  setSaving(checked);
                  void setAutoDeploy(siteId, checked)
                    .catch((caught: unknown) => notify({ tone: "danger", title: "Couldn’t change that", body: errorShape(caught).message }))
                    .finally(() => setSaving(null));
                }}
                label="Put changes live every time I publish"
                description="Off: published versions wait until you choose Put live."
              />
              <Button variant="quiet" size="sm" onClick={() => useDeployUi.getState().openSetup()}>
                Change host or project…
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Version history: beside the newest version. */
export function PutLiveButton() {
  const { siteId = "" } = useParams();
  const status = useDeployStatus(siteId);
  const may = useMay();
  const data = status.data;
  if (!data) return null;
  if (!data.config) {
    if (!may("PUT /api/sites/:siteId/deploy")) return null;
    return (
      <Button size="sm" variant="quiet" icon="globe" onClick={() => useDeployUi.getState().openSetup()}>
        Put this site online
      </Button>
    );
  }
  if (status.job?.state === "running") return <Badge tone="info">Putting it live…</Badge>;
  if (data.production && data.behind === 0) return <Badge tone="success">Live</Badge>;
  if (!may("POST /api/sites/:siteId/deploy")) return null;
  return (
    <Button size="sm" variant="secondary" icon="globe" onClick={() => void putLive(siteId)}>
      Put live
    </Button>
  );
}

/** The Publish dialog's result: "Published. Putting it live…" with the job's progress, or the offer to. */
export function PublishDeployNote({ siteId }: { siteId: string }) {
  const status = useDeployStatus(siteId);
  const latest = useLatestDeployJob(siteId);
  const since = useRef(Date.now());
  // The auto-deploy starts while the publish request is still answering, so it may predate this note by a few seconds.
  const job = latest && (latest.startedAt >= since.current || (latest.label === AUTO_LABEL && latest.startedAt >= since.current - 30_000)) ? latest : null;
  const config = status.data?.config;
  const [starting, setStarting] = useState(false);
  const may = useMay();

  if (!status.data) return null;
  if (!config) {
    if (!may("PUT /api/sites/:siteId/deploy")) return null;
    return (
      <p className="deploy-note">
        <span>Want it at a real address?</span>
        <button type="button" className="app-link-button" onClick={() => useDeployUi.getState().openSetup()}>
          Put this site online
        </button>
      </p>
    );
  }
  if (job?.state === "running") {
    return (
      <div className="deploy-note deploy-note--stack" aria-live="polite">
        <p className="deploy-note__title">Putting it live…</p>
        <DeployProgress job={job} intent="production" />
      </div>
    );
  }
  if (job?.state === "done" && job.url) {
    return (
      <p className="deploy-note" role="status">
        <Icon name="check" />
        <span>
          Live at{" "}
          <a className="g-link" href={job.url} target="_blank" rel="noopener noreferrer">
            {hostOf(job.url)}
          </a>
          .
        </span>
      </p>
    );
  }
  if (job?.state === "error") {
    return (
      <p className="deploy-note deploy-note--danger" role="alert">
        <span>Published, but not live yet: {job.detail}</span>
      </p>
    );
  }
  if (config.autoDeploy) return null;
  return (
    <p className="deploy-note">
      <span>Published here. The live site changes when you put it live.</span>
      <button
        type="button"
        className="app-link-button"
        disabled={starting}
        onClick={() => {
          setStarting(true);
          since.current = Date.now() - 1000;
          void putLive(siteId).finally(() => setStarting(false));
        }}
      >
        {starting ? "Starting…" : "Put live"}
      </button>
    </p>
  );
}

function DeploymentRow({ item, versions }: { item: Deployment; versions: Map<string, string> }) {
  const version = item.commit ? versions.get(item.commit) : undefined;
  return (
    <li className="deploy-row">
      <Badge tone={item.kind === "production" ? "success" : "info"} mark={null}>
        {item.kind === "production" ? "Live" : "Preview"}
      </Badge>
      <div className="deploy-row__main">
        <a className="deploy-row__address" href={item.url} target="_blank" rel="noopener noreferrer">
          {hostOf(item.url)}
        </a>
        <p className="deploy-row__meta">
          {item.label ?? (item.kind === "production" ? (version ? `“${version}”` : "A published version") : "Unpublished changes")}
          <span aria-hidden="true"> · </span>
          <time dateTime={item.createdAt} title={absoluteTime(item.createdAt)}>
            {relativeTime(item.createdAt)}
          </time>
          {item.who ? ` · ${item.who}` : ""}
          <span aria-hidden="true"> · </span>
          {count(item.files, "file")}, {bytes(item.bytes)}
        </p>
      </div>
      <div className="deploy-row__actions">
        <a className={buttonClass("quiet", "sm")} href={item.url} target="_blank" rel="noopener noreferrer">
          <Icon name="external" />
          Open
        </a>
        <Button variant="quiet" size="sm" icon="copy" aria-label="Copy the address" onClick={() => copyText(item.url)}>
          Copy
        </Button>
      </div>
    </li>
  );
}

/** /sites/:siteId/online — where the site lives, and every deployment made from here. */
export function OnlineScreen() {
  const { siteId = "" } = useParams();
  useTopBar({ crumbs: [{ label: "Online" }] });
  const mayPublish = useMay()("POST /api/sites/:siteId/publish");
  const list = useQuery(deployKeys.deployments(siteId), () => api("GET /api/sites/:siteId/deployments", { params: { siteId }, query: { limit: 50 } }));
  const history = useQuery(keys.history(siteId, 50), () => api("GET /api/sites/:siteId/history", { params: { siteId }, query: { limit: 50 } }));
  const versions = new Map((history.data?.items ?? []).map((item) => [item.commit, item.message]));
  const items = list.data?.items ?? [];

  return (
    <div className="app-screen">
      <div className="app-screen__inner">
        <PageHeader title="Online" description={mayPublish ? "Where the site lives on the internet. What’s live is what you’ve published; a preview link shows unpublished changes too." : "Where the site lives on the internet. What’s live is what an editor or owner has published."} />
        <h2 className="app-section__title deploy-list__title deploy-list__title--first">The site</h2>
        <OnlineCard siteId={siteId} variant="settings" listLink={false} />
        <EditorOnlineSection siteId={siteId} />
        <h2 className="app-section__title deploy-list__title">Deployments</h2>
        {list.loading ? (
          <Skeleton lines={4} />
        ) : list.status === "error" && !list.data ? (
          <ErrorState compact title="Couldn’t load the deployments" error={list.error} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <div className="app-card">
            <EmptyState compact title="Nothing put online yet." body="Each time the site goes live or a preview link is made, it’s listed here." mark="reg" />
          </div>
        ) : (
          <ul className="app-card deploy-list">
            {items.map((item) => (
              <DeploymentRow key={`${item.kind}-${item.id}`} item={item} versions={versions} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
