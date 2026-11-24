import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentReadableReport, AgentView, CrawlerChoice, CrawlerReport, CrawlerStatus } from "@galley/core/seo/types";
import { agentFileTarget, PreviewTabLink } from "@/features/hosting/previewLinks";
import { api } from "@/lib/api";
import { useMeta } from "@/lib/stores/meta";
import { useQuery } from "@/lib/query";
import { useSite } from "@/lib/stores/site";
import { usePreviewStatus } from "@/lib/stores/preview";
import { notify } from "@/lib/stores/toasts";
import { Button, Icon, SegmentedControl, Select, Skeleton } from "@/ui";
import { crawlerChangeWords, rebaseChoices } from "./logic";

const PURPOSE: Record<CrawlerStatus["purpose"], string> = {
  search: "Answers with links",
  training: "Model training",
  user: "Fetches for a person",
  dataset: "Open archive",
};

const CHOICES = [
  { value: "allow" as const, label: "Allow" },
  { value: "block" as const, label: "Block" },
];

function CrawlerRow({ crawler, value, editable, onChange }: { crawler: CrawlerStatus; value: CrawlerChoice; editable: boolean; onChange: (next: CrawlerChoice) => void }) {
  return (
    <li className="seo-crawler">
      <div className="seo-crawler__control">
        <span className="seo-crawler__name">
          {crawler.label}
          <span className="seo-crawler__purpose">{PURPOSE[crawler.purpose]}</span>
        </span>
        {editable ? <SegmentedControl label={`${crawler.label}`} options={CHOICES} value={value} onChange={onChange} /> : <span className="seo-crawler__state" data-allowed={value === "allow"}>{value === "allow" ? "Allowed" : "Blocked"}</span>}
      </div>
      <details className="seo-crawler__more">
        <summary>
          What it does · <span className="g-mono">{crawler.token}</span>
        </summary>
        <p className="seo-crawler__what">{crawler.what}</p>
        <p className="seo-crawler__if">
          If blocked: {crawler.ifBlocked}{" "}
          <a href={crawler.source.url} target="_blank" rel="noreferrer" className="g-link">
            {crawler.vendor}’s page
            <Icon name="external" size={12} />
          </a>
        </p>
        {crawler.caveat ? <p className="seo-crawler__caveat">{crawler.caveat}</p> : null}
      </details>
    </li>
  );
}

