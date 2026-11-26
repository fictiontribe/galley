import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { PluginList } from "@galley/core/api";
import type { PluginInfo, PluginSource } from "@galley/core/types";
import { useTopBar } from "@/app/chrome";
import { count } from "@/lib/format";
import { useHostedInstall, useMeta } from "@/lib/stores/meta";
import { useSite } from "@/lib/stores/site";
import { useSites } from "@/lib/stores/sites";
import { Button, Count, EmptyState, ErrorState, Icon, Input, PageHeader, Skeleton, TabPanel, Tabs, buttonClass, cx } from "@/ui";
import "./plugins.css";
import { AddPluginDialog, TrustNote } from "./AddPlugin";
import { CreatePluginDialog } from "./CreatePluginDialog";
import { DIRECTORY_PLUGINS } from "./directory";
import { PluginCard } from "./PluginCard";
import { PluginDirectory } from "./PluginDirectory";
import { PluginDrawer } from "./PluginDrawer";
import { usePluginList } from "./usePlugins";
import { missingSettings, sortPlugins, sourceWords } from "./words";

const ORDER: PluginSource[] = ["site", "user", "builtin"];
type InstalledFilter = "all" | "active" | "attention";

function ListSkeleton() {
  return (
    <div className="plg-grid" aria-busy="true" aria-label="Loading plugins">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="plg-card">
          <Skeleton width={160 - index * 16} height={18} />
          <Skeleton lines={2} />
        </div>
      ))}
    </div>
  );
}

/** Problems first, said once at the top, so a broken plugin isn't missed further down. */
function AttentionLine({ list, onInspect }: { list: PluginList; onInspect: (plugin: PluginInfo) => void }) {
  const broken = list.plugins.filter((plugin) => plugin.problems.length > 0);
  if (broken.length === 0) return null;
  return (
    <div className="plg-attention" role="status">
      <span>
        {count(broken.length, "plugin")} {broken.length === 1 ? "isn’t" : "aren’t"} working: {broken.map((plugin) => plugin.displayName).join(", ")}.
      </span>
      <Button size="sm" variant="quiet" onClick={() => onInspect(broken[0]!)}>
        Inspect
      </Button>
    </div>
  );
}

interface InstalledViewProps {
  list: PluginList;
  siteId?: string;
  linkSiteId: string | null;
  onInspect: (plugin: PluginInfo) => void;
  onBrowseDirectory: () => void;
  onCreateWithAi: () => void;
}

