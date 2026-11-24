import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { ReactNode } from "react";
import { collectionForPath, collectionIcon, visibleCollections } from "@/lib/collections";
import { usePendingCount } from "@/lib/stores/changes";
import { useHostedInstall, useInstallSiteId, useMeta } from "@/lib/stores/meta";
import { useSite } from "@/lib/stores/site";
import { useSites } from "@/lib/stores/sites";
import { useUi } from "@/lib/stores/ui";
import { collectionNouns, count } from "@/lib/format";
import { Count, Icon, IconButton, Kbd, Logo, Menu, Skeleton, type IconName, type MenuItem } from "@/ui";
import { isKitFile } from "@/features/forms/logic/locate";
import { InboxNavBadge } from "@/features/inbox/InboxNavBadge";
import { SiteSwitcherButton } from "@/features/sites/SiteSwitcherButton";
import { useSiteSession } from "@/features/sites/session";
import { useTwinLine } from "@/features/sites/store";
import { useChrome } from "./chrome";

interface NavItemProps {
  to: string;
  icon: IconName;
  label: string;
  end?: boolean;
  /** Force the current-page state (e.g. the collection of the entry being edited). */
  current?: boolean;
  trailing?: ReactNode;
}

function NavItem({ to, icon, label, end, current, trailing }: NavItemProps) {
  const content = (
    <>
      <Icon name={icon} />
      <span className="app-nav__text">{label}</span>
      {trailing}
    </>
  );
  // NavLink only marks itself current on a URL match; the editor marks its
  // entry's collection current from the ?path= instead.
  return current ? (
    <Link to={to} className="g-nav__item app-nav__item" aria-current="page" title={label}>
      {content}
    </Link>
  ) : (
    <NavLink to={to} end={end} className="g-nav__item app-nav__item" title={label}>
      {content}
    </NavLink>
  );
}

function NavLabel({ children }: { children: string }) {
  return <span className="g-eyebrow g-nav__label app-nav__label">{children}</span>;
}

function SearchButton() {
  const open = useChrome((s) => s.setPaletteOpen);
  return (
    <button type="button" className="g-nav__item app-nav__item app-nav__search" onClick={() => open(true)} title="Search and jump">
      <Icon name="search" />
      <span className="app-nav__text">Search</span>
      <Kbd keys={["mod", "K"]} className="app-nav__meta-kbd" />
    </button>
  );
}

function CollapseButton() {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggle = useUi((s) => s.toggleSidebar);
  return (
    <IconButton
      className="app-sidebar__collapse"
      icon="panel-left"
      label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      onClick={toggle}
      tooltipSide="right"
    />
  );
}

/** A recent site; when another site has the same name, the folder that tells them apart follows it, quietly. */
function RecentSite({ id, name }: { id: string; name: string }) {
  const twin = useTwinLine(id);
  return <NavItem to={`/sites/${id}`} icon="folder-site" label={name} trailing={twin ? <span className="app-nav__twin">{twin}</span> : undefined} />;
}

/**
 * A hosted install's sidebar outside the site (App settings, Plugins, the
 * Install page): the way back to its one site, and nothing about others.
 */
function HostedHomeSidebar() {
  const brand = useMeta((s) => s.meta?.brand);
  const siteId = useInstallSiteId();
  const site = useSites((s) => s.sites?.find((candidate) => candidate.id === siteId) ?? s.sites?.[0] ?? null);
  return (
    <nav className="g-sidebar app-sidebar" aria-label="App">
      <Link to="/" className="g-brand app-brand" aria-label={`${brand?.productName ?? ""} — the site`}>
        <Logo />
        <span className="g-brand__name app-nav__text">{brand?.productName}</span>
      </Link>
      <div className="g-nav">
        {site ? <NavItem to={`/sites/${site.id}`} icon="folder-site" label={site.name} /> : null}
        <NavItem to="/install" icon="folder" label="Install" />
        <NavItem to="/settings" icon="settings" label="App settings" />
        <NavItem to="/plugins" icon="plugin" label="Plugins" />
      </div>
      <div className="app-sidebar__foot">
        {brand?.byline ? <span className="app-sidebar__byline app-nav__text">{brand.byline}</span> : null}
        <CollapseButton />
      </div>
    </nav>
  );
}

/** Sidebar outside a site: the product, Sites, New site, App settings, recent sites. */
export function HomeSidebar() {
  const hosted = useHostedInstall();
  return hosted ? <HostedHomeSidebar /> : <MultiSiteHomeSidebar />;
}

