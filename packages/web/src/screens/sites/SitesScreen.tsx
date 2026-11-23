import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { SiteGroup, SiteSummary } from "@galley/core/types";
import { useTopBar } from "@/app/chrome";
import { api, errorShape } from "@/lib/api";
import { pickFolderNatively } from "@/lib/desktop";
import { useServerEvent } from "@/lib/events";
import { useQuery } from "@/lib/query";
import { useMeta } from "@/lib/stores/meta";
import { usePreview } from "@/lib/stores/preview";
import { useSites } from "@/lib/stores/sites";
import { notify } from "@/lib/stores/toasts";
import { Button, ConfirmDialog, EmptyState, ErrorState, Icon, Input, Menu, PageHeader, ProofMark, SegmentedControl, Select, Skeleton, cx, type IconName } from "@/ui";
import { AddFromFolderDialog, addedMessage } from "@/features/sites/AddFromFolderDialog";
import { fileSite } from "@/features/sites/actions";
import { DetailsDialog, GroupDialog, MoveDialog, NoteDialog } from "@/features/sites/dialogs";
import { NO_FILTER, counted, filterSites, frameworksOf, groupSites, isFiltered, needsAttention, type SiteFilter } from "@/features/sites/logic";
import { Glyph } from "@/features/sites/parts";
import { useGroups, useSitesView } from "@/features/sites/store";
import { CloneDialog } from "./CloneDialog";
import { FolderBrowserDialog } from "./FolderBrowserDialog";
import { GroupSection, type SiteMenuActions } from "./SiteViews";

function CardsSkeleton() {
  return (
    <div className="sites-grid" aria-busy="true" aria-label="Loading sites">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="sites-card" aria-hidden="true">
          <div className="sites-card__media">
            <Skeleton height="100%" />
          </div>
          <div className="sites-card__body">
            <Skeleton width={170 - index * 20} height={20} />
            <Skeleton width="60%" height={12} />
            <Skeleton width={110} height={20} pill />
          </div>
        </div>
      ))}
    </div>
  );
}

interface Way {
  icon: IconName;
  title: string;
  body: string;
  action: string;
  run: () => void;
  primary?: boolean;
}

