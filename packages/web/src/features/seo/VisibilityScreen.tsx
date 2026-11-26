import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { GROUP_LABELS, GROUP_ORDER } from "@galley/core/seo/catalog";
import type { CrawlerReport, Finding, FindingGroup, SiteAudit, WriteKind } from "@galley/core/seo/types";
import "./seo.css";
import { useTopBar } from "@/app/chrome";
import { setQueryData } from "@/lib/query";
import { usePreview, usePreviewStatus } from "@/lib/stores/preview";
import { useSite } from "@/lib/stores/site";
import { useQuery } from "@/lib/query";
import { api } from "@/lib/api";
import { useManagedAi } from "@/lib/credits";
import { Badge, Button, EmptyState, ErrorState, Icon, PageHeader, Skeleton } from "@/ui";
import { AgentPanel, CrawlerPanel } from "./AiPanel";
import { BatchDialog } from "./BatchDialog";
import { FindingRow } from "./FindingRow";
import { batchesFor, count, sampleWords, SEVERITY, WRITE_LABEL } from "./logic";
import { useFixes, useSiteAudit, visibilityKeys } from "./useVisibility";
import { isVisibilitySettings } from "@/features/forms/logic/locate";

/**
 * The settings behind this screen live in one data file of the site kit. It
 * is kept out of the content list (this screen is the way in), so developers
 * who want the file itself get one quiet link to it here.
 */
function SettingsFileLink({ siteId }: { siteId: string }) {
  const file = useSite((s) => s.detail?.model.collections.find(isVisibilitySettings));
  if (!file) return null;
  return (
    <p className="g-hint seo-settings-file">
      <Link className="g-link" to={`/sites/${siteId}/edit?path=${encodeURIComponent(file.path)}`}>
        Edit the settings file
      </Link>{" "}
      <span className="g-mono">{file.path}</span>
    </p>
  );
}

const GROUP_BLURB: Record<FindingGroup, string> = {
  titles: "The title and description people see in search results and AI answers.",
  content: "Headings, length and the words on each page.",
  images: "Alt text, file sizes and share pictures.",
  links: "Links that lead nowhere, and pages nothing links to.",
  indexing: "Whether search engines may show each page, and which address they use.",
  structured: "Details search engines read to show richer results.",
  ai: "What AI crawlers may read, and how plainly the site says who it is.",
};

function siteAddress(production: string | undefined): string {
  try {
    return production ? new URL(production).host.replace(/^www\./, "") : "your-site";
  } catch {
    return "your-site";
  }
}

function Tally({ audit }: { audit: SiteAudit }) {
  return (
    <div className="seo-tally" role="group" aria-label="Findings by severity">
      {(["must", "should", "idea"] as const).map((severity) => (
        <div key={severity} className="seo-tally__item" data-severity={severity}>
          <span className="seo-tally__value">{audit.counts[severity]}</span>
          <span className="seo-tally__label">{severity === "idea" ? (audit.counts.idea === 1 ? "Idea" : "Ideas") : SEVERITY[severity].label}</span>
        </div>
      ))}
    </div>
  );
}

interface GroupProps {
  siteId: string;
  group: FindingGroup;
  findings: Finding[];
  open: boolean;
  onToggle: () => void;
  connected: boolean;
  address: string;
  fixing: ReadonlySet<string>;
  onFix: (findings: Finding[]) => void;
  onWrite: (kind: WriteKind, paths?: string[]) => void;
}

