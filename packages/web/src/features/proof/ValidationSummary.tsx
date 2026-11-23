import { Link } from "react-router-dom";
import type { ChangeSet, ValidationIssue } from "@galley/core/types";
import { api } from "@/lib/api";
import { count, friendlyLabel } from "@/lib/format";
import { useQuery } from "@/lib/query";
import { ProofMark } from "@/ui";
import { changesSignature, usePublishCheck } from "./publishCheck";

function issueKey(issue: ValidationIssue, index: number): string {
  return `${issue.path ?? ""}:${issue.code}:${JSON.stringify(issue.field ?? [])}:${index}`;
}

/**
 * Problems the site's own rules find in what's waiting, and what the
 * plugins' publish checks say about it (each under the plugin's name). They
 * don't stop a publish — unless a plugin's check would refuse it, which is
 * said first — and each comes with a way to the page it's on when it has one.
 */
export function ValidationSummary({ siteId, changes, titles }: { siteId: string; changes: ChangeSet; titles: Map<string, string> }) {
  const signature = changesSignature(changes.files);
  const issues = useQuery(["site", siteId, "validate", signature], () => api("POST /api/sites/:siteId/validate", { params: { siteId }, body: {} }), {
    enabled: changes.files.length > 0,
  });
  const check = usePublishCheck(siteId, changes.files);
  const list = issues.data?.issues ?? [];
  const pluginNotes = [...(check.refusal ? [{ ...check.refusal, stops: true }] : []), ...check.warnings.map((warning) => ({ ...warning, stops: false }))];
  if (list.length === 0 && pluginNotes.length === 0) return null;
  const errors = list.filter((issue) => issue.severity === "error").length + (check.refusal ? 1 : 0);
  const warnings = list.length + pluginNotes.length - errors;
  const heading = [errors ? count(errors, "problem") : null, warnings ? count(warnings, "thing to check", "things to check") : null].filter(Boolean).join(" and ");
  const shown = Math.max(0, 6 - pluginNotes.length);

  return (
    <section className={errors ? "proof-issues proof-issues--error" : "proof-issues"} aria-labelledby="proof-issues-title">
      <ProofMark kind="bang" className="proof-issues__mark" />
      <div className="proof-issues__body">
        <h2 id="proof-issues-title" className="proof-issues__title">
          {heading}
        </h2>
        <p className="proof-issues__lede">{check.refusal ? `${check.refusal.plugin} will stop this publish until it’s fixed.` : "You can still publish. These are worth a look first."}</p>
        <ul className="proof-issues__list">
          {pluginNotes.map((note, index) => (
            <li key={`plugin:${note.plugin}:${index}`}>
              <strong className="proof-issues__plugin">{note.plugin}</strong>
              {note.stops ? " stops this publish — " : " — "}
              {note.message}
            </li>
          ))}
          {list.slice(0, shown).map((issue, index) => (
            <li key={issueKey(issue, index)}>
              {issue.path ? (
                <Link className="g-link" to={`/sites/${siteId}/edit?path=${encodeURIComponent(issue.path)}`}>
                  {titles.get(issue.path) ?? friendlyLabel(issue.path)}
                </Link>
              ) : null}
              {issue.path ? " — " : null}
              {issue.message}
            </li>
          ))}
        </ul>
        {list.length > shown ? <p className="g-hint">{`And ${list.length - shown} more.`}</p> : null}
      </div>
    </section>
  );
}