/** First run, for someone who looks after several sites: what this is, and the ways in — the folder of sites first. */
function FirstRun({ ways }: { ways: Way[] }) {
  const productName = useMeta((s) => s.meta?.brand.productName ?? "");
  return (
    <section className="app-firstrun" aria-labelledby="firstrun-title">
      <div className="g-sheet g-crop app-firstrun__sheet">
        <div className="app-firstrun__text">
          <p className="g-eyebrow">{productName}</p>
          <h1 className="app-firstrun__title" id="firstrun-title">
            Add the sites you look after, <ins className="g-ins g-ink-in"><span className="g-sr">Added: </span>see what each one is waiting on</ins>, then publish.
          </h1>
          <p className="app-firstrun__body">
            Point this app at the folder your sites live in and they’re listed in one go — or open, clone or create them one at a time. Each site stays in its own folder, and nothing changes until you publish.
          </p>
        </div>
        <aside className="app-firstrun__margin" aria-label="How it works">
          <p className="g-margin-note">
            <ProofMark kind="caret" tone="insert" />
            <span>Group them by client</span>
          </p>
          <p className="g-margin-note">
            <ProofMark kind="transpose" tone="change" />
            <span>See what’s waiting</span>
          </p>
          <p className="g-margin-note">
            <ProofMark kind="reg" />
            <span>Publish each one</span>
          </p>
        </aside>
      </div>
      <h2 className="g-eyebrow app-firstrun__ways-label">Ways in</h2>
      <ol className="app-ways sites-ways">
        {ways.map((way, index) => (
          <li key={way.title} className="app-way">
            <span className="app-way__number" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <Icon name={way.icon} className="app-way__icon" />
            <h3 className="app-way__title">{way.title}</h3>
            <p className="app-way__body">{way.body}</p>
            <Button variant={way.primary ? "primary" : "secondary"} onClick={way.run}>
              {way.action}
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function usageBySite() {
  return api("GET /api/usage/sites");
}

/**
 * `/` — the home of someone who looks after many sites: every site at a
 * glance, filed by group, ordered by what needs attention, searchable and
 * filterable; and the ways to add more (a folder of them at once, one
 * folder, a clone, a new site).
 */
export function SitesScreen() {
  useTopBar({ crumbs: [{ label: "Sites" }] });
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const desktop = useMeta((s) => s.meta?.desktop ?? false);
  const { sites, status, error, load, forget } = useSites();
  const groups = useGroups((s) => s.groups);
  const loadGroups = useGroups((s) => s.load);
  const view = useSitesView((s) => s.view);
  const setView = useSitesView((s) => s.setView);
  const leave = useSitesView((s) => s.leave);
  const [filter, setFilter] = useState<SiteFilter>(() => ({ ...NO_FILTER, attention: params.get("attention") === "1" }));
  const [browsing, setBrowsing] = useState<"site" | "parent" | null>(null);
  const [scanPath, setScanPath] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);
  const [removing, setRemoving] = useState<SiteSummary | null>(null);
  const [removingGroup, setRemovingGroup] = useState<SiteGroup | null>(null);
  const [editingGroup, setEditingGroup] = useState<SiteGroup | "new" | null>(null);
  const [moving, setMoving] = useState<SiteSummary | null>(null);
  const [noting, setNoting] = useState<SiteSummary | null>(null);
  const [details, setDetails] = useState<SiteSummary | null>(null);
  const [dragging, setDragging] = useState(false);
  const usage = useQuery(["usage", "sites"], usageBySite);

  useEffect(() => {
    leave();
    void loadGroups();
  }, [leave, loadGroups]);
  useServerEvent("sites.updated", () => void loadGroups());

  // The attention indicator links here with ?attention=1.
  useEffect(() => {
    if (params.get("attention") === "1") setFilter((current) => ({ ...current, attention: true }));
  }, [params]);

  const openPath = useCallback(
    async (path: string) => {
      const site = await api("POST /api/sites/open", { body: { path } });
      setBrowsing(null);
      void load();
      navigate(`/sites/${site.id}`);
    },
    [load, navigate],
  );

  const openFolder = useCallback(async () => {
    if (desktop) {
      const picked = await pickFolderNatively();
      if (picked === null) return;
      if (picked !== undefined) {
        try {
          await openPath(picked);
        } catch (caught) {
          notify({ tone: "danger", title: "Couldn’t open that folder", body: errorShape(caught).message, detail: errorShape(caught).detail });
        }
        return;
      }
    }
    setBrowsing("site");
  }, [desktop, openPath]);

  const addFromFolder = useCallback(async () => {
    if (desktop) {
      const picked = await pickFolderNatively();
      if (picked === null) return;
      if (picked !== undefined) {
        setScanPath(picked);
        return;
      }
    }
    setBrowsing("parent");
  }, [desktop]);

  useEffect(() => {
    const open = params.get("open");
    if (open !== "folder" && open !== "sites") return;
    setParams({}, { replace: true });
    void (open === "sites" ? addFromFolder() : openFolder());
  }, [params, setParams, openFolder, addFromFolder]);

  useEffect(() => {
    const end = () => setDragging(false);
    const start = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("application/x-site-id")) setDragging(true);
    };
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => {
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
    };
  }, []);

  const ways: Way[] = [
    { icon: "sites", title: "Add sites from a folder", body: "Choose the folder that holds your clients’ sites. Every site in it is listed, ready to add in one go.", action: "Add sites from a folder", run: () => void addFromFolder(), primary: true },
    { icon: "folder", title: "Open a folder", body: "One site already on this computer. Its pages are found for you.", action: "Open a folder", run: () => void openFolder() },
    { icon: "clone", title: "Clone a site", body: "Copy a site from GitHub or another code host, then edit it here.", action: "Clone a site", run: () => setCloning(true) },
    { icon: "plus", title: "Create a new site", body: "Describe it in a few lines; a starter is set up and the assistant builds it.", action: "Create a site", run: () => navigate("/new") },
  ];

  const previews = usePreview((s) => s.bySite);
  // Preview states arrive as events; the list itself is only refetched when a site changes.
  const list = useMemo(() => (sites ?? []).map((site) => (previews[site.id] ? { ...site, previewState: previews[site.id]!.state } : site)), [sites, previews]);
  const groupList = useMemo(() => groups ?? [], [groups]);
  const visible = useMemo(() => filterSites(list, filter, groupList), [list, filter, groupList]);
  // A single group chosen: show just that section; otherwise every group (empty ones too, to drop onto).
  const sections = useMemo(() => {
    const all = groupSites(visible, groupList);
    if (filter.group !== "all") return all.filter((section) => (filter.group === "none" ? section.group === null : section.group?.id === filter.group));
    return isFiltered(filter) ? all.filter((section) => section.sites.length > 0) : all;
  }, [visible, groupList, filter]);
  const attention = list.filter(needsAttention).length;
  const frameworks = frameworksOf(list);
  const usageFor = (siteId: string) => usage.data?.sites.find((entry) => entry.siteId === siteId);

  const actions: SiteMenuActions = {
    move: setMoving,
    note: setNoting,
    details: setDetails,
    remove: setRemoving,
    findFolder: () => void openFolder(),
    go: (to) => navigate(to),
  };
  const groupActions = {
    rename: (group: SiteGroup) => setEditingGroup(group),
    remove: (group: SiteGroup) => setRemovingGroup(group),
    toggle: (group: SiteGroup) => {
      useGroups.getState().put({ ...group, collapsed: !group.collapsed });
      void api("PATCH /api/groups/:groupId", { params: { groupId: group.id }, body: { collapsed: !group.collapsed } }).catch(() => void loadGroups());
    },
    drop: (siteId: string, group: SiteGroup | null) => {
      const site = list.find((candidate) => candidate.id === siteId);
      if (!site || (site.group ?? null) === (group?.id ?? null)) return;
      void fileSite(site, { group: group?.id ?? null }).then((saved) => {
        if (saved) notify({ tone: "neutral", title: group ? `Moved ${site.name} to ${group.name}` : `${site.name} is in no group now` });
      });
    },
  };

  let body;
  if (status === "error" && !sites) {
    body = <ErrorState title="Couldn’t load your sites" error={error} onRetry={() => void load()} />;
  } else if (!sites) {
    body = <CardsSkeleton />;
  } else if (sites.length === 0) {
    body = <FirstRun ways={ways} />;
  } else {
    body = (
      <>
        <PageHeader
          eyebrow={`${counted(list.length, "site")}${groupList.length ? ` · ${counted(groupList.length, "group")}` : ""}`}
          title="Your sites"
          description={attention > 0 ? `${counted(attention, "site")} ${attention === 1 ? "has" : "have"} something waiting.` : "Nothing is waiting on any site."}
          actions={
            <>
              <Button variant="quiet" icon="plus" onClick={() => setEditingGroup("new")}>
                New group
              </Button>
              <Menu
                label="Add sites"
                placement="bottom-end"
                items={[
                  { id: "folder-of-sites", label: "Add sites from a folder…", icon: "sites", onSelect: () => void addFromFolder() },
                  { id: "folder", label: "Open one folder…", icon: "folder", onSelect: () => void openFolder() },
                  { id: "clone", label: "Clone a site…", icon: "clone", onSelect: () => setCloning(true) },
                  { id: "new", label: "Create a new site…", icon: "plus", onSelect: () => navigate("/new") },
                ]}
                trigger={(props) => (
                  <button type="button" className="g-btn g-btn--primary" {...props}>
                    <Icon name="plus" />
                    Add sites
                    <Icon name="chevron-down" />
                  </button>
                )}
              />
            </>
          }
        />
        <div className="sites-toolbar" role="search">
          <label className="sites-search">
            <Icon name="search" />
            <span className="g-sr">Search sites</span>
            <Input
              size="sm"
              type="search"
              value={filter.query}
              placeholder="Search by name, client, note or address"
              onChange={(event) => setFilter({ ...filter, query: event.target.value })}
            />
          </label>
          {groupList.length > 0 ? (
            <Select
              aria-label="Group"
              value={filter.group}
              onChange={(group) => setFilter({ ...filter, group })}
              options={[{ value: "all", label: "Every group" }, ...groupList.map((group) => ({ value: group.id, label: group.name })), { value: "none", label: "Not in a group" }]}
            />
          ) : null}
          {frameworks.length > 1 ? (
            <Select
              aria-label="Kind of site"
              value={filter.framework}
              onChange={(framework) => setFilter({ ...filter, framework })}
              options={[{ value: "all", label: "Every kind" }, ...frameworks.map((entry) => ({ value: entry.id, label: `${entry.name} (${entry.count})` }))]}
            />
          ) : null}
          <button type="button" className={cx("g-chip sites-attention-chip", filter.attention && "sites-attention-chip--on")} aria-pressed={filter.attention} onClick={() => setFilter({ ...filter, attention: !filter.attention })}>
            <ProofMark kind="bang" />
            Needs attention{attention ? ` · ${attention}` : ""}
          </button>
          {isFiltered(filter) ? (
            <Button size="sm" variant="quiet" onClick={() => setFilter(NO_FILTER)}>
              Clear
            </Button>
          ) : null}
          <span className="g-toolbar__spacer" />
          <SegmentedControl
            label="Show sites as"
            value={view}
            onChange={setView}
            options={[
              { value: "cards", label: <Glyph name="cards" />, title: "Cards" },
              { value: "list", label: <Glyph name="rows" />, title: "List" },
            ]}
          />
        </div>
        {visible.length === 0 ? (
          <EmptyState
            compact
            title={filter.attention && !filter.query ? "Nothing needs attention." : "No sites match."}
            body={filter.attention && !filter.query ? "Every site is published and up to date." : "Try a shorter word, or clear the filters."}
            actions={
              <Button variant="secondary" onClick={() => setFilter(NO_FILTER)}>
                Show every site
              </Button>
            }
          />
        ) : (
          <div className={cx("sites-sections", `sites-sections--${view}`, dragging && "sites-sections--dragging")}>
            {sections.map((section) => (
              <GroupSection key={section.group?.id ?? "none"} section={section} view={view} actions={actions} groupActions={groupActions} dragging={dragging} />
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="app-screen sites-screen">
      <div className="app-screen__inner app-screen__inner--wide">{body}</div>
      <FolderBrowserDialog
        open={browsing !== null}
        purpose={browsing ?? "site"}
        onClose={() => setBrowsing(null)}
        onOpen={async (path) => {
          if (browsing === "parent") {
            setBrowsing(null);
            setScanPath(path);
            return;
          }
          await openPath(path);
        }}
      />
      <AddFromFolderDialog
        path={scanPath}
        groups={groupList}
        onClose={() => setScanPath(null)}
        onChooseAnother={() => {
          setScanPath(null);
          void addFromFolder();
        }}
        onAdded={(result) => {
          setScanPath(null);
          void load();
          notify({ tone: result.added.length ? "success" : "neutral", ...addedMessage(result) });
        }}
      />
      <CloneDialog open={cloning} onClose={() => setCloning(false)} />
      <GroupDialog open={editingGroup !== null} group={editingGroup === "new" ? null : editingGroup} onClose={() => setEditingGroup(null)} />
      <MoveDialog site={moving} groups={groupList} onClose={() => setMoving(null)} onNewGroup={() => setEditingGroup("new")} />
      <NoteDialog site={noting} onClose={() => setNoting(null)} />
      <DetailsDialog site={details} group={groupList.find((group) => group.id === details?.group)} usage={details ? usageFor(details.id) : undefined} onClose={() => setDetails(null)} />
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.name ?? "this site"} from this app?`}
        body="It leaves this list. Its folder and files stay exactly where they are, and you can add it again any time. Any key or author kept for this site alone is forgotten."
        confirmLabel="Remove site"
        busyLabel="Removing…"
        cancelLabel="Keep it"
        errorTitle="Couldn’t remove the site"
        onConfirm={async () => {
          if (!removing) return;
          await forget(removing.id);
          notify({ tone: "neutral", title: `Removed ${removing.name}`, body: "Its files are still on disk." });
        }}
      />
      <ConfirmDialog
        open={Boolean(removingGroup)}
        onClose={() => setRemovingGroup(null)}
        title={`Remove the group ${removingGroup?.name ?? ""}?`}
        body="Its sites stay in your list, in no group. Nothing in their folders changes."
        confirmLabel="Remove group"
        busyLabel="Removing…"
        cancelLabel="Keep it"
        errorTitle="Couldn’t remove the group"
        onConfirm={async () => {
          if (!removingGroup) return;
          await api("DELETE /api/groups/:groupId", { params: { groupId: removingGroup.id } });
          await Promise.all([loadGroups(), load()]);
        }}
      />
    </div>
  );
}