function Group({ siteId, group, findings, open, onToggle, connected, address, fixing, onFix, onWrite }: GroupProps) {
  const { managed, manageUrl } = useManagedAi();
  const counts = { must: 0, should: 0, idea: 0 };

  for (const item of findings) counts[item.severity] += 1;
  const { writes, fixes } = batchesFor(findings);
  const id = `seo-group-${group}`;

  return (
    <section className="app-card seo-group" data-open={open || undefined}>
      <h2 className="seo-group__heading">
        <button type="button" className="seo-group__toggle" aria-expanded={open} aria-controls={id} onClick={onToggle} disabled={findings.length === 0}>
          <Icon name={open ? "chevron-down" : "chevron-right"} className="seo-group__chevron" />
          <span className="seo-group__text">
            <span className="seo-group__label">{GROUP_LABELS[group]}</span>
            <span className="seo-group__blurb">{GROUP_BLURB[group]}</span>
          </span>
          <span className="seo-group__counts">
            {findings.length === 0 ? (
              <Badge tone="success">In good shape</Badge>
            ) : (
              (["must", "should", "idea"] as const)
                .filter((severity) => counts[severity] > 0)
                .map((severity) => (
                  <Badge key={severity} tone={SEVERITY[severity].tone}>
                    {counts[severity]} {severity === "idea" ? (counts.idea === 1 ? "idea" : "ideas") : SEVERITY[severity].label.toLowerCase()}
                  </Badge>
                ))
            )}
          </span>
        </button>
      </h2>
      {open && findings.length ? (
        <div id={id} className="seo-group__body">
          {writes.length || fixes.length > 1 ? (
            <div className="seo-group__batch" role="group" aria-label={`Do several at once in ${GROUP_LABELS[group]}`}>
              {fixes.length > 1 ? (
                <Button size="sm" variant="secondary" icon="check" busy={fixes.some((f) => fixing.has(f.id))} busyLabel="Fixing…" onClick={() => onFix(fixes)}>
                  Fix all {fixes.length}
                </Button>
              ) : null}
              {writes.map((write) => (
                <Button
                  key={write.kind}
                  size="sm"
                  variant="secondary"
                  icon="chat"
                  disabled={!connected}
                  title={
                    connected
                      ? `${count(write.count, "request")} to the assistant, one per page`
                      : managed
                        ? "AI is switched off for this site."
                        : "Connect the assistant in App settings first."
                  }
                  onClick={() => onWrite(write.kind)}
                >
                  {WRITE_LABEL[write.kind].many(write.count)}
                </Button>
              ))}
              {writes.length && !connected ? (
                <p className="seo-group__batch-note">
                  {managed ? (
                    <>
                      AI is switched off for this site. A workspace manager can turn it on in{" "}
                      {manageUrl ? (
                        <a className="g-link" href={manageUrl} target="_blank" rel="noopener noreferrer">
                          Galley Cloud
                        </a>
                      ) : (
                        "Galley Cloud"
                      )}
                      .
                    </>
                  ) : (
                    "Connect the assistant in App settings to have it write these. It uses one request per page, and only what each page already says."
                  )}
                </p>
              ) : null}
            </div>
          ) : null}
          <ul className="seo-findings">
            {findings.map((finding) => (
              <FindingRow
                key={finding.id}
                finding={finding}
                siteId={siteId}
                connected={connected}
                fixing={fixing.has(finding.id)}
                onFix={(item) => onFix([item])}
                onWrite={(item) => onWrite(item.write!, item.path ? [item.path] : undefined)}
                address={`${address}${finding.url && finding.url !== "/" ? ` › ${finding.url.split("/").filter(Boolean).join(" › ")}` : ""}`}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function RenderNote({ siteId, audit }: { siteId: string; audit: SiteAudit }) {
  const preview = usePreviewStatus(siteId);
  const run = usePreview((s) => s.run);

  if (audit.rendering.source !== "none") {
    return (
      <p className="seo-note">
        <Icon name="eye" /> {audit.rendering.detail} {sampleWords(audit.rendering)}
        {audit.rendering.stale ? " Start the preview to check your latest changes." : ""}
      </p>
    );
  }
  return (
    <p className="seo-note seo-note--action">
      <Icon name="eye" />
      <span>Only the content files were checked. Start the preview to also check the pages as visitors and crawlers get them: headings, preferred addresses, structured data and the sitemap.</span>
      <Button size="sm" variant="secondary" icon="play" busy={preview?.state === "starting" || preview?.state === "installing"} busyLabel="Starting…" onClick={() => void run(siteId, "start")}>
        Start the preview
      </Button>
    </p>
  );
}

function Body({ siteId, audit, refetch }: { siteId: string; audit: SiteAudit; refetch: () => Promise<unknown> }) {
  const production = useSite((s) => s.detail?.model.urls.production);
  const { disabled: aiDisabled } = useManagedAi();
  const connected = !aiDisabled && (useQuery(["settings"], () => api("GET /api/settings")).data?.secrets.some((secret) => secret.name === "anthropic" && secret.configured) ?? false);
  const [open, setOpen] = useState<ReadonlySet<FindingGroup>>(() => new Set(GROUP_ORDER.filter((group) => audit.byGroup[group].must + audit.byGroup[group].should > 0).slice(0, 1)));
  const [batch, setBatch] = useState<{ kind: WriteKind; paths?: string[] } | null>(null);
  const { fix, busy } = useFixes(siteId, refetch);
  const address = siteAddress(production);
  const byGroup = useMemo(() => new Map(GROUP_ORDER.map((group) => [group, audit.findings.filter((f) => f.group === group)])), [audit.findings]);
  const toggle = (group: FindingGroup) => {
    const next = new Set(open);

    if (next.has(group)) next.delete(group);
    else next.add(group);
    setOpen(next);
  };

  return (
    <>
      <div className="seo-overview">
        <Tally audit={audit} />
        {/* The counts are in the tallies; the summary's first sentence says what was checked. */}
        <p className="seo-overview__summary">{audit.summary.split(/(?<=\.)\s/)[0]}</p>
      </div>
      <RenderNote siteId={siteId} audit={audit} />
      <div className="seo-layout">
        <div className="seo-layout__main">
          {GROUP_ORDER.map((group) => (
            <Group
              key={group}
              siteId={siteId}
              group={group}
              findings={byGroup.get(group) ?? []}
              open={open.has(group)}
              onToggle={() => toggle(group)}
              connected={connected}
              address={address}
              fixing={busy}
              onFix={(items) => void fix(items)}
              onWrite={(kind, paths) => setBatch({ kind, ...(paths ? { paths } : {}) })}
            />
          ))}
          <p className="seo-fineprint">
            Each item says whether it is measured on the site, documented by the search engine or AI provider (with a link to their page), or a judgement. Nothing here predicts rankings or whether an AI assistant will quote the site.
          </p>
        </div>
        <aside className="seo-layout__side" aria-label="How AI systems see this site">
          <h2 className="seo-side__title">How AI systems see this site</h2>
          <CrawlerPanel siteId={siteId} report={audit.crawlers} onSaved={(next: CrawlerReport) => setQueryData(visibilityKeys.site(siteId), { ...audit, crawlers: next })} />
          <AgentPanel siteId={siteId} report={audit.agentReadable} />
        </aside>
      </div>
      <BatchDialog siteId={siteId} open={batch !== null} kind={batch?.kind ?? null} {...(batch?.paths ? { paths: batch.paths } : {})} onClose={() => setBatch(null)} onFinished={() => void refetch()} />
    </>
  );
}

/** /sites/:siteId/visibility — how search engines and AI assistants find, read and quote the site. */
export function VisibilityScreen() {
  const { siteId = "" } = useParams();
  const siteName = useSite((s) => s.detail?.name ?? "Site");
  const audit = useSiteAudit(siteId);

  useTopBar({ crumbs: [{ label: siteName, to: `/sites/${siteId}` }, { label: "Search & AI" }] });
  let body;
  if (audit.loading) {
    body = (
      <div aria-busy="true" className="seo-loading">
        <Skeleton height={64} />
        {GROUP_ORDER.map((group) => (
          <Skeleton key={group} height={56} />
        ))}
      </div>
    );
  } else if (!audit.data) {
    body = <ErrorState title="Couldn’t check the site" error={audit.error} onRetry={() => void audit.refetch()} />;
  } else if (audit.data.pages.checked === 0) {
    body = <EmptyState title="Nothing to check yet." body="Once the site has pages, this shows how search engines and AI assistants see them." />;
  } else {
    body = <Body siteId={siteId} audit={audit.data} refetch={audit.refetch} />;
  }
  return (
    <div className="app-screen seo-screen">
      <div className="app-screen__inner">
        <PageHeader
          title="Search & AI"
          description="How search engines and AI assistants find, read and quote this site — what needs fixing, and ideas worth a look. Fixes wait in Proof like any other change."
          actions={
            <Button variant="secondary" icon="refresh" busy={audit.fetching && !audit.loading} busyLabel="Checking…" onClick={() => void audit.refetch()}>
              Check again
            </Button>
          }
        />
        {body}
        <SettingsFileLink siteId={siteId} />
      </div>
    </div>
  );
}
