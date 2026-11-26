import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ListRowAdditions } from "@/additions/places";
import { useTopBar } from "@/app/chrome";
import { FileChangeRow } from "@/components/FileChangeRow";
import { pendingSummary } from "@/features/proof/changes";
import { PreviewActions, PreviewBadge } from "@/components/PreviewControls";
import { api } from "@/lib/api";
import { collectionIcon, visibleCollections } from "@/lib/collections";
import { collectionNouns, count, relativeTime } from "@/lib/format";
import { useQuery } from "@/lib/query";
import { useChanges } from "@/lib/stores/changes";
import { usePreviewStatus } from "@/lib/stores/preview";
import { useSite } from "@/lib/stores/site";
import { keys } from "@/lib/sync";
import { Badge, Button, EmptyState, ErrorState, Icon, Kbd, ProofMark, Skeleton, buttonClass } from "@/ui";
import { OnlineCard } from "@/features/deploy/Online";
import { PreviewTabLink, siteHomePreviewTarget } from "@/features/hosting/previewLinks";
import { useMeta } from "@/lib/stores/meta";
import { usePlaceWords } from "@/lib/where";
import { useWhoPublishes } from "@/lib/may";

function AskBox({ siteId }: { siteId: string }) {
  const navigate = useNavigate();
  const publishes = useWhoPublishes();
  const [text, setText] = useState("");
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const request = text.trim();
    navigate(`/sites/${siteId}/edit${request ? `?ask=${encodeURIComponent(request)}` : ""}`);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) submit();
  };
  return (
    <form className="app-ask" onSubmit={submit}>
      <label className="app-ask__label" htmlFor="home-ask">
        What would you like to change?
      </label>
      <div className="g-composer">
        <textarea id="home-ask" rows={2} placeholder="Ask for a change… “Add a team member called Sam”, “Shorten the home page heading”" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown} />
        <button className="g-btn g-btn--primary g-btn--icon g-btn--sm" type="submit" aria-label="Ask the assistant">
          <span className="g-mark g-mark--send" aria-hidden="true" />
        </button>
        <div className="g-composer__foot">
          <Kbd keys={["enter"]} /> opens the editor with your request · nothing changes until {publishes}
        </div>
      </div>
    </form>
  );
}

