import { Link } from "react-router-dom";
import type { Finding } from "@galley/core/seo/types";
import { Badge, Button, buttonClass, Icon } from "@/ui";
import { editorLink, kindLabel, pageName, SEVERITY, WRITE_LABEL } from "./logic";
import { ResultPreview } from "./ResultPreview";

export interface FindingRowProps {
  finding: Finding;
  siteId: string;
  /** The assistant has a key, so "Write it for me" can run. */
  connected: boolean;
  fixing: boolean;
  onFix: (finding: Finding) => void;
  onWrite: (finding: Finding) => void;
  /** Leave out the page name (the editor panel is already on the page). */
  onPage?: boolean;
  /** The site's address, for title and description previews. */
  address?: string;
  description?: string;
}

const TITLE_CODES = new Set(["title-long", "title-brand-repeated", "title-short", "title-duplicate"]);

function Evidence({ finding, address, description }: { finding: Finding; address?: string; description?: string }) {
  const { evidence } = finding;
  const measure = evidence.measure;

  return (
    <div className="seo-evidence">
      {TITLE_CODES.has(finding.code) && evidence.value && address ? (
        <ResultPreview compact title={evidence.value} address={address} {...(description !== undefined ? { description } : {})} />
      ) : evidence.value ? (
        <p className="seo-evidence__value">
          <span className="seo-evidence__label">Found</span> <q className="g-mono">{evidence.value}</q>
        </p>
      ) : null}
      {evidence.values?.length ? (
        <ul className="seo-evidence__values" aria-label="Found">
          {evidence.values.map((value) => (
            <li key={value} className="g-mono">
              {value}
            </li>
          ))}
        </ul>
      ) : null}
      {measure ? (
        <p className="seo-evidence__measure">
          <span className="seo-evidence__label">{measure.label}</span> {measure.value.toLocaleString()} {measure.unit === "pixels wide" ? "pixels wide" : measure.unit}, flagged past {measure.limit.toLocaleString()}. <span className="seo-evidence__reasoning">{measure.reasoning}</span>
        </p>
      ) : null}
      {/* "Would likely show as …" repeats the preview above it. */}
      {evidence.note && !(finding.code === "title-long" && address) ? <p className="seo-evidence__note">{evidence.note}</p> : null}
      {evidence.pages?.length ? (
        <p className="seo-evidence__pages">
          <span className="seo-evidence__label">{finding.code.endsWith("duplicate") ? "Same as" : "Pages"}</span>{" "}
          {evidence.pages.map((page, index) => (
            <span key={`${page.path ?? page.url}-${index}`}>
              {index > 0 ? ", " : ""}
              {page.title ?? page.url ?? page.path}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/** One finding: what, where, why it matters and how sure that is, the evidence, and what can be done. */
export function FindingRow({ finding, siteId, connected, fixing, onFix, onWrite, onPage, address, description }: FindingRowProps) {
  const severity = SEVERITY[finding.severity];
  const page = onPage ? null : pageName(finding);

  return (
    <li className="seo-finding" data-severity={finding.severity}>
      <div className="seo-finding__head">
        <Badge tone={severity.tone}>{severity.label}</Badge>
        <span className="seo-finding__title">{finding.title}</span>
        {page ? <span className="seo-finding__page">{page}</span> : null}
      </div>
      <p className="seo-finding__why">
        {finding.why}{" "}
        <span className="seo-finding__kind" data-kind={finding.kind}>
          {finding.source ? (
            <a href={finding.source.url} target="_blank" rel="noreferrer" className="g-link">
              {kindLabel(finding)}
              <Icon name="external" size={12} />
            </a>
          ) : (
            kindLabel(finding)
          )}
        </span>
      </p>
      <Evidence finding={finding} {...(address ? { address } : {})} {...(description !== undefined ? { description } : {})} />
      {finding.fix || finding.write || finding.path ? (
        <div className="seo-finding__actions">
          {finding.fix ? (
            <Button size="sm" variant="secondary" icon="check" busy={fixing} busyLabel="Fixing…" onClick={() => onFix(finding)} title={finding.fix.edits.map((edit) => edit.summary).join("\n")}>
              {finding.fix.label}
            </Button>
          ) : null}
          {finding.write && finding.path ? (
            <Button size="sm" variant="secondary" icon="chat" disabled={!connected} title={connected ? undefined : "Connect the assistant in App settings first."} onClick={() => onWrite(finding)}>
              {WRITE_LABEL[finding.write].one}
            </Button>
          ) : null}
          {finding.path && !onPage ? (
            <Link className={buttonClass("quiet", "sm")} to={editorLink(siteId, finding.path)}>
              Open the page
            </Link>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