/** The AI-crawler policy in plain words, with a choice per crawler when the rules are a file the app may change. */
export function CrawlerPanel({ siteId, report, onSaved }: { siteId: string; report: CrawlerReport; onSaved: (next: CrawlerReport) => void }) {
  const initial = useMemo(() => Object.fromEntries(report.crawlers.map((c) => [c.token, c.allowed ? "allow" : "block"])) as Record<string, CrawlerChoice>, [report]);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const changed = Object.keys(draft).filter((token) => draft[token] !== initial[token]);
  const vendors = [...new Set(report.crawlers.map((c) => c.vendor))];
  const pending = crawlerChangeWords(report.crawlers.filter((c) => changed.includes(c.token)).map((c) => ({ label: c.label, to: draft[c.token] ?? "allow" })));

  // A fresh report (the audit reruns after every change) keeps the choices waiting to be confirmed.
  const seen = useRef(initial);
  useEffect(() => {
    if (seen.current === initial) return;
    const before = seen.current;
    seen.current = initial;
    setDraft((current) => rebaseChoices(current, before, initial));
  }, [initial]);
  const save = async () => {
    setSaving(true);
    try {
      const next = await api("PUT /api/sites/:siteId/visibility/crawlers", { params: { siteId }, body: { choices: Object.fromEntries(changed.map((token) => [token, draft[token]!])) } });

      onSaved(next);
      notify({
        tone: "success",
        title: "Crawler rules changed",
        body: report.where.kind === "kit" ? "The change to the crawler choices is waiting in Proof. The site writes them into robots.txt once you publish." : "The new robots.txt is waiting in Proof. Crawlers see it once you publish.",
      });
    } catch (error) {
      notify({ tone: "danger", title: "Couldn’t change the crawler rules", body: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="app-card seo-panel seo-panel--crawlers" aria-labelledby="seo-crawlers-title">
      <header className="seo-panel__head">
        <h2 id="seo-crawlers-title" className="seo-panel__title">
          AI crawlers
        </h2>
        <p className="seo-panel__lede">
          Search crawlers decide whether AI assistants can find and link to this site; training crawlers decide whether its pages may train models. Blocking one isn’t blocking the other. Following these rules is up to each crawler: reputable ones say they do.
        </p>
      </header>
      {report.where.kind === "kit" ? (
        <p className="seo-panel__note">
          {report.policy} These choices are kept in <span className="g-mono">{report.where.path}</span>; the site writes robots.txt from them each time it is built.
        </p>
      ) : null}
      <ul className="seo-panel__summary">
        {report.summary.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {report.readable ? (
        vendors.map((vendor) => (
          <div key={vendor} className="seo-crawlers">
            <h3 className="seo-crawlers__vendor">{vendor}</h3>
            <ul className="seo-crawlers__list">
              {report.crawlers
                .filter((c) => c.vendor === vendor)
                .map((crawler) => (
                  <CrawlerRow key={crawler.token} crawler={crawler} value={draft[crawler.token] ?? "allow"} editable={report.editable} onChange={(next) => setDraft({ ...draft, [crawler.token]: next })} />
                ))}
            </ul>
          </div>
        ))
      ) : null}
      {report.editNote ? <p className="seo-panel__note">{report.editNote}</p> : null}
      {report.editable && pending ? (
        // Stays in view at the foot of the screen while choices are waiting, so the confirm step is next to the switch just used.
        <div className="seo-savebar" role="region" aria-label="Unsaved crawler choices" data-keep-clear>
          <p className="seo-savebar__text" role="status">
            <b>{pending.title}</b> {pending.detail}
          </p>
          <div className="seo-savebar__actions">
            <Button variant="secondary" size="sm" onClick={() => setDraft(initial)}>
              Keep as it is
            </Button>
            <Button variant="primary" size="sm" busy={saving} busyLabel="Saving…" onClick={() => void save()}>
              {pending.confirm}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** The site kit's markdown address for a page: /about/ → /about.md, the home page → /index.md. */
function twinOf(path: string): string {
  return path === "/" ? "/index.md" : `${path.replace(/\/$/, "")}.md`;
}

/** Whether an agent-readable version is served, and what an agent receives for one page. */
export function AgentPanel({ siteId, report }: { siteId: string; report: AgentReadableReport }) {
  const all = useSite((s) => s.detail?.model.collections);
  const collections = useMemo(() => (all ?? []).filter((c) => c.kind === "entries" && c.url), [all]);
  const lists = useQuery(["site", siteId, "visibility", "pages", collections.map((c) => c.id).join(",")], async () => {
    const all = await Promise.all(collections.slice(0, 4).map((c) => api("GET /api/sites/:siteId/entries", { params: { siteId }, query: { collection: c.id, limit: 40, sort: "title" } })));

    return all.flatMap((list) => list.items).filter((item) => item.url);
  }, { enabled: collections.length > 0 });
  const options = useMemo(() => (lists.data ?? []).map((item) => ({ value: item.url!, label: `${item.title} · ${item.url}` })), [lists.data]);
  const [url, setUrl] = useState("/");
  const previewUrl = usePreviewStatus(siteId)?.url ?? null;
  // On a hosted install the preview opens through its entry (features/hosting/previewLinks.tsx).
  const meta = useMeta((s) => s.meta);
  const published = report.kit
    ? [report.kit.markdownTwins ? "a markdown version of every page" : null, report.kit.llmsTxt ? "llms.txt" : null, report.kit.llmsFullTxt ? "llms-full.txt (the whole site in one file)" : null, report.kit.agentPage ? "agent.md (a short guide for agents)" : null].filter((part): part is string => part !== null)
    : [];
  const [view, setView] = useState<AgentView | null>(null);
  const [loading, setLoading] = useState(false);
  const show = async () => {
    setLoading(true);
    try {
      setView(await api("GET /api/sites/:siteId/visibility/agent-view", { params: { siteId }, query: { url } }));
    } catch (error) {
      notify({ tone: "danger", title: "Couldn’t read that page", body: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="app-card seo-panel" aria-labelledby="seo-agent-title">
      <header className="seo-panel__head">
        <h2 id="seo-agent-title" className="seo-panel__title">
          What an AI agent reads
        </h2>
        {/* On a kit site the note below says what is published; the lede keeps only what was found served. */}
        <p className="seo-panel__lede">{report.kit ? (report.summary.split(`${report.kit.file}. `)[1] ?? report.summary) : report.summary}</p>
      </header>
      {report.kit ? (
        <p className="seo-panel__note">
          {published.length
            ? `This site publishes ${published.join(", ")}, set in `
            : "This site is set to publish no agent-readable version, in "}
          <span className="g-mono">{report.kit.file}</span>.{" "}
          {previewUrl ? (
            <>
              In the preview:{" "}
              <PreviewTabLink siteId={siteId} target={agentFileTarget(meta, previewUrl, "/llms.txt")} className="g-link" entryClassName="app-link-button">
                llms.txt
                <Icon name="external" size={12} />
              </PreviewTabLink>{" "}
              ·{" "}
              <PreviewTabLink siteId={siteId} target={agentFileTarget(meta, previewUrl, twinOf(url))} className="g-link" entryClassName="app-link-button">
                this page’s markdown version
                <Icon name="external" size={12} />
              </PreviewTabLink>
            </>
          ) : (
            "Start the preview to open them."
          )}
        </p>
      ) : null}
      <p className="seo-panel__small">
        {report.kit ? "" : "An agent-readable version is an llms.txt file and a plain-text copy of each page. "}Google says its search doesn’t use them, and so far there is little evidence that other AI systems read them. Offering one is a choice, not a requirement.{" "}
        <a className="g-link" href="https://llmstxt.org/" target="_blank" rel="noreferrer">
          The proposal
          <Icon name="external" size={12} />
        </a>
      </p>
      <div className="seo-agent__pick">
        {options.length ? <Select value={url} onChange={setUrl} options={[{ value: "/", label: "Home page · /" }, ...options.filter((o) => o.value !== "/")]} /> : <Skeleton height={32} />}
        <Button variant="secondary" size="sm" icon="eye" busy={loading} busyLabel="Reading…" onClick={() => void show()}>
          Show
        </Button>
      </div>
      {view ? (
        <div className="seo-agent__view">
          <p className="seo-panel__small">
            {view.kind === "markdown" ? `The page’s own markdown version: ${view.from}.` : view.kind === "text" ? `No markdown version, so this is the page’s text as sent, before any script runs — ${view.from}.` : `Read from ${view.from}.`}
          </p>
          <pre className="seo-agent__text" tabIndex={0} aria-label="What an agent receives">
            {view.text || "(nothing)"}
            {view.truncated ? "\n…" : ""}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
