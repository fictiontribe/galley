/**
 * /sites/:siteId/redirects — the site's redirects: the list (search, filter
 * by problem, edit in place, add one, delete with Undo), "Add many", "Try an
 * address", where they take effect on this site's host (and on Cloudflare
 * itself), and their health. Every change is a pending change for Proof.
 */
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { Redirect, RedirectImportSource } from "@galley/core/redirects-info";
import { useTopBar } from "@/app/chrome";
import { useServerEvent } from "@/lib/events";
import { invalidate } from "@/lib/query";
import { Button, EmptyState, ErrorState, Input, Menu, PageHeader, Select, Skeleton } from "@/ui";
import { AddManyDialog } from "./AddManyDialog";
import { CloudflareDialog } from "./CloudflareDialog";
import { exportUrl, redirectKeys, saveList, useRedirects } from "./data";
import { HealthCard } from "./HealthCard";
import { RedirectEditor, RedirectTable, type Row } from "./RedirectTable";
import { TryAddress } from "./TryAddress";
import { WhereCard } from "./WhereCard";
import { issuesByRow, matchesSearch, problemFilters, redirectsCount } from "./words";
import "./redirects.css";

const EMPTY: Redirect = { from: "", to: "", status: 301, source: "manual" };

export function RedirectsScreen() {
  const { siteId = "" } = useParams();
  const query = useRedirects(siteId);
  const overview = query.data;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [many, setMany] = useState<{ open: boolean; start: RedirectImportSource | null }>({ open: false, start: null });
  const [cloudflare, setCloudflare] = useState(false);

  useTopBar({ crumbs: [{ label: "Redirects" }] });
  // The list or the host's file changed (here, in Proof, by the assistant, outside the app): read it again.
  useServerEvent("changes.updated", (event) => {
    if (event.siteId === siteId) invalidate(redirectKeys.all(siteId));
  });
  useServerEvent("site.updated", (event) => {
    if (event.siteId === siteId) invalidate(redirectKeys.all(siteId));
  });
  useServerEvent("job", (event) => {
    if (event.job.kind === "redirects" && event.job.siteId === siteId && event.job.state !== "running") invalidate(redirectKeys.all(siteId));
  });

  const rows: Row[] = useMemo(() => {
    if (!overview) return [];
    const byRow = issuesByRow(overview.issues);
    const out: Row[] = [];

    overview.redirects.forEach((redirect, index) => {
      if (!matchesSearch(redirect, search)) return;
      if (filter === "problems" && !byRow.has(index)) return;
      if (filter !== "all" && filter !== "problems" && !(byRow.get(index) ?? []).some((issue) => issue.code === filter)) return;
      out.push({ redirect, index });
    });
    return out;
  }, [overview, search, filter]);

  if (query.loading) {
    return (
      <div className="app-screen" aria-busy="true">
        <div className="app-screen__inner app-screen__inner--wide">
          <Skeleton width={220} height={32} />
          <Skeleton lines={8} style={{ marginBlockStart: 24 }} />
        </div>
      </div>
    );
  }
  if (!overview) {
    return (
      <div className="app-screen">
        <div className="app-screen__inner">
          <ErrorState title="Couldn’t load the redirects" error={query.error} onRetry={() => void query.refetch()} />
        </div>
      </div>
    );
  }

  const filters = problemFilters(overview.issues);
  const problemRows = issuesByRow(overview.issues).size;
  const save = (next: Redirect[], undo?: string) => saveList(siteId, overview, next, undo ? { undo: { label: undo, previous: overview.redirects } } : {});
  const remove = (index: number) => {
    const target = overview.redirects[index]!;

    setEditing(null);
    void save(
      overview.redirects.filter((_, at) => at !== index),
      `Removed the redirect from ${target.from}`
    );
  };
  const update = async (index: number, redirect: Redirect) => {
    const ok = await save(overview.redirects.map((current, at) => (at === index ? redirect : current)));

    if (ok) setEditing(null);
    return Boolean(ok);
  };
  const add = async (redirect: Redirect) => {
    const ok = await save([...overview.redirects, redirect], `Added a redirect from ${redirect.from}`);

    if (ok) setAdding(false);
    return Boolean(ok);
  };
  const exportItems = [
    { id: "csv", label: "Spreadsheet (CSV)" },
    { id: "redirects-file", label: "_redirects file" },
    { id: "vercel-json", label: "Vercel (vercel.json)" },
    { id: "cloudflare-csv", label: "Cloudflare Bulk Redirects list" },
    { id: "nginx", label: "nginx configuration" },
    { id: "apache", label: "Apache (.htaccess)" },
  ] as const;

  return (
    <div className="app-screen">
      <div className="app-screen__inner app-screen__inner--wide redir-screen">
        <PageHeader
          title="Redirects"
          description="When a page moves, a redirect sends visitors and search engines from its old address to the new one."
          actions={
            <>
              {overview.redirects.length ? (
                <Menu
                  label="Download"
                  placement="bottom-end"
                  items={exportItems.map((item) => ({ id: item.id, label: item.label, icon: "download" as const, onSelect: () => window.open(exportUrl(siteId, item.id), "_blank", "noopener") }))}
                  trigger={(props) => (
                    <Button variant="secondary" icon="download" {...props}>
                      Download
                    </Button>
                  )}
                />
              ) : null}
              {/* Empty, the empty state carries the one primary action. */}
              {overview.redirects.length ? (
                <Button variant="primary" icon="plus" disabled={Boolean(overview.problem)} onClick={() => setMany({ open: true, start: null })}>
                  Add many
                </Button>
              ) : null}
            </>
          }
        />
        {overview.problem ? <ErrorState compact title="The redirects file can’t be read" message={overview.problem} /> : null}
        <div className="redir-layout">
          <div className="redir-main">
            {overview.redirects.length === 0 && !adding ? (
              <div className="app-card redir-empty">
                <EmptyState
                  title="No redirects yet."
                  body="A redirect sends visitors from an old address to a new one, so old links and search results keep working after a page moves."
                  mark="pilcrow"
                  actions={
                    <>
                      <Button variant="primary" onClick={() => setMany({ open: true, start: null })} disabled={Boolean(overview.problem)}>
                        Add many
                      </Button>
                      <Button variant="secondary" onClick={() => setAdding(true)} disabled={Boolean(overview.problem)}>
                        Add one
                      </Button>
                    </>
                  }
                />
                {overview.imports.length ? (
                  <div className="redir-empty__offers">
                    {overview.imports.map((source) => (
                      <Button key={source.path} variant="quiet" icon="download" onClick={() => setMany({ open: true, start: source })}>
                        {`Bring in ${source.label.replace(/^The /, "the ")} (${source.count.toLocaleString()})`}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <div className="redir-toolbar">
                  <Input size="sm" type="search" value={search} placeholder="Find an address or note" aria-label="Find a redirect" onChange={(event) => setSearch(event.target.value)} />
                  <Select
                    value={filter}
                    onChange={setFilter}
                    aria-label="Show"
                    options={[
                      { value: "all", label: `All (${overview.redirects.length.toLocaleString()})` },
                      ...(problemRows ? [{ value: "problems", label: `With problems (${problemRows.toLocaleString()})` }] : []),
                      ...filters.map((item) => ({ value: item.code, label: `${item.label} (${item.count.toLocaleString()})` })),
                    ]}
                  />
                  <span className="redir-toolbar__count g-faint">{redirectsCount(overview.redirects.length)}</span>
                  <Button size="sm" variant="secondary" icon="plus" onClick={() => (setAdding(true), setEditing(null))} disabled={adding || Boolean(overview.problem)}>
                    Add one
                  </Button>
                </div>
                {adding ? (
                  <div className="app-card redir-adding">
                    <RedirectEditor initial={EMPTY} saveLabel="Add" onCancel={() => setAdding(false)} onSave={add} />
                  </div>
                ) : null}
                {rows.length ? (
                  <RedirectTable rows={rows} issues={overview.issues} total={overview.redirects.length} editing={editing} onEdit={setEditing} onSave={update} onDelete={remove} />
                ) : overview.redirects.length ? (
                  <EmptyState compact title="Nothing matches." body={search ? `No redirect mentions “${search}”.` : "No redirect has that problem."} actions={<Button variant="secondary" size="sm" onClick={() => (setSearch(""), setFilter("all"))}>Show all</Button>} />
                ) : null}
                <p className="redir-order g-hint">Exact addresses come first and wildcards after, the most specific first — the order every host needs. The list keeps it by itself.</p>
              </>
            )}
          </div>
          <aside className="redir-aside" aria-label="Where redirects take effect">
            <WhereCard siteId={siteId} overview={overview} onImport={(path) => setMany({ open: true, start: { path, label: path, count: 0 } })} onCloudflare={() => setCloudflare(true)} />
            <TryAddress siteId={siteId} />
            <HealthCard siteId={siteId} overview={overview} />
          </aside>
        </div>
      </div>
      <AddManyDialog siteId={siteId} open={many.open} start={many.start} overview={overview} onClose={() => setMany({ open: false, start: null })} />
      {overview.cloudflare ? <CloudflareDialog siteId={siteId} open={cloudflare} onClose={() => setCloudflare(false)} overview={overview} /> : null}
    </div>
  );
}