function Section({ title, action, children, id }: { title: string; action?: ReactNode; children: ReactNode; id: string }) {
  return (
    <section className="app-section" aria-labelledby={id}>
      <div className="app-section__head">
        <h2 className="app-section__title" id={id}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function PendingSection({ siteId }: { siteId: string }) {
  const { changes, status, error, refresh } = useChanges();
  const navigate = useNavigate();
  const publishes = useWhoPublishes();
  const files = changes?.files ?? [];
  return (
    <Section
      id="home-pending"
      title="Waiting to publish"
      action={
        files.length > 0 ? (
          <Button size="sm" variant="secondary" icon="proof" onClick={() => navigate(`/sites/${siteId}/proof`)}>
            Review changes
          </Button>
        ) : null
      }
    >
      {status === "error" && !changes ? (
        <ErrorState compact title="Couldn’t check for changes" error={error} onRetry={() => void refresh()} />
      ) : !changes ? (
        <div className="app-card" aria-busy="true">
          {[0, 1].map((index) => (
            <div key={index} className="g-file" aria-hidden="true">
              <Skeleton width={54} height={20} pill />
              <Skeleton width={180} height={12} />
              <Skeleton width={40} height={12} />
              <span />
            </div>
          ))}
        </div>
      ) : files.length === 0 ? (
        <div className="app-card app-card--quiet">
          <EmptyState compact mark="reg" title="Nothing to publish." body={`Everything here already matches the live site. Changes you make wait here until ${publishes}.`} />
        </div>
      ) : (
        <>
          <p className="app-section__lede">
            {count(files.length, "page or image", "pages and images")} changed since the last publish
            {pendingSummary(files) ? ` — ${pendingSummary(files)}` : ""}.
          </p>
          <div className="app-card" role="list">
            {files.slice(0, 5).map((file) => (
              <FileChangeRow
                key={file.path}
                change={file}
                actions={
                  <>
                    <ListRowAdditions siteId={siteId} path={file.path} />
                    {file.kind === "content" && file.status !== "deleted" ? (
                      <Link className={buttonClass("quiet", "sm")} to={`/sites/${siteId}/edit?path=${encodeURIComponent(file.path)}`}>
                        Open
                      </Link>
                    ) : null}
                  </>
                }
              />
            ))}
          </div>
          {files.length > 5 ? (
            <Link className="g-link app-section__more" to={`/sites/${siteId}/proof`}>
              And {count(files.length - 5, "more change")} in Proof
            </Link>
          ) : null}
        </>
      )}
    </Section>
  );
}

function HistorySection({ siteId }: { siteId: string }) {
  const history = useQuery(keys.history(siteId, 4), () => api("GET /api/sites/:siteId/history", { params: { siteId }, query: { limit: 4 } }));
  const items = history.data?.items ?? [];
  return (
    <Section
      id="home-history"
      title="Recently published"
      action={
        <Link className={buttonClass("quiet", "sm")} to={`/sites/${siteId}/history`}>
          Version history
        </Link>
      }
    >
      {history.loading ? (
        <ul className="app-timeline" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <li key={index} className="app-timeline__item">
              <Skeleton width={220 - index * 30} height={14} />
              <Skeleton width={120} height={11} />
            </li>
          ))}
        </ul>
      ) : history.status === "error" && !history.data ? (
        <ErrorState compact title="Couldn’t load recent versions" error={history.error} onRetry={() => void history.refetch()} />
      ) : items.length === 0 ? (
        <p className="g-hint">Nothing published yet. Each publish appears here.</p>
      ) : (
        <ul className="app-timeline">
          {items.map((item) => (
            <li key={item.commit} className="app-timeline__item">
              <span className="app-timeline__message">{item.message}</span>
              <span className="app-timeline__meta">
                {item.author} · {relativeTime(item.date)}
                {item.viaGalley ? <span className="g-sr"> · published from this app</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function PreviewSection({ siteId }: { siteId: string }) {
  const status = usePreviewStatus(siteId);
  // On a hosted install the preview opens through its entry (features/hosting/previewLinks.tsx).
  const meta = useMeta((s) => s.meta);
  return (
    <Section id="home-preview" title="Preview" action={<PreviewBadge siteId={siteId} />}>
      <div className="app-card app-card--pad app-preview-card">
        <p className="app-preview-card__text">
          {status?.state === "ready"
            ? "Your site is running with your changes, so the editor can show every page as visitors will see it."
            : status?.state === "error"
              ? (status.detail ?? "The preview stopped. The site’s own build reported a problem.")
              : status?.state === "starting" || status?.state === "installing"
                ? (status.detail ?? "Starting the site’s own dev server…")
                : "The preview runs your site with your changes. It starts when you open the editor, or now."}
        </p>
        {status?.baselineSource ? (
          <p className="g-hint">
            Compared against the {status.baselineSource === "staging" ? "staging site" : "live site"}.
          </p>
        ) : null}
        <div className="app-preview-card__actions">
          <PreviewActions siteId={siteId} />
          {status?.state === "ready" && status.url ? (
            <PreviewTabLink siteId={siteId} target={siteHomePreviewTarget(meta, status.url)} className={buttonClass("quiet", "sm")}>
              <Icon name="external" />
              Open in a new tab
            </PreviewTabLink>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

/** /sites/:siteId — what was found, what's pending, what was published, the preview, and a place to ask. */
export function SiteHomeScreen() {
  const { siteId = "" } = useParams();
  const detail = useSite((s) => s.detail);
  const where = usePlaceWords();
  useTopBar({ crumbs: [{ label: detail?.name ?? "Site" }, { label: "Site home" }] });

  if (!detail) {
    return (
      <div className="app-screen" aria-busy="true">
        <div className="app-screen__inner">
          <Skeleton width={90} height={12} />
          <Skeleton width={260} height={30} style={{ marginBlock: "var(--space-3) var(--space-8)" }} />
          <Skeleton height={96} />
        </div>
      </div>
    );
  }

  const { model } = detail;
  const collections = visibleCollections(model);
  const framework = model.framework.version ? `${model.framework.name} ${model.framework.version}` : model.framework.name;
  const pages = collections.filter((c) => c.kind === "entries").reduce((sum, c) => sum + c.count, 0);

  return (
    <div className="app-screen">
      <div className="app-screen__inner app-home">
        <header className="app-home__head">
          <h1 className="app-home__title">{detail.name}</h1>
          <p className="app-home__lede">
            {/^[aeiou]/i.test(framework) ? "An" : "A"} {framework} site: {count(collections.length, "collection")} and {count(pages, "page")} ready to edit.
            {detail.git.hasRemote ? null : ` Its versions are kept ${where.recorded} only — not backed up or shared anywhere yet.`}
          </p>
        </header>

        <AskBox siteId={siteId} />

        <div className="app-home__grid">
          <div className="app-home__main">
            <PendingSection siteId={siteId} />
            <Section id="home-found" title="What’s on this site">
              <ul className="app-collections">
                {collections.map((collection) => (
                  <li key={collection.id}>
                    <Link className="app-collection-row" to={`/sites/${siteId}/c/${encodeURIComponent(collection.id)}`}>
                      <Icon name={collectionIcon(collection)} />
                      <span className="app-collection-row__label">{collection.label}</span>
                      <span className="app-collection-row__path g-mono">{collection.path}</span>
                      <span className="app-collection-row__count">
                        {collection.kind === "entries" ? count(collection.count, collection.singular, collectionNouns(collection).many) : <Badge mark={null}>Settings file</Badge>}
                      </span>
                      <Icon name="chevron-right" className="app-collection-row__go" />
                    </Link>
                  </li>
                ))}
              </ul>
              {model.notes.length > 0 ? (
                <details className="app-details app-notes">
                  <summary>How this site was read</summary>
                  <ul>
                    {model.notes.map((note) => (
                      <li key={note} className="g-margin-note">
                        <ProofMark kind="stet" />
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </Section>
          </div>
          <div className="app-home__side">
            <Section id="home-online" title="Online">
              <OnlineCard siteId={siteId} />
            </Section>
            <Section id="home-import" title="Moving from WordPress?">
              <div className="app-card app-card--pad app-preview-card">
                <p className="app-preview-card__text">Bring its posts, pages, images and SEO details here, as changes you check before anything goes live.</p>
                <div className="app-preview-card__actions">
                  <Link className={buttonClass("secondary", "sm")} to={`/sites/${siteId}/import`}>
                    Bring your WordPress site
                  </Link>
                </div>
              </div>
            </Section>
            <PreviewSection siteId={siteId} />
            <HistorySection siteId={siteId} />
          </div>
        </div>
      </div>
    </div>
  );
}
