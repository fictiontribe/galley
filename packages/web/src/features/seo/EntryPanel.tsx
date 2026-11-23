import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { FieldPath } from "@galley/core/types";
import type { Finding, WriteKind } from "@galley/core/seo/types";
import "./seo.css";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { useSite } from "@/lib/stores/site";
import { useForm, useFormState, useFormValue } from "@/features/content/form/context";
import { Badge, Field, Icon, Input, Skeleton, Textarea } from "@/ui";
import { BatchDialog } from "./BatchDialog";
import { FindingRow } from "./FindingRow";
import { SEVERITY } from "./logic";
import { ResultPreview } from "./ResultPreview";
import { useFixes, visibilityKeys } from "./useVisibility";

const OPEN_KEY = "galley.seo-panel-open";

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** A field of the entry as plain text, edited through the form's normal saving. */
function useTextField(path: FieldPath | undefined) {
  const { store } = useForm();
  const value = useFormValue(path ?? ["\u0000none"]);

  return {
    value: typeof value === "string" ? value : "",
    set: (next: string) => path && store.actions.edit(path, next, { required: false }),
    commit: () => path && store.actions.commit(path),
  };
}

/**
 * The editor's compact Search & AI panel: how this page would likely show in
 * search results (editable in place, saved like any field), and this page's
 * findings with their fixes. No scores, no keyword meters.
 */
export function EntryPanel() {
  const { siteId, entryPath } = useForm();
  const hash = useFormState((state) => state.hash);
  const [open, setOpen] = useState(readOpen);
  const [batch, setBatch] = useState<WriteKind | null>(null);
  const production = useSite((s) => s.detail?.model.urls.production);
  const connected = useQuery(["settings"], () => api("GET /api/settings")).data?.secrets.some((secret) => secret.name === "anthropic" && secret.configured) ?? false;
  const audit = useQuery(visibilityKeys.entry(siteId, entryPath), () => api("GET /api/sites/:siteId/visibility/entry", { params: { siteId }, query: { path: entryPath } }), { enabled: open });
  const { fix, busy } = useFixes(siteId, audit.refetch);
  const preview = audit.data?.preview;
  const title = useTextField(preview?.titleField);
  const description = useTextField(preview?.descriptionField);

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
      // Private mode: the panel just doesn't remember.
    }
  }, [open]);
  // Saved edits change the file: check this page again once they land.
  useEffect(() => {
    if (open && audit.data) void audit.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the stored file changes
  }, [hash]);

  const counts = audit.data?.counts;
  const total = counts ? counts.must + counts.should + counts.idea : 0;
  // The site may wrap the title ("{title} · Site"): show the typed title inside the same wrapper.
  const storedTitle = audit.data && preview?.titleFrom === "rendered" ? audit.data.title : null;
  const shownTitle = preview ? (storedTitle && preview.title.includes(storedTitle) ? preview.title.replace(storedTitle, title.value) : preview.titleField ? title.value : preview.title) : "";
  const shownDescription = preview?.descriptionField ? description.value || (preview.descriptionFrom === "rendered" ? preview.description : "") : (preview?.description ?? "");
  const address = preview?.address.replace(/^your-site/, (() => {
    try {
      return production ? new URL(production).host.replace(/^www\./, "") : "your-site";
    } catch {
      return "your-site";
    }
  })());

  return (
    <section className="app-card seo-entry" aria-labelledby="seo-entry-title">
      <h3 className="seo-entry__heading">
        <button type="button" className="seo-entry__toggle" aria-expanded={open} onClick={() => setOpen(!open)} id="seo-entry-title">
          <Icon name={open ? "chevron-down" : "chevron-right"} />
          <span className="seo-entry__label">Search &amp; AI</span>
          {counts && total ? (
            <span className="seo-entry__counts">
              {(["must", "should", "idea"] as const)
                .filter((severity) => counts[severity])
                .map((severity) => (
                  <Badge key={severity} tone={SEVERITY[severity].tone}>
                    {counts[severity]}
                    <span className="g-sr"> {SEVERITY[severity].label.toLowerCase()}</span>
                  </Badge>
                ))}
            </span>
          ) : counts ? (
            <Badge tone="success">In good shape</Badge>
          ) : null}
        </button>
      </h3>
      {open ? (
        <div className="seo-entry__body">
          {audit.loading ? (
            <Skeleton lines={4} />
          ) : !audit.data ? (
            <p className="g-error-text">Couldn’t check this page. {audit.error instanceof Error ? audit.error.message : ""}</p>
          ) : (
            <>
              <ResultPreview compact title={shownTitle} address={address ?? ""} description={shownDescription} note={preview?.titleFrom === "rendered" ? "Title and description as the page sends them." : "From the content; the site may add its name to the title."} />
              {preview?.titleField ? (
                <Field label="Title" hint={`${preview.titleWidth > preview.titleLimit ? "Likely cut short in results. " : ""}Shown in search results and browser tabs.`}>
                  <Input size="sm" value={title.value} onChange={(event) => title.set(event.target.value)} onBlur={title.commit} />
                </Field>
              ) : null}
              {preview?.descriptionField ? (
                <Field label="Description shown in results" hint="One or two plain sentences about this page.">
                  <Textarea value={description.value} maxRows={4} onChange={(event) => description.set(event.target.value)} onBlur={description.commit} />
                </Field>
              ) : null}
              {audit.data.findings.length ? (
                <ul className="seo-findings seo-findings--compact">
                  {audit.data.findings.map((finding: Finding) => (
                    <FindingRow key={finding.id} finding={finding} siteId={siteId} connected={connected} fixing={busy.has(finding.id)} onFix={(item) => void fix([item])} onWrite={(item) => setBatch(item.write ?? null)} onPage />
                  ))}
                </ul>
              ) : (
                <p className="seo-entry__clean">Nothing to fix on this page.</p>
              )}
              <p className="seo-entry__foot">
                {audit.data.rendering.source === "none" ? "Checked from the content; start the preview to check the page as sent. " : ""}
                <Link className="g-link" to={`/sites/${encodeURIComponent(siteId)}/visibility`}>
                  The whole site
                </Link>
              </p>
            </>
          )}
        </div>
      ) : null}
      <BatchDialog siteId={siteId} open={batch !== null} kind={batch} paths={[entryPath]} onClose={() => setBatch(null)} onFinished={() => void audit.refetch()} />
    </section>
  );
}
