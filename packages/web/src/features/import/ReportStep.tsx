/**
 * Step 4 — the report: the next steps as a short checklist first (review in
 * Proof → rebuild page-builder pages → set redirects → put the site online →
 * switch the domain), then what arrived, the pages to rebuild, what needs a
 * look (each item a link to its entry), redirects, SEO, and what stayed
 * behind. Every number is what the run actually did.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import type { ImportReportView } from "@galley/core/types";
import { count } from "@/lib/format";
import { Button, Icon, buttonClass, cx } from "@/ui";
import { WORDPRESS_IMPORT } from "@/features/redirects/words";
import { REBUILD_BY_OTHERS, nextSteps, reportStanding, shortAddress, type NextStep } from "./logic";
import { useMayBuild, useWhoPublishes } from "@/lib/may";

interface ReportStepProps {
  siteId: string;
  report: ImportReportView;
  onAgain: () => void;
  onRebuild: (path: string) => void;
  onRebuildAll: () => void;
  rebuilding: string | null;
}

const edit = (siteId: string, path: string) => `/sites/${siteId}/edit?path=${encodeURIComponent(path)}`;

function StepAction({ step, siteId, onRebuildAll, onAgain, first, mayRebuild }: { step: NextStep; siteId: string; onRebuildAll: () => void; onAgain: () => void; first: boolean; mayRebuild: boolean }) {
  switch (step.id) {
    case "again":
    case "resume":
      return (
        <Button size="sm" variant="primary" onClick={onAgain}>
          Start again
        </Button>
      );
    case "proof":
      return (
        <Link className={buttonClass(first ? "primary" : "secondary", "sm")} to={`/sites/${siteId}/proof`}>
          Open Proof
        </Link>
      );
    case "rebuild":
      return mayRebuild ? (
        <Button size="sm" variant="secondary" onClick={onRebuildAll}>
          Rebuild all…
        </Button>
      ) : null;
    case "redirects":
      return (
        <Link className={buttonClass("secondary", "sm")} to={`/sites/${siteId}/redirects?add=${WORDPRESS_IMPORT}`}>
          Review redirects
        </Link>
      );
    case "online":
      return (
        <Link className={buttonClass("secondary", "sm")} to={`/sites/${siteId}/online`}>
          Put it online
        </Link>
      );
    default:
      return null;
  }
}

export function ReportStep({ siteId, report, onAgain, onRebuild, onRebuildAll, rebuilding }: ReportStepProps) {
  const [allRedirects, setAllRedirects] = useState(false);
  const publishes = useWhoPublishes();
  // Rebuilding a page runs the assistant in build mode.
  const mayRebuild = useMayBuild();
  // Only what actually arrived: a zero isn't news.
  const arrived = [
    ...(report.arrived.posts ? [{ value: report.arrived.posts, label: report.arrived.posts === 1 ? "post" : "posts" }] : []),
    ...(report.arrived.pages ? [{ value: report.arrived.pages, label: report.arrived.pages === 1 ? "page" : "pages" }] : []),
    ...(report.arrived.images ? [{ value: report.arrived.images, label: report.arrived.images === 1 ? "image" : "images" }] : []),
    ...(report.arrived.updated ? [{ value: report.arrived.updated, label: "updated" }] : []),
    ...(report.arrived.unchanged ? [{ value: report.arrived.unchanged, label: "already here" }] : []),
    ...(report.arrived.embeds ? [{ value: report.arrived.embeds, label: report.arrived.embeds === 1 ? "video or embed" : "videos and embeds" }] : []),
  ];
  // A site-wide matter (comments, a shop) has advice but no single entry to point at; it still needs a look.
  const look = report.needsLook.filter((group) => group.items.length || group.advice);
  const redirects = allRedirects ? report.redirects.list : report.redirects.list.slice(0, 4);
  const discarded = reportStanding(report) === "discarded";

  return (
    <div className="imp-report">
      <ol className="imp-next" aria-label="What to do next">
        {nextSteps(report, publishes, mayRebuild).map((step, index) => (
          <li key={step.id} className="imp-next__item">
            <span className="imp-next__number" aria-hidden="true">
              {index + 1}
            </span>
            <div className="imp-next__text">
              <p className="imp-next__title">{step.title}</p>
              <p className="imp-next__body">{step.body}</p>
            </div>
            <StepAction step={step} siteId={siteId} onRebuildAll={onRebuildAll} onAgain={onAgain} first={index === 0} mayRebuild={mayRebuild} />
          </li>
        ))}
      </ol>

      {/* Once all of it was discarded, the entries these sections link to are gone: only the way to start again is left. */}
      {discarded ? null : (
        <>
      {arrived.length ? (
      <section className="imp-block" aria-labelledby="imp-arrived">
        <h2 className="imp-block__title" id="imp-arrived">
          What arrived
        </h2>
        <ul className="imp-tally imp-tally--report">
          {arrived.map((item) => (
            <li key={item.label} className="imp-tally__item">
              <span className="imp-tally__value">{item.value.toLocaleString()}</span>
              <span className="imp-tally__label">{item.label}</span>
            </li>
          ))}
        </ul>
      </section>
      ) : null}

      {report.rebuilds.length ? (
        <section className="imp-block" aria-labelledby="imp-rebuild">
          <div className="imp-block__head">
            <h2 className="imp-block__title" id="imp-rebuild">
              {`Rebuild ${count(report.rebuilds.length, "page")} from this site’s sections`}
            </h2>
            {mayRebuild ? (
              <Button size="sm" variant="quiet" onClick={onRebuildAll}>
                Rebuild all…
              </Button>
            ) : null}
          </div>
          <p className="imp-block__lede">
            They came across as plain text so nothing was lost. The assistant rebuilds one page at a time from the old layout’s outline, using its words exactly; each result waits in Proof beside the original.
            {mayRebuild ? null : ` ${REBUILD_BY_OTHERS}`}
          </p>
          <ul className="imp-rows">
            {report.rebuilds.map((rebuild) => (
              <li key={rebuild.path} className="imp-row">
                <div className="imp-row__text">
                  <Link className="imp-row__title" to={edit(siteId, rebuild.path)}>
                    {rebuild.title}
                  </Link>
                  <span className="imp-row__meta">
                    {`${rebuild.builder} · ${count(rebuild.sections, "section")}, ${rebuild.matched} with a matching section type`}
                    {rebuild.threadId ? " · started" : ""}
                  </span>
                </div>
                {rebuild.originalUrl ? (
                  <a className={buttonClass("quiet", "sm")} href={rebuild.originalUrl} target="_blank" rel="noopener noreferrer">
                    <Icon name="external" />
                    The original
                  </a>
                ) : null}
                {mayRebuild ? (
                  <Button size="sm" variant={rebuild.threadId ? "quiet" : "secondary"} busy={rebuilding === rebuild.path} busyLabel="Opening…" onClick={() => onRebuild(rebuild.path)}>
                    {rebuild.threadId ? "Rebuild again" : "Rebuild this page"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {look.length ? (
        <section className="imp-block" aria-labelledby="imp-look">
          <h2 className="imp-block__title" id="imp-look">
            Needs a look
          </h2>
          <ul className="imp-groups">
            {look.map((group) => (
              <li key={group.id}>
                {group.items.length === 0 ? (
                  <div className="imp-group imp-group--plain">
                    <p className="imp-group__summary">
                      <span className="imp-group__title">{group.title}</span>
                    </p>
                    <p className="imp-group__advice">{group.advice}</p>
                  </div>
                ) : (
                <details className="imp-group">
                  <summary className="imp-group__summary">
                    <span className="imp-group__title">{group.title}</span>
                    <span className="imp-group__count">{group.items.length.toLocaleString()}</span>
                  </summary>
                  {group.advice ? <p className="imp-group__advice">{group.advice}</p> : null}
                  <ul className="imp-group__items">
                    {group.items.slice(0, 60).map((item, index) => (
                      <li key={`${item.title}-${index}`}>
                        {item.path ? <Link to={edit(siteId, item.path)}>{item.title}</Link> : <span>{item.title}</span>}
                        {item.note !== group.title && item.note !== item.title && !/credited to the person chosen/.test(item.note) ? <span className="imp-group__note">{item.note}</span> : null}
                      </li>
                    ))}
                    {group.items.length > 60 ? <li className="g-hint">{`and ${group.items.length - 60} more`}</li> : null}
                  </ul>
                </details>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.redirects.count ? (
        <section className="imp-block" aria-labelledby="imp-redirects">
          <div className="imp-block__head">
            <h2 className="imp-block__title" id="imp-redirects">
              {`${count(report.redirects.count, "old address", "old addresses")} will be redirected`}
            </h2>
            <Link className={buttonClass("secondary", "sm")} to={`/sites/${siteId}/redirects?add=${WORDPRESS_IMPORT}`}>
              Review them
            </Link>
          </div>
          <p className="imp-block__lede">Old links and search results keep working. The list is ready on the Redirects screen, under “The WordPress import’s redirects”; nothing takes effect until you add it there and publish.</p>
          <ul className="imp-redirects">
            {redirects.map((redirect) => (
              <li key={redirect.from} className="imp-redirect">
                <span className="g-mono imp-redirect__from">{redirect.from}</span>
                <Icon name="chevron-right" />
                <span className="g-mono imp-redirect__to">{redirect.to}</span>
              </li>
            ))}
          </ul>
          {report.redirects.list.length > 4 ? (
            <button type="button" className="g-link imp-more" onClick={() => setAllRedirects((open) => !open)}>
              {allRedirects ? "Show fewer" : `Show all ${report.redirects.list.length.toLocaleString()}`}
            </button>
          ) : null}
        </section>
      ) : null}

      {report.seo.descriptions + report.seo.titlesKept + report.seo.titlesNotKept + report.seo.descriptionsWritten + report.seo.canonicals > 0 ? (
      <section className="imp-block" aria-labelledby="imp-seo">
        <h2 className="imp-block__title" id="imp-seo">
          SEO carried over
        </h2>
        <ul className="imp-ticks">
          {report.seo.descriptions ? <li>{`${count(report.seo.descriptions, "search description")} from the SEO plugin.`}</li> : null}
          {report.seo.titlesKept ? <li>{`${count(report.seo.titlesKept, "SEO title")} kept.`}</li> : null}
          {report.seo.titlesNotKept ? <li>{`${count(report.seo.titlesNotKept, "SEO title")} differed from the page title; this site has no field for them, so the page title is used.`}</li> : null}
          {report.seo.descriptionsWritten ? <li className="imp-ticks__look">{`${count(report.seo.descriptionsWritten, "description")} written from opening paragraphs — worth a read, search engines show them.`}</li> : null}
          {report.seo.canonicals ? <li>{`${count(report.seo.canonicals, "canonical address", "canonical addresses")} kept.`}</li> : null}
        </ul>
      </section>
      ) : null}

      {report.notImported.length || report.leftBehind.length ? (
        <section className="imp-block" aria-labelledby="imp-not">
          <h2 className="imp-block__title" id="imp-not">
            Didn’t come across
          </h2>
          {report.notImported.length ? (
            <ul className="imp-reasons">
              {report.notImported.map((item, index) => (
                <li key={`${item.title}-${index}`}>
                  <strong>{item.path ? <Link to={edit(siteId, item.path)}>{item.title}</Link> : item.title}</strong> — {item.note}
                </li>
              ))}
            </ul>
          ) : null}
          <details className="app-details">
            <summary>Left behind on purpose</summary>
            <dl className="imp-pairs imp-pairs--wide">
              {report.leftBehind.map((entry) => (
                <div key={entry.what} className="imp-pairs__row">
                  <dt>{entry.what}</dt>
                  <dd>{entry.why}</dd>
                </div>
              ))}
            </dl>
          </details>
        </section>
      ) : null}

        </>
      )}

      <p className={cx("imp-report__source")}>{`From ${report.source.kind === "file" ? "an export of " : ""}${shortAddress(report.source.siteUrl)}`}</p>
    </div>
  );
}