function MultiSiteHomeSidebar() {
  const brand = useMeta((s) => s.meta?.brand);
  const sites = useSites((s) => s.sites);
  return (
    <nav className="g-sidebar app-sidebar" aria-label="App">
      <NavLink to="/" className="g-brand app-brand" aria-label={`${brand?.productName ?? ""} — Sites`}>
        <Logo />
        <span className="g-brand__name app-nav__text">{brand?.productName}</span>
      </NavLink>
      <div className="g-nav">
        <NavItem to="/" end icon="sites" label="Sites" />
        <NavItem to="/new" icon="plus" label="New site" />
        <NavItem to="/settings" icon="settings" label="App settings" />
        <NavItem to="/plugins" icon="plugin" label="Plugins" />
        {sites && sites.length > 0 ? (
          <>
            <NavLabel>Recent</NavLabel>
            {sites.slice(0, 6).map((site) => (
              <RecentSite key={site.id} id={site.id} name={site.name} />
            ))}
          </>
        ) : null}
      </div>
      <div className="app-sidebar__foot">
        {brand?.byline ? <span className="app-sidebar__byline app-nav__text">{brand.byline}</span> : null}
        <CollapseButton />
      </div>
    </nav>
  );
}

/**
 * The top of a hosted install's site sidebar: the site's name, going to its
 * home — there is no other site to switch to. It carries the site's session
 * (place memory, presence, waking a paused preview) as the switcher does.
 */
function SiteHeader({ siteId }: { siteId: string }) {
  const detail = useSite((s) => s.detail);
  useSiteSession(siteId);
  return (
    <Link to={`/sites/${siteId}`} className="g-brand app-brand" aria-label={`${detail?.name ?? "This site"} — site home`}>
      <Logo />
      <span className="g-brand__name app-nav__text">{detail?.name ?? <Skeleton width={110} height={14} />}</span>
    </Link>
  );
}

/** The quick switcher (type to find a site, pinned and recent first, attention chips) — features/sites. */
function SiteSwitcher({ siteId }: { siteId: string }) {
  const hosted = useHostedInstall();
  return hosted ? <SiteHeader siteId={siteId} /> : <SiteSwitcherButton />;
}

/** Sidebar inside a site, per the specimen: site, Proof, CONTENT collections, Media, SITE history + settings. */
export function SiteSidebar({ siteId }: { siteId: string }) {
  const detail = useSite((s) => s.detail);
  const pending = usePendingCount();
  const location = useLocation();
  const [params] = useSearchParams();
  const editingPath = location.pathname.endsWith("/edit") ? params.get("path") : null;
  const editingCollection = editingPath ? collectionForPath(detail?.model, editingPath) : null;
  const base = `/sites/${siteId}`;
  const hosted = useHostedInstall();

  return (
    <nav className="g-sidebar app-sidebar" aria-label="Site">
      <SiteSwitcher siteId={siteId} />
      <div className="g-nav">
        <SearchButton />
        <NavItem to={base} end icon="home" label="Site home" />
        <NavItem
          to={`${base}/proof`}
          icon="proof"
          label="Proof"
          trailing={
            pending > 0 ? (
              <span className="app-nav__count">
                <Count value={pending} label={count(pending, "unpublished change")} />
              </span>
            ) : null
          }
        />
        <NavLabel>Content</NavLabel>
        {detail
          ? visibleCollections(detail.model)
              .filter((collection) => !isKitFile(collection))
              .map((collection) => (
              <NavItem
                key={collection.id}
                to={`${base}/c/${encodeURIComponent(collection.id)}`}
                icon={collectionIcon(collection)}
                label={collection.label}
                current={editingCollection?.id === collection.id}
                trailing={
                  collection.kind === "entries" ? (
                    <span className="g-nav__meta app-nav__text" aria-label={count(collection.count, collection.singular, collectionNouns(collection).many)}>
                      {collection.count.toLocaleString()}
                    </span>
                  ) : null
                }
              />
            ))
          : [0, 1, 2].map((index) => (
              <span key={index} className="g-nav__item app-nav__item" aria-hidden="true">
                <Skeleton width={16} height={16} />
                <Skeleton width={90 - index * 14} height={12} className="app-nav__text" />
              </span>
            ))}
        <NavItem to={`${base}/media`} icon="image" label="Media" />
        <NavLabel>Site</NavLabel>
        <NavItem to={`${base}/forms`} icon="posts" label="Forms" />
        <NavItem to={`${base}/inbox`} icon="inbox" label="Inbox" trailing={<InboxNavBadge siteId={siteId} />} />
        <NavItem to={`${base}/scripts`} icon="data" label="Scripts" />
        <NavItem to={`${base}/brand`} icon="registration" label="Brand" />
        <NavItem to={`${base}/visibility`} icon="globe" label="Search & AI" />
        <NavItem to={`${base}/history`} icon="history" label="Version history" />
        <NavItem to={`${base}/online`} icon="globe" label="Online" />
        <NavItem to={`${base}/redirects`} icon="link" label="Redirects" />
        <NavItem to={`${base}/settings`} icon="settings" label="Settings" />
        {hosted ? (
          <>
            <NavLabel>Editor</NavLabel>
            <NavItem to="/install" icon="folder" label="Install" />
            <NavItem to="/settings" icon="settings" label="App settings" />
          </>
        ) : null}
      </div>
      <div className="app-sidebar__foot">
        <CollapseButton />
      </div>
    </nav>
  );
}
