import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type {
  BrokenBacklinkTarget,
  KeywordExploreResult,
  RankedKeywordItem,
  SearchIntelligenceState,
  SearchIntent,
  TuneEntryResult,
} from "@galley/core/seo/types";
import { SettingsLink } from "@/features/accounts/SettingsLink";
import { api, errorShape } from "@/lib/api";
import { setQueryData } from "@/lib/query";
import { notify } from "@/lib/stores/toasts";
import { Badge, Button, Dialog, EmptyState, Icon, Input, Select, buttonClass } from "@/ui";
import { visibilityKeys } from "./useVisibility";

const LOCATIONS = [
  { value: "2840", label: "United States" },
  { value: "2826", label: "United Kingdom" },
  { value: "2124", label: "Canada" },
  { value: "2036", label: "Australia" },
  { value: "2276", label: "Germany" },
  { value: "2250", label: "France" },
];

const INTENT_TONE: Record<SearchIntent, "accent" | "success" | "warning" | "neutral"> = {
  transactional: "success",
  commercial: "accent",
  informational: "neutral",
  navigational: "warning",
};

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString();
}

function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtDate(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function posDelta(item: RankedKeywordItem): { text: string; tone: "up" | "down" } | null {
  if (item.previousPosition === null || item.previousPosition === undefined) return null;
  const diff = item.previousPosition - item.position;

  if (diff === 0) return null;
  return diff > 0 ? { text: `+${diff}`, tone: "up" } : { text: `${diff}`, tone: "down" };
}

/** Shown on self-hosted / local installs before a live search data key is saved. */
export function SearchDataConnectCard({ disabledManaged }: { disabledManaged?: boolean }) {
  if (disabledManaged) {
    return (
      <section className="app-card seo-connect" aria-label="Search intelligence switched off">
        <div className="seo-connect__body">
          <div className="seo-connect__head">
            <Icon name="visibility" />
            <h2 className="seo-connect__title">Live search intelligence is switched off for this site</h2>
          </div>
          <p className="seo-connect__text">
            A workspace manager can turn live search intelligence back on for this site in Galley Cloud. Your built-in site checks and AI crawler controls continue to work as usual.
          </p>
        </div>
      </section>
    );
  }
  return (
    <section className="app-card seo-connect" aria-label="Connect live search data">
      <div className="seo-connect__body">
        <div className="seo-connect__head">
          <Icon name="visibility" />
          <h2 className="seo-connect__title">Connect live search intelligence</h2>
          <Badge tone="neutral">Bring your own key</Badge>
        </div>
        <p className="seo-connect__text">
          See live Google rankings, striking-distance quick wins (#4–#20), keyword difficulty &amp; intent, competitor content gaps, broken 404 backlinks, and AI answer citations — mapped directly to your site’s pages with 1-click actions into Proof.
        </p>
        <p className="seo-connect__hint">
          Add a live search data key in App settings (or set <code className="g-mono">GALLEY_SEARCH_DATA_KEY</code> in your environment). Included automatically on Galley Cloud plans.
        </p>
      </div>
      <div className="seo-connect__actions">
        <SettingsLink
          route="PUT /api/secrets/:name"
          className={buttonClass("primary", "sm")}
          to="/settings#search-data"
          fallback="Ask an owner of this editor to add a live search data key in App settings."
        >
          Connect in App settings
        </SettingsLink>
      </div>
    </section>
  );
}

interface ControlsProps {
  siteId: string;
  state: SearchIntelligenceState;
  refreshing: boolean;
  onRefresh: (body: { domain?: string; locationCode?: number; competitors?: string[] }) => Promise<void>;
}

/** Domain, region, and Refresh live data bar shown when search intelligence is configured or managed. */
export function IntelligenceControlsBar({ state, refreshing, onRefresh }: ControlsProps) {
  const [domain, setDomain] = useState(state.config.domain);
  const [locationCode, setLocationCode] = useState(String(state.config.locationCode || 2840));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onRefresh({
      domain: domain.trim() || undefined,
      locationCode: Number(locationCode) || 2840,
      competitors: state.config.competitors,
    });
  };

  return (
    <form className="app-card seo-intel-bar" onSubmit={submit} aria-label="Live search data settings">
      <div className="seo-intel-bar__fields">
        <label className="seo-intel-bar__field">
          <span className="g-eyebrow">Tracked domain</span>
          <Input
            size="sm"
            value={domain}
            placeholder="example.com"
            onChange={(event) => setDomain(event.target.value)}
            aria-label="Tracked domain"
          />
        </label>
        <label className="seo-intel-bar__field seo-intel-bar__field--narrow">
          <span className="g-eyebrow">Region</span>
          <Select
            value={locationCode}
            options={LOCATIONS}
            onChange={(next) => setLocationCode(next)}
            aria-label="Search region"
          />
        </label>
      </div>
      <div className="seo-intel-bar__end">
        {state.status.managed ? <Badge tone="success">Included in plan</Badge> : null}
        {state.snapshot ? <span className="seo-intel-bar__time">Updated {fmtDate(state.snapshot.fetchedAt)}</span> : null}
        <Button type="submit" size="sm" variant="primary" icon="refresh" busy={refreshing} busyLabel="Refreshing…">
          {state.snapshot ? "Refresh live data" : "Fetch live data"}
        </Button>
      </div>
    </form>
  );
}

/** Modal displaying live Top-3 SERP context and before/after diffs written to Proof by Tune page. */
export function TuneResultDialog({
  siteId,
  result,
  onClose,
}: {
  siteId: string;
  result: TuneEntryResult | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={result !== null}
      onClose={onClose}
      title={result ? `Tuned for “${result.keyword}”` : "Tuned page"}
      description={result ? `${result.path} · ${result.applied ? "Changes are waiting in Proof." : "No changes were needed."}` : undefined}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
          {result && result.applied > 0 ? (
            <Link className={buttonClass("primary", "md")} to={`/sites/${siteId}/proof`}>
              Review in Proof
            </Link>
          ) : null}
        </>
      }
    >
      {result ? (
        <div className="seo-tune-dialog">
          <p className="seo-tune-dialog__summary">{result.summary}</p>
          {result.title?.changed ? (
            <div className="seo-tune-diff">
              <span className="g-eyebrow">Title</span>
              <p className="seo-tune-diff__before">{result.title.before || "(empty)"}</p>
              <p className="seo-tune-diff__after">{result.title.after}</p>
            </div>
          ) : null}
          {result.description?.changed ? (
            <div className="seo-tune-diff">
              <span className="g-eyebrow">Description</span>
              <p className="seo-tune-diff__before">{result.description.before || "(empty)"}</p>
              <p className="seo-tune-diff__after">{result.description.after}</p>
            </div>
          ) : null}
          {result.opening?.changed ? (
            <div className="seo-tune-diff">
              <span className="g-eyebrow">Opening paragraph</span>
              <p className="seo-tune-diff__before">{result.opening.before}</p>
              <p className="seo-tune-diff__after">{result.opening.after}</p>
            </div>
          ) : null}
          {result.serpTop.length > 0 ? (
            <div className="seo-serp-list">
              <span className="g-eyebrow">Top live search results compared</span>
              <ul>
                {result.serpTop.map((item) => (
                  <li key={`${item.position}-${item.url}`}>
                    <span className="seo-serp-list__pos">#{item.position}</span>
                    <div>
                      <div className="seo-serp-list__title">{item.title}</div>
                      <div className="seo-serp-list__domain g-mono">{item.domain}</div>
                      {item.description ? <p className="seo-serp-list__desc">{item.description}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}

interface OverviewProps {
  siteId: string;
  state: SearchIntelligenceState;
  aiConnected: boolean;
  tuningKey: string | null;
  draftingKey: string | null;
  onTune: (path: string, keyword: string) => void;
  onDraftGap: (keyword: string, collection?: string | null) => void;
  onSwitchTab: (tab: string) => void;
}

export function OverviewIntelligencePanel({
  siteId,
  state,
  aiConnected,
  tuningKey,
  draftingKey,
  onTune,
  onDraftGap,
  onSwitchTab,
}: OverviewProps) {
  const snapshot = state.snapshot;

  if (!snapshot) {
    return (
      <EmptyState
        title="Ready to fetch live search intelligence."
        body="Choose your tracked domain above and click Fetch live data to load rankings, striking-distance quick wins, competitor gaps, backlinks, and AI citations."
      />
    );
  }

  return (
    <div className="seo-intel-stack">
      {snapshot.warnings.length > 0 ? (
        <div className="seo-note" role="status">
          <Icon name="warning" />
          <span>{snapshot.warnings.join(" ")}</span>
        </div>
      ) : null}

      <div className="seo-kpis" role="group" aria-label="Search intelligence summary">
        <div className="seo-kpi">
          <span className="seo-kpi__value">{fmtNum(snapshot.tallies.rankingKeywords)}</span>
          <span className="seo-kpi__label">Ranking keywords</span>
          <span className="seo-kpi__sub">{fmtNum(snapshot.tallies.top3Count)} in Top 3</span>
        </div>
        <div className="seo-kpi">
          <span className="seo-kpi__value">{fmtNum(snapshot.tallies.estimatedMonthlyVisits)}</span>
          <span className="seo-kpi__label">Est. visits / mo</span>
          <span className="seo-kpi__sub">from organic search</span>
        </div>
        <div className="seo-kpi seo-kpi--accent">
          <span className="seo-kpi__value">{fmtNum(snapshot.tallies.strikingDistanceCount)}</span>
          <span className="seo-kpi__label">Quick wins (#4–#20)</span>
          <span className="seo-kpi__sub">striking distance</span>
        </div>
        <div className="seo-kpi">
          <span className="seo-kpi__value">{fmtNum(snapshot.tallies.referringDomains)}</span>
          <span className="seo-kpi__label">Referring domains</span>
          <span className="seo-kpi__sub">
            {snapshot.tallies.brokenBacklinkTargets > 0 ? `${snapshot.tallies.brokenBacklinkTargets} broken 404 targets` : "no broken 404 targets"}
          </span>
        </div>
        <div className="seo-kpi">
          <span className="seo-kpi__value">{snapshot.aiCitations.available ? fmtNum(snapshot.tallies.aiCitationsCount) : "—"}</span>
          <span className="seo-kpi__label">AI answer citations</span>
          <span className="seo-kpi__sub">{snapshot.aiCitations.available ? "ChatGPT & AI Overviews" : "not enabled on key"}</span>
        </div>
      </div>

      {/* Striking-distance quick wins */}
      <section className="app-card seo-card-section">
        <header className="seo-card-section__head">
          <div>
            <h2 className="seo-card-section__title">Striking-distance quick wins (#4–#20)</h2>
            <p className="seo-card-section__desc">Pages already on page 1–2 where sharper titles, descriptions, or openings can lift clicks right away.</p>
          </div>
          {snapshot.rankings.length > 0 ? (
            <Button size="sm" variant="quiet" onClick={() => onSwitchTab("rankings")}>
              All {snapshot.rankings.length} rankings
            </Button>
          ) : null}
        </header>
        {snapshot.strikingDistance.length === 0 ? (
          <p className="seo-card-section__empty">No striking-distance keywords (#4–#20) found for {snapshot.domain} in this snapshot.</p>
        ) : (
          <div className="seo-table-wrap">
            <table className="seo-table">
              <thead>
                <tr>
                  <th scope="col">Query</th>
                  <th scope="col">Pos</th>
                  <th scope="col">Vol / mo</th>
                  <th scope="col">Page in Galley</th>
                  <th scope="col" className="seo-table__right">Action</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.strikingDistance.slice(0, 12).map((item) => {
                  const key = `${item.entryPath ?? item.urlPath}:${item.keyword}`;
                  const delta = posDelta(item);

                  return (
                    <tr key={`${item.keyword}-${item.urlPath}`}>
                      <td>
                        <div className="seo-table__primary">{item.keyword}</div>
                        {item.intent ? <Badge tone={INTENT_TONE[item.intent]}>{item.intent}</Badge> : null}
                      </td>
                      <td className="g-mono">
                        #{item.position}
                        {delta ? <span className={`seo-delta seo-delta--${delta.tone}`}> {delta.text}</span> : null}
                      </td>
                      <td className="g-mono">{fmtNum(item.searchVolume)}</td>
                      <td>
                        {item.entryPath ? (
                          <Link className="g-link" to={`/sites/${siteId}/edit?path=${encodeURIComponent(item.entryPath)}`}>
                            {item.entryTitle ?? item.entryPath}
                          </Link>
                        ) : (
                          <span className="g-mono g-faint">{item.urlPath}</span>
                        )}
                      </td>
                      <td className="seo-table__right">
                        {item.entryPath ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon="proof"
                            disabled={!aiConnected}
                            busy={tuningKey === key}
                            busyLabel="Tuning…"
                            title={aiConnected ? "Compare against top 3 live results and stage improvements in Proof" : "Connect the assistant in App settings to tune pages"}
                            onClick={() => onTune(item.entryPath!, item.keyword)}
                          >
                            Tune in Proof
                          </Button>
                        ) : (
                          <span className="g-hint">Unmatched route</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Callouts: broken backlinks + cannibalization */}
      {(snapshot.backlinks.brokenTargets.length > 0 || snapshot.cannibalization.length > 0) ? (
        <div className="seo-callouts">
          {snapshot.backlinks.brokenTargets.length > 0 ? (
            <section className="app-card seo-callout">
              <div className="seo-callout__head">
                <Badge tone="warning">{snapshot.backlinks.brokenTargets.length} broken</Badge>
                <h3>Broken backlinks you can recover with a 301 redirect</h3>
              </div>
              <p className="seo-callout__text">
                External sites still link to {snapshot.backlinks.brokenTargets.length} missing URL{snapshot.backlinks.brokenTargets.length === 1 ? "" : "s"} on {snapshot.domain}. Redirect them to live pages in 1 click.
              </p>
              <Button size="sm" variant="secondary" icon="link" onClick={() => onSwitchTab("backlinks")}>
                Recover broken backlinks
              </Button>
            </section>
          ) : null}
          {snapshot.cannibalization.length > 0 ? (
            <section className="app-card seo-callout">
              <div className="seo-callout__head">
                <Badge tone="warning">{snapshot.cannibalization.length} competing</Badge>
                <h3>Keyword cannibalization alerts</h3>
              </div>
              <ul className="seo-cannibal-list">
                {snapshot.cannibalization.slice(0, 4).map((alert) => (
                  <li key={alert.keyword}>
                    <strong>{alert.keyword}</strong> ({fmtNum(alert.searchVolume)}/mo) —{" "}
                    {alert.pages.map((p, idx) => (
                      <span key={p.urlPath}>
                        {idx > 0 ? " vs " : ""}
                        <span className="g-mono">{p.urlPath}</span> (#{p.position})
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      {/* Top competitor gaps preview */}
      {snapshot.competitorGaps.length > 0 ? (
        <section className="app-card seo-card-section">
          <header className="seo-card-section__head">
            <div>
              <h2 className="seo-card-section__title">Top competitor content gaps</h2>
              <p className="seo-card-section__desc">Topics where rivals rank Top 10 and {snapshot.domain} has no ranking page yet.</p>
            </div>
            <Button size="sm" variant="quiet" onClick={() => onSwitchTab("gaps")}>
              View all {snapshot.competitorGaps.length}
            </Button>
          </header>
          <div className="seo-table-wrap">
            <table className="seo-table">
              <thead>
                <tr>
                  <th scope="col">Topic</th>
                  <th scope="col">Vol / mo</th>
                  <th scope="col">KD</th>
                  <th scope="col">Rival</th>
                  <th scope="col" className="seo-table__right">Action</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.competitorGaps.slice(0, 5).map((gap) => (
                  <tr key={gap.keyword}>
                    <td className="seo-table__primary">{gap.keyword}</td>
                    <td className="g-mono">{fmtNum(gap.searchVolume)}</td>
                    <td className="g-mono">{gap.keywordDifficulty ?? "—"}</td>
                    <td>
                      <span className="g-mono">{gap.competitor}</span> <span className="g-faint">#{gap.competitorPosition}</span>
                    </td>
                    <td className="seo-table__right">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="plus"
                        disabled={!aiConnected}
                        busy={draftingKey === gap.keyword}
                        busyLabel="Drafting…"
                        onClick={() => onDraftGap(gap.keyword, gap.suggestedCollection)}
                      >
                        Draft page → Proof
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

interface RankingsProps {
  siteId: string;
  state: SearchIntelligenceState;
  aiConnected: boolean;
  tuningKey: string | null;
  draftingKey: string | null;
  onTune: (path: string, keyword: string) => void;
  onDraftGap: (keyword: string, collection?: string | null) => void;
}

export function RankingsExplorerPanel({
  siteId,
  state,
  aiConnected,
  tuningKey,
  draftingKey,
  onTune,
  onDraftGap,
}: RankingsProps) {
  const [seed, setSeed] = useState("");
  const [exploring, setExploring] = useState(false);
  const [exploreResult, setExploreResult] = useState<KeywordExploreResult | null>(null);
  const [filterText, setFilterText] = useState("");
  const [posFilter, setPosFilter] = useState<"all" | "top3" | "striking" | "unmatched">("all");

  const runExplore = async (event: FormEvent) => {
    event.preventDefault();
    const keyword = seed.trim();

    if (!keyword) return;
    setExploring(true);
    try {
      const result = await api("POST /api/sites/:siteId/visibility/intelligence/explore", {
        params: { siteId },
        body: { keyword, locationCode: state.config.locationCode },
      });

      setExploreResult(result);
    } catch (caught) {
      notify({ tone: "danger", title: "Couldn’t explore that keyword", body: errorShape(caught).message });
    } finally {
      setExploring(false);
    }
  };

  const rankings = state.snapshot?.rankings ?? [];
  const filteredRankings = useMemo(() => {
    const q = filterText.trim().toLowerCase();

    return rankings.filter((item) => {
      if (posFilter === "top3" && item.position > 3) return false;
      if (posFilter === "striking" && (item.position < 4 || item.position > 20)) return false;
      if (posFilter === "unmatched" && item.entryPath !== null) return false;
      if (!q) return true;
      return (
        item.keyword.toLowerCase().includes(q) ||
        item.urlPath.toLowerCase().includes(q) ||
        (item.entryTitle ?? "").toLowerCase().includes(q)
      );
    });
  }, [rankings, filterText, posFilter]);

  return (
    <div className="seo-intel-stack">
      <section className="app-card seo-card-section">
        <header className="seo-card-section__head">
          <div>
            <h2 className="seo-card-section__title">Live keyword explorer</h2>
            <p className="seo-card-section__desc">Check search volume, keyword difficulty, intent, and whether your site already covers a topic.</p>
          </div>
        </header>
        <form className="seo-explore-form" onSubmit={runExplore}>
          <Input
            size="sm"
            value={seed}
            placeholder="Try a topic or query (e.g. planned maintenance software)"
            onChange={(event) => setSeed(event.target.value)}
            aria-label="Seed keyword"
          />
          <Button type="submit" size="sm" variant="primary" icon="search" busy={exploring} busyLabel="Exploring…">
            Explore
          </Button>
        </form>
        {exploreResult ? (
          <div className="seo-explore-results">
            <div className="seo-table-wrap">
              <table className="seo-table">
                <thead>
                  <tr>
                    <th scope="col">Keyword</th>
                    <th scope="col">Vol / mo</th>
                    <th scope="col">KD</th>
                    <th scope="col">CPC</th>
                    <th scope="col">Intent</th>
                    <th scope="col">Site coverage</th>
                    <th scope="col" className="seo-table__right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {exploreResult.suggestions.map((item) => (
                    <tr key={item.keyword}>
                      <td className="seo-table__primary">{item.keyword}</td>
                      <td className="g-mono">{fmtNum(item.searchVolume)}</td>
                      <td className="g-mono">{item.keywordDifficulty ?? "—"}</td>
                      <td className="g-mono">{fmtUsd(item.cpc)}</td>
                      <td>{item.intent ? <Badge tone={INTENT_TONE[item.intent]}>{item.intent}</Badge> : "—"}</td>
                      <td>
                        {item.coveredBy ? (
                          <Link className="g-link" to={`/sites/${siteId}/edit?path=${encodeURIComponent(item.coveredBy.entryPath)}`}>
                            {item.coveredBy.entryTitle}
                            {item.coveredBy.position ? ` (#${item.coveredBy.position})` : ""}
                          </Link>
                        ) : (
                          <span className="g-faint">Not covered yet</span>
                        )}
                      </td>
                      <td className="seo-table__right">
                        {item.coveredBy ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon="proof"
                            disabled={!aiConnected}
                            busy={tuningKey === `${item.coveredBy.entryPath}:${item.keyword}`}
                            busyLabel="Tuning…"
                            onClick={() => onTune(item.coveredBy!.entryPath, item.keyword)}
                          >
                            Tune in Proof
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon="plus"
                            disabled={!aiConnected}
                            busy={draftingKey === item.keyword}
                            busyLabel="Drafting…"
                            onClick={() => onDraftGap(item.keyword)}
                          >
                            Draft page → Proof
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {exploreResult.serpTop.length > 0 ? (
              <div className="seo-serp-list seo-serp-list--padded">
                <span className="g-eyebrow">Top live results for “{exploreResult.keyword}”</span>
                <ul>
                  {exploreResult.serpTop.map((s) => (
                    <li key={`${s.position}-${s.url}`}>
                      <span className="seo-serp-list__pos">#{s.position}</span>
                      <div>
                        <div className="seo-serp-list__title">{s.title}</div>
                        <div className="seo-serp-list__domain g-mono">{s.domain}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="app-card seo-card-section">
        <header className="seo-card-section__head">
          <div>
            <h2 className="seo-card-section__title">Domain rankings ({filteredRankings.length})</h2>
            <p className="seo-card-section__desc">Every organic keyword your domain ranks for, matched to the Galley content file behind it.</p>
          </div>
          <div className="seo-filter-row">
            <Input
              size="sm"
              value={filterText}
              placeholder="Filter keywords or routes…"
              onChange={(event) => setFilterText(event.target.value)}
              aria-label="Filter rankings"
            />
            <Select
              value={posFilter}
              options={[
                { value: "all", label: "All positions" },
                { value: "top3", label: "Top 3" },
                { value: "striking", label: "Striking distance (#4–#20)" },
                { value: "unmatched", label: "Unmatched routes" },
              ]}
              onChange={(val) => setPosFilter(val as typeof posFilter)}
              aria-label="Filter by position"
            />
          </div>
        </header>
        {filteredRankings.length === 0 ? (
          <p className="seo-card-section__empty">
            {rankings.length === 0 ? "Fetch live data above to load domain rankings." : "No rankings match this filter."}
          </p>
        ) : (
          <div className="seo-table-wrap">
            <table className="seo-table">
              <thead>
                <tr>
                  <th scope="col">Keyword</th>
                  <th scope="col">Pos</th>
                  <th scope="col">Vol / mo</th>
                  <th scope="col">KD</th>
                  <th scope="col">Intent</th>
                  <th scope="col">Page</th>
                  <th scope="col" className="seo-table__right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRankings.slice(0, 100).map((item) => {
                  const key = `${item.entryPath ?? item.urlPath}:${item.keyword}`;
                  const delta = posDelta(item);

                  return (
                    <tr key={`${item.keyword}-${item.urlPath}-${item.position}`}>
                      <td className="seo-table__primary">{item.keyword}</td>
                      <td className="g-mono">
                        #{item.position}
                        {delta ? <span className={`seo-delta seo-delta--${delta.tone}`}> {delta.text}</span> : null}
                      </td>
                      <td className="g-mono">{fmtNum(item.searchVolume)}</td>
                      <td className="g-mono">{item.keywordDifficulty ?? "—"}</td>
                      <td>{item.intent ? <Badge tone={INTENT_TONE[item.intent]}>{item.intent}</Badge> : "—"}</td>
                      <td>
                        {item.entryPath ? (
                          <Link className="g-link" to={`/sites/${siteId}/edit?path=${encodeURIComponent(item.entryPath)}`}>
                            {item.entryTitle ?? item.entryPath}
                          </Link>
                        ) : (
                          <span className="g-mono g-faint">{item.urlPath}</span>
                        )}
                      </td>
                      <td className="seo-table__right">
                        {item.entryPath ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon="proof"
                            disabled={!aiConnected}
                            busy={tuningKey === key}
                            busyLabel="Tuning…"
                            onClick={() => onTune(item.entryPath!, item.keyword)}
                          >
                            Tune
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

interface GapsProps {
  state: SearchIntelligenceState;
  refreshing: boolean;
  aiConnected: boolean;
  draftingKey: string | null;
  onUpdateCompetitors: (next: string[]) => Promise<void>;
  onDraftGap: (keyword: string, collection?: string | null) => void;
}

export function CompetitorGapsPanel({
  state,
  refreshing,
  aiConnected,
  draftingKey,
  onUpdateCompetitors,
  onDraftGap,
}: GapsProps) {
  const [newComp, setNewComp] = useState("");
  const competitors = state.config.competitors;
  const gaps = state.snapshot?.competitorGaps ?? [];

  const addCompetitor = (event: FormEvent) => {
    event.preventDefault();
    const cleaned = newComp.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";

    if (!cleaned || competitors.includes(cleaned) || competitors.length >= 3) return;
    setNewComp("");
    void onUpdateCompetitors([...competitors, cleaned]);
  };

  return (
    <div className="seo-intel-stack">
      <section className="app-card seo-card-section">
        <header className="seo-card-section__head">
          <div>
            <h2 className="seo-card-section__title">Competitor domains (up to 3)</h2>
            <p className="seo-card-section__desc">Find high-intent keywords where competitors rank Top 10 and your site has no ranking page yet.</p>
          </div>
        </header>
        <div className="seo-comp-bar">
          <div className="seo-comp-chips">
            {competitors.length === 0 ? (
              <span className="g-hint">No competitors added yet.</span>
            ) : (
              competitors.map((comp) => (
                <span key={comp} className="seo-comp-chip">
                  <span className="g-mono">{comp}</span>
                  <button
                    type="button"
                    className="seo-comp-chip__remove"
                    aria-label={`Remove ${comp}`}
                    disabled={refreshing}
                    onClick={() => void onUpdateCompetitors(competitors.filter((item) => item !== comp))}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))
            )}
          </div>
          {competitors.length < 3 ? (
            <form className="seo-comp-form" onSubmit={addCompetitor}>
              <Input
                size="sm"
                value={newComp}
                placeholder="competitor.com"
                onChange={(event) => setNewComp(event.target.value)}
                aria-label="Add competitor domain"
              />
              <Button type="submit" size="sm" variant="secondary" icon="plus" busy={refreshing} busyLabel="Comparing…">
                Add &amp; compare
              </Button>
            </form>
          ) : null}
        </div>
      </section>

      <section className="app-card seo-card-section">
        <header className="seo-card-section__head">
          <div>
            <h2 className="seo-card-section__title">Content gaps ({gaps.length})</h2>
            <p className="seo-card-section__desc">Paired with the collection and section types already defined in your site’s schema.</p>
          </div>
        </header>
        {gaps.length === 0 ? (
          <p className="seo-card-section__empty">
            {competitors.length === 0
              ? "Add a competitor domain above to uncover content gaps."
              : "No Top-10 competitor gaps found in the latest snapshot."}
          </p>
        ) : (
          <div className="seo-table-wrap">
            <table className="seo-table">
              <thead>
                <tr>
                  <th scope="col">Keyword</th>
                  <th scope="col">Rival</th>
                  <th scope="col">Vol / mo</th>
                  <th scope="col">KD</th>
                  <th scope="col">Suggested fit</th>
                  <th scope="col" className="seo-table__right">Action</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map((gap) => (
                  <tr key={gap.keyword}>
                    <td>
                      <div className="seo-table__primary">{gap.keyword}</div>
                      {gap.intent ? <Badge tone={INTENT_TONE[gap.intent]}>{gap.intent}</Badge> : null}
                    </td>
                    <td>
                      <span className="g-mono">{gap.competitor}</span> <span className="g-faint">#{gap.competitorPosition}</span>
                    </td>
                    <td className="g-mono">{fmtNum(gap.searchVolume)}</td>
                    <td className="g-mono">{gap.keywordDifficulty ?? "—"}</td>
                    <td>
                      {gap.suggestedCollection ? (
                        <div className="seo-fit-meta">
                          <span className="g-mono">{gap.suggestedCollection}</span>
                          {gap.suggestedSections.length > 0 ? (
                            <span className="g-faint"> · {gap.suggestedSections.slice(0, 3).join(", ")}</span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="g-faint">—</span>
                      )}
                    </td>
                    <td className="seo-table__right">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="plus"
                        disabled={!aiConnected}
                        busy={draftingKey === gap.keyword}
                        busyLabel="Drafting…"
                        title={aiConnected ? "Create a schema-valid draft in Proof" : "Connect the assistant in App settings to draft pages"}
                        onClick={() => onDraftGap(gap.keyword, gap.suggestedCollection)}
                      >
                        Draft page → Proof
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

interface BacklinksProps {
  siteId: string;
  state: SearchIntelligenceState;
}

export function BacklinksRecoveryPanel({ siteId, state }: BacklinksProps) {
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [savingPath, setSavingPath] = useState<string | null>(null);
  const [recovered, setRecovered] = useState<ReadonlySet<string>>(() => new Set());
  const backlinks = state.snapshot?.backlinks;

  if (!backlinks) {
    return (
      <EmptyState
        title="No backlink data loaded yet."
        body="Click Fetch live data above to inspect referring domains and broken 404 URLs that still hold live external links."
      />
    );
  }

  const addRedirect = async (item: BrokenBacklinkTarget) => {
    const destination = (targets[item.urlPath] ?? item.suggestedTarget ?? "/").trim();

    if (!destination.startsWith("/")) {
      notify({ tone: "warning", title: "Destination must start with /", body: "Enter a route on this site, like /pricing/ or /." });
      return;
    }
    setSavingPath(item.urlPath);
    try {
      const overview = await api("GET /api/sites/:siteId/redirects", { params: { siteId } });
      const exists = overview.redirects.some((r) => r.from.replace(/\/+$/, "") === item.urlPath.replace(/\/+$/, ""));

      if (!exists) {
        await api("PUT /api/sites/:siteId/redirects", {
          params: { siteId },
          body: {
            baseHash: overview.hash,
            redirects: [
              ...overview.redirects,
              {
                from: item.urlPath,
                to: destination,
                status: 301,
                note: `Recovered ${item.referringDomains} referring domain${item.referringDomains === 1 ? "" : "s"}`,
                source: "manual",
              },
            ],
          },
        });
      }
      setRecovered((prev) => new Set([...prev, item.urlPath]));
      // Remove recovered item optimistically from the cached intelligence snapshot.
      setQueryData(visibilityKeys.intelligence(siteId), {
        ...state,
        snapshot: state.snapshot
          ? {
              ...state.snapshot,
              tallies: {
                ...state.snapshot.tallies,
                brokenBacklinkTargets: Math.max(0, state.snapshot.tallies.brokenBacklinkTargets - 1),
              },
              backlinks: {
                ...state.snapshot.backlinks,
                brokenTargets: state.snapshot.backlinks.brokenTargets.filter((b) => b.urlPath !== item.urlPath),
              },
            }
          : null,
      });
      notify({
        tone: "success",
        title: "301 redirect added to Proof",
        body: `${item.urlPath} → ${destination} is staged in your redirects list. Review and publish from Proof.`,
      });
    } catch (caught) {
      notify({ tone: "danger", title: "Couldn’t add redirect", body: errorShape(caught).message });
    } finally {
      setSavingPath(null);
    }
  };

  const remainingBroken = backlinks.brokenTargets.filter((item) => !recovered.has(item.urlPath));

  return (
    <div className="seo-intel-stack">
      <div className="seo-kpis" role="group" aria-label="Backlink summary">
        <div className="seo-kpi">
          <span className="seo-kpi__value">{fmtNum(backlinks.referringDomains)}</span>
          <span className="seo-kpi__label">Referring domains</span>
        </div>
        <div className="seo-kpi">
          <span className="seo-kpi__value">{fmtNum(backlinks.totalBacklinks)}</span>
          <span className="seo-kpi__label">Total backlinks</span>
        </div>
        <div className="seo-kpi">
          <span className="seo-kpi__value">{backlinks.rank ?? "—"}</span>
          <span className="seo-kpi__label">Domain rank</span>
        </div>
        <div className="seo-kpi seo-kpi--accent">
          <span className="seo-kpi__value">{fmtNum(remainingBroken.length)}</span>
          <span className="seo-kpi__label">Broken 404 targets</span>
        </div>
      </div>

      <section className="app-card seo-card-section">
        <header className="seo-card-section__head">
          <div>
            <h2 className="seo-card-section__title">Broken 404 backlink recovery</h2>
            <p className="seo-card-section__desc">
              External sites still point at these missing routes. Stage a permanent 301 redirect directly into Proof with zero AI credits.
            </p>
          </div>
        </header>
        {remainingBroken.length === 0 ? (
          <p className="seo-card-section__empty">No unredirected broken backlink targets found.</p>
        ) : (
          <div className="seo-table-wrap">
            <table className="seo-table">
              <thead>
                <tr>
                  <th scope="col">Broken path</th>
                  <th scope="col">Links</th>
                  <th scope="col">Redirect destination</th>
                  <th scope="col" className="seo-table__right">Action</th>
                </tr>
              </thead>
              <tbody>
                {remainingBroken.map((item) => (
                  <tr key={item.urlPath}>
                    <td>
                      <div className="g-mono seo-table__primary">{item.urlPath}</div>
                      <span className="g-faint">{item.statusCode ? `HTTP ${item.statusCode}` : "Not in site routes"}</span>
                    </td>
                    <td className="g-mono">
                      {fmtNum(item.referringDomains)} domains · {fmtNum(item.backlinks)} links
                    </td>
                    <td>
                      <Input
                        size="sm"
                        mono
                        value={targets[item.urlPath] ?? item.suggestedTarget ?? "/"}
                        onChange={(event) => setTargets((prev) => ({ ...prev, [item.urlPath]: event.target.value }))}
                        aria-label={`Redirect target for ${item.urlPath}`}
                      />
                    </td>
                    <td className="seo-table__right">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="link"
                        busy={savingPath === item.urlPath}
                        busyLabel="Adding…"
                        onClick={() => void addRedirect(item)}
                      >
                        Add 301 → Proof
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="app-card seo-card-section">
        <header className="seo-card-section__head">
          <div>
            <h2 className="seo-card-section__title">Top referring domains</h2>
            <p className="seo-card-section__desc">External domains linking to {state.snapshot?.domain}.</p>
          </div>
        </header>
        {backlinks.topDomains.length === 0 ? (
          <p className="seo-card-section__empty">No referring domains returned in this snapshot.</p>
        ) : (
          <div className="seo-table-wrap">
            <table className="seo-table">
              <thead>
                <tr>
                  <th scope="col">Domain</th>
                  <th scope="col">Rank</th>
                  <th scope="col">Backlinks</th>
                  <th scope="col">First seen</th>
                </tr>
              </thead>
              <tbody>
                {backlinks.topDomains.slice(0, 30).map((dom) => (
                  <tr key={dom.domain}>
                    <td className="g-mono seo-table__primary">{dom.domain}</td>
                    <td className="g-mono">{dom.rank ?? "—"}</td>
                    <td className="g-mono">{fmtNum(dom.backlinks)}</td>
                    <td className="g-faint">{dom.firstSeen ? dom.firstSeen.slice(0, 10) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Live AI answer citations card rendered inside the AI citations & site checks tab. */
export function AiCitationsCard({ siteId, state }: { siteId: string; state: SearchIntelligenceState | undefined }) {
  if (!state || (!state.status.configured && !state.status.managed)) return null;
  const ai = state.snapshot?.aiCitations;

  return (
    <section className="app-card seo-card-section seo-citations-card">
      <header className="seo-card-section__head">
        <div>
          <h2 className="seo-card-section__title">AI answer citations</h2>
          <p className="seo-card-section__desc">
            Prompts in ChatGPT and Google AI Overviews where your domain or brand appears.
          </p>
        </div>
        {ai?.available ? <Badge tone="accent">{ai.items.length} citations</Badge> : null}
      </header>
      {!state.snapshot ? (
        <p className="seo-card-section__empty">Fetch live data from Overview &amp; quick wins to check AI answer citations.</p>
      ) : !ai?.available ? (
        <p className="seo-card-section__empty">{ai?.note ?? "AI answer citation tracking isn't enabled on this search data account."}</p>
      ) : ai.items.length === 0 ? (
        <p className="seo-card-section__empty">No AI answer citations found for {state.snapshot.domain} yet.</p>
      ) : (
        <div className="seo-table-wrap">
          <table className="seo-table">
            <thead>
              <tr>
                <th scope="col">Prompt</th>
                <th scope="col">Platform</th>
                <th scope="col">Cited page</th>
                <th scope="col">Brand</th>
              </tr>
            </thead>
            <tbody>
              {ai.items.map((item, index) => (
                <tr key={`${item.prompt}-${index}`}>
                  <td className="seo-table__primary">{item.prompt}</td>
                  <td>
                    <Badge tone="neutral">{item.platform}</Badge>
                  </td>
                  <td>
                    {item.entryPath ? (
                      <Link className="g-link" to={`/sites/${siteId}/edit?path=${encodeURIComponent(item.entryPath)}`}>
                        {item.entryTitle ?? item.entryPath}
                      </Link>
                    ) : item.urlPath ? (
                      <span className="g-mono g-faint">{item.urlPath}</span>
                    ) : (
                      <span className="g-faint">—</span>
                    )}
                  </td>
                  <td>
                    <Badge tone={item.mentionedBrand ? "success" : "neutral"}>{item.mentionedBrand ? "Mentioned" : "Source"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
