import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import type { PluginList } from "@galley/core/api";
import type { PluginInfo, PluginSource } from "@galley/core/types";
import { useTopBar } from "@/app/chrome";
import { count } from "@/lib/format";
import { useMeta } from "@/lib/stores/meta";
import { useSite } from "@/lib/stores/site";
import { useSites } from "@/lib/stores/sites";
import { Count, EmptyState, ErrorState, PageHeader, Skeleton, buttonClass } from "@/ui";
import "./plugins.css";
import { AddPlugin, TrustNote } from "./AddPlugin";
import { PluginCard } from "./PluginCard";
import { usePluginList } from "./usePlugins";
import { sortPlugins, sourceWords } from "./words";

const ORDER: PluginSource[] = ["site", "user", "builtin"];

function ListSkeleton() {
  return (
    <div className="plg-list" aria-busy="true" aria-label="Loading plugins">
      {[0, 1, 2].map((index) => (
        <div key={index} className="plg-card">
          <Skeleton width={180 - index * 30} height={18} />
          <Skeleton lines={2} />
        </div>
      ))}
    </div>
  );
}

interface PluginGroupsProps {
  list: PluginList;
  /** For the site view: that site; its own plugins come first and its screens are linked. */
  siteId?: string;
  /** Where site-wide contributions link to on the app view: the most recent site. */
  linkSiteId: string | null;
}

/** The plugins, by where they came from: the site's own, then this computer's, then the app's. */
function PluginGroups({ list, siteId, linkSiteId }: PluginGroupsProps) {
  const hosted = useMeta((s) => s.meta?.mode === "hosted");
  const names = useMemo(() => new Map(list.plugins.map((plugin) => [plugin.name, plugin.displayName])), [list.plugins]);
  const nameOf = (name: string) => names.get(name) ?? name;
  const groups = ORDER.map((source) => ({ source, plugins: sortPlugins(list.plugins.filter((plugin) => plugin.source === source)) }));

  return (
    <div className="plg-groups">
      {groups.map(({ source, plugins }) => {
        if (source === "site" && !siteId) return null;
        const heading = sourceWords(source, hosted);
        return (
          <section key={source} className="plg-group" aria-label={heading}>
            <h2 className="plg-group__title">
              {heading}
              {plugins.length ? <Count value={plugins.length} quiet label={count(plugins.length, "plugin")} /> : null}
            </h2>
            {plugins.length === 0 ? (
              <p className="plg-group__empty">
                {source === "site"
                  ? "This site doesn’t name any plugins. A developer can add some to the site’s settings file; they load for this site only."
                  : hosted
                    ? "Nothing has been added on this server yet. Plugins added with the command below show up here."
                    : "Nothing has been added on this computer yet. Plugins added with the command below show up here."}
              </p>
            ) : (
              <div className="plg-list">
                {plugins.map((plugin: PluginInfo) => (
                  <PluginCard key={`${plugin.source}-${plugin.name}`} plugin={plugin} conflicts={list.conflicts} nameOf={nameOf} linkSiteId={linkSiteId} siteId={siteId} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Problems first, said once at the top, so a broken plugin isn't missed further down. */
function AttentionLine({ list }: { list: PluginList }) {
  const broken = list.plugins.filter((plugin) => plugin.problems.length > 0);
  if (broken.length === 0) return null;
  return (
    <p className="plg-attention" role="status">
      {count(broken.length, "plugin")} {broken.length === 1 ? "isn’t" : "aren’t"} working: {broken.map((plugin) => plugin.displayName).join(", ")}. {broken.length === 1 ? "Its note says" : "Their notes say"} why.
    </p>
  );
}

function Body({ siteId, linkSiteId }: { siteId?: string; linkSiteId: string | null }) {
  const list = usePluginList(siteId);
  if (list.loading) return <ListSkeleton />;
  if (list.status === "error" && !list.data) return <ErrorState title="Couldn’t load the plugins" error={list.error} onRetry={() => void list.refetch()} />;
  if (!list.data) return null;
  if (list.data.plugins.length === 0) {
    return <EmptyState title="No plugins here." body="This server doesn’t offer plugins, so nothing beyond the app’s own parts is in use." />;
  }
  return (
    <>
      <AttentionLine list={list.data} />
      <PluginGroups list={list.data} siteId={siteId} linkSiteId={linkSiteId} />
    </>
  );
}

/** /plugins — what every plugin adds to the app, its switch, settings and problems; how to add one. */
export function PluginsScreen() {
  useTopBar({ crumbs: [{ label: "Plugins" }] });
  const sites = useSites((s) => s.sites);
  // Forms, scripts and the assistant live inside a site: link to the one opened last.
  const recent = sites?.find((site) => !site.missing) ?? null;
  return (
    <div className="app-screen">
      <div className="app-screen__inner plg-screen">
        <PageHeader title="Plugins" description="What plugins add to this app — image and video generators, form destinations, scripts, importers and tools for the assistant. They apply to every site you open here." />
        <TrustNote />
        <Body linkSiteId={recent?.id ?? null} />
        <AddPlugin />
      </div>
    </div>
  );
}

/** /sites/:siteId/plugins — what is active while this site is open, its own plugins included. */
export function SitePluginsScreen() {
  const { siteId = "" } = useParams();
  const siteName = useSite((s) => s.detail?.name);
  useTopBar({ crumbs: [{ label: "Settings", to: `/sites/${siteId}/settings` }, { label: "Plugins" }] });
  return (
    <div className="app-screen">
      <div className="app-screen__inner plg-screen">
        <PageHeader
          title="Plugins for this site"
          description={`Everything active while ${siteName ?? "this site"} is open: what’s added to the app, and the plugins the site itself names.`}
          actions={
            <Link className={buttonClass("secondary")} to="/plugins">
              All plugins
            </Link>
          }
        />
        <TrustNote />
        <Body siteId={siteId} linkSiteId={siteId} />
      </div>
    </div>
  );
}