function InstalledView({ list, siteId, linkSiteId, onInspect, onBrowseDirectory, onCreateWithAi }: InstalledViewProps) {
  const hosted = useMeta((s) => s.meta?.mode === "hosted");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InstalledFilter>("all");

  const attentionCount = useMemo(
    () => list.plugins.filter((p) => p.problems.length > 0 || (p.enabled && missingSettings(p).length > 0)).length,
    [list.plugins],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return list.plugins.filter((plugin) => {
      if (filter === "active" && !plugin.active) return false;
      if (filter === "attention" && plugin.problems.length === 0 && !(plugin.enabled && missingSettings(plugin).length > 0)) return false;
      if (!needle) return true;
      const hay = `${plugin.displayName} ${plugin.name} ${plugin.description ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [list.plugins, query, filter]);

  const groups = ORDER.map((source) => ({
    source,
    plugins: sortPlugins(filtered.filter((plugin) => plugin.source === source)),
  })).filter((group) => group.plugins.length > 0);

  if (list.plugins.length === 0) {
    return (
      <EmptyState
        title="No plugins installed yet."
        body="Explore the community directory or build a custom plugin with AI."
        actions={
          <>
            <Button variant="secondary" onClick={onBrowseDirectory}>
              Browse directory
            </Button>
            <Button variant="primary" icon="chat" onClick={onCreateWithAi}>
              Create with AI
            </Button>
          </>
        }
      />
    );
  }

  return (
    <div className="plg-installed">
      <AttentionLine list={list} onInspect={onInspect} />

      <div className="plg-toolbar">
        <div className="plg-search">
          <Icon name="search" size={16} className="plg-search__icon" />
          <Input
            type="search"
            value={query}
            placeholder="Filter installed plugins…"
            aria-label="Filter installed plugins"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="plg-pills" role="group" aria-label="Filter by status">
          <button type="button" className={cx("plg-pill", filter === "all" && "plg-pill--active")} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All ({list.plugins.length})
          </button>
          <button type="button" className={cx("plg-pill", filter === "active" && "plg-pill--active")} aria-pressed={filter === "active"} onClick={() => setFilter("active")}>
            Active ({list.plugins.filter((p) => p.active).length})
          </button>
          {attentionCount > 0 ? (
            <button type="button" className={cx("plg-pill", filter === "attention" && "plg-pill--active")} aria-pressed={filter === "attention"} onClick={() => setFilter("attention")}>
              Needs attention ({attentionCount})
            </button>
          ) : null}
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title="No plugins match that filter."
          body="Try clearing your search, or switch to the directory to discover or generate one."
          actions={
            <Button
              variant="secondary"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Reset filter
            </Button>
          }
        />
      ) : (
        <div className="plg-groups">
          {groups.map(({ source, plugins }) => {
            const heading = sourceWords(source, hosted);
            return (
              <section key={source} className="plg-group" aria-label={heading}>
                <h2 className="plg-group__title">
                  {heading}
                  <Count value={plugins.length} quiet label={count(plugins.length, "plugin")} />
                </h2>
                <div className="plg-grid">
                  {plugins.map((plugin) => (
                    <PluginCard key={`${plugin.source}-${plugin.name}`} plugin={plugin} conflicts={list.conflicts} linkSiteId={linkSiteId} siteId={siteId} onInspect={onInspect} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <TrustNote compact />
    </div>
  );
}

interface ScreenContentProps {
  siteId?: string;
  linkSiteId: string | null;
  title: string;
  description: string;
  extraAction?: React.ReactNode;
}

function PluginsContent({ siteId, linkSiteId, title, description, extraAction }: ScreenContentProps) {
  const list = usePluginList(siteId);
  const [tab, setTab] = useState<"installed" | "directory">("installed");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [aiDialog, setAiDialog] = useState<{ open: boolean; idea?: string }>({ open: false });
  const [addDialog, setAddDialog] = useState<{ open: boolean; pkg?: string }>({ open: false });

  const plugins = list.data?.plugins ?? [];
  const conflicts = list.data?.conflicts ?? [];
  const names = useMemo(() => new Map(plugins.map((plugin) => [plugin.name, plugin.displayName])), [plugins]);
  const nameOf = (name: string) => names.get(name) ?? name;
  // Keep drawer synced with live plugin mutations (toggle / settings save).
  const selectedPlugin = useMemo(() => (selectedName ? plugins.find((p) => p.name === selectedName) ?? null : null), [plugins, selectedName]);

  const openAi = (idea?: string) => setAiDialog({ open: true, idea });
  const openAdd = (pkg?: string) => setAddDialog({ open: true, pkg });

  return (
    <div className="app-screen">
      <div className="app-screen__inner plg-screen">
        <PageHeader
          title={title}
          description={description}
          actions={
            <div className="plg-header-actions">
              {extraAction}
              <Button variant="secondary" icon="terminal" onClick={() => openAdd()}>
                Add plugin
              </Button>
              <Button variant="primary" icon="chat" onClick={() => openAi()}>
                Create with AI
              </Button>
            </div>
          }
        />

        <Tabs
          label="Plugins views"
          idBase="plugins"
          value={tab}
          onChange={(next) => setTab(next as "installed" | "directory")}
          items={[
            { id: "installed", label: "Installed", count: list.data ? plugins.length : undefined, quietCount: true },
            { id: "directory", label: "Directory", count: DIRECTORY_PLUGINS.length, quietCount: true },
          ]}
        />

        <TabPanel idBase="plugins" id="installed" value={tab}>
          {list.loading ? (
            <ListSkeleton />
          ) : list.status === "error" && !list.data ? (
            <ErrorState title="Couldn’t load the plugins" error={list.error} onRetry={() => void list.refetch()} />
          ) : list.data ? (
            <InstalledView
              list={list.data}
              siteId={siteId}
              linkSiteId={linkSiteId}
              onInspect={(plugin) => setSelectedName(plugin.name)}
              onBrowseDirectory={() => setTab("directory")}
              onCreateWithAi={() => openAi()}
            />
          ) : null}
        </TabPanel>

        <TabPanel idBase="plugins" id="directory" value={tab}>
          <PluginDirectory
            installed={plugins}
            onConfigureInstalled={(plugin) => setSelectedName(plugin.name)}
            onInstallPackage={(pkg) => openAdd(pkg)}
            onCreateWithAi={(idea) => openAi(idea)}
          />
        </TabPanel>
      </div>

      <PluginDrawer plugin={selectedPlugin} conflicts={conflicts} nameOf={nameOf} linkSiteId={linkSiteId} siteId={siteId} onClose={() => setSelectedName(null)} />
      <CreatePluginDialog open={aiDialog.open} initialIdea={aiDialog.idea} targetSiteId={linkSiteId} onClose={() => setAiDialog({ open: false })} />
      <AddPluginDialog open={addDialog.open} initialName={addDialog.pkg} onClose={() => setAddDialog({ open: false })} />
    </div>
  );
}

/** /plugins — clean plugin management, AI plugin studio, and community directory. */
export function PluginsScreen() {
  useTopBar({ crumbs: [{ label: "Plugins" }] });
  const hosted = useHostedInstall();
  const sites = useSites((s) => s.sites);
  const recent = sites?.find((site) => !site.missing) ?? null;

  return (
    <PluginsContent
      linkSiteId={recent?.id ?? null}
      title="Plugins"
      description={`Extend Galley with image & video models, form destinations, scripts, importers, and AI tools. ${hosted ? "Active for this editor." : "Applies across every site you open here."}`}
    />
  );
}

/** /sites/:siteId/plugins — what is active while this site is open, its own plugins included. */
export function SitePluginsScreen() {
  const { siteId = "" } = useParams();
  const siteName = useSite((s) => s.detail?.name);
  useTopBar({ crumbs: [{ label: "Settings", to: `/sites/${siteId}/settings` }, { label: "Plugins" }] });

  return (
    <PluginsContent
      siteId={siteId}
      linkSiteId={siteId}
      title="Plugins for this site"
      description={`Everything active while ${siteName ?? "this site"} is open, including plugins defined in its repository.`}
      extraAction={
        <Link className={buttonClass("quiet")} to="/plugins">
          All plugins
        </Link>
      }
    />
  );
}
