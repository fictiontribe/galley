/**
 * Health: redirects whose new address has gone (a page was deleted or
 * renamed since), and old addresses the site's own pages still link to —
 * better fixed at the link than sent through a redirect every time.
 */
import { Link } from "react-router-dom";
import type { RedirectHealth, RedirectsOverview } from "@galley/core/redirects-info";
import { Button, ProofMark, Skeleton } from "@/ui";
import { saveList, useRedirectHealth } from "./data";
import { useNameOf } from "@/lib/names";

export function HealthCard({ siteId, overview }: { siteId: string; overview: RedirectsOverview }) {
  const health = useRedirectHealth(siteId, overview.redirects.length > 0);
  const data: RedirectHealth | undefined = health.data;
  const name = useNameOf();

  if (overview.redirects.length === 0) return null;
  const fix = (index: number, to: string) => {
    const next = overview.redirects.map((redirect, at) => (at === index ? { ...redirect, to } : redirect));

    void saveList(siteId, overview, next, { undo: { label: "Pointed at the page", previous: overview.redirects } });
  };

  return (
    <section className="app-card app-card--pad redir-panel" aria-labelledby="redir-health-title" aria-busy={health.loading}>
      <h2 id="redir-health-title" className="redir-panel__title">
        Health
      </h2>
      {health.loading || !data ? (
        <Skeleton lines={2} />
      ) : data.brokenTargets.length === 0 && data.linkedOldAddresses.length === 0 ? (
        <p className="redir-health__ok">
          <ProofMark kind="reg" /> Every new address leads somewhere, and no page links to an old one.
        </p>
      ) : (
        <>
          {data.brokenTargets.length ? (
            <div className="redir-health__group">
              <p className="redir-health__title">{`${data.brokenTargets.length.toLocaleString()} ${data.brokenTargets.length === 1 ? "leads" : "lead"} nowhere`}</p>
              <ul>
                {data.brokenTargets.slice(0, 6).map((item) => (
                  <li key={item.from}>
                    <span className="g-mono">{item.from}</span> → <span className="g-mono">{item.to}</span>
                    {item.suggestion ? (
                      <Button size="sm" variant="quiet" onClick={() => fix(item.index, item.suggestion!)}>
                        {`Point at ${item.suggestion}`}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {data.linkedOldAddresses.length ? (
            <div className="redir-health__group">
              <p className="redir-health__title">{`${data.linkedOldAddresses.length.toLocaleString()} old ${data.linkedOldAddresses.length === 1 ? "address is" : "addresses are"} still linked from the site`}</p>
              <p className="g-hint">Change the link to the new address instead, so visitors skip the redirect.</p>
              <ul>
                {data.linkedOldAddresses.slice(0, 6).map((item) => (
                  <li key={item.from}>
                    <span className="g-mono">{item.from}</span>
                    {" on "}
                    {item.pages.slice(0, 3).map((page, index) => (
                      <span key={page.path}>
                        {index ? ", " : ""}
                        <Link to={`/sites/${siteId}/edit?path=${encodeURIComponent(page.path)}`}>{name(page)}</Link>
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
