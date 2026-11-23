import { useState, type DragEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { SiteGroup, SiteSummary } from "@galley/core/types";
import { relativeTime } from "@/lib/format";
import { useMeta } from "@/lib/stores/meta";
import { usePreview } from "@/lib/stores/preview";
import { Icon, Menu, Tag, cx, type MenuItem } from "@/ui";
import { fileSite, inDesktop, openInNewWindow, revealInFinder, siteTarget } from "@/features/sites/actions";
import { counted, needsAttention, type SiteSection } from "@/features/sites/logic";
import { AttentionChips, Glyph, GroupDot, SiteThumb, hostOf } from "@/features/sites/parts";
import { useTwinLine } from "@/features/sites/store";

/** What a site's menu asks the screen to do (the dialogs live on the screen). */
export interface SiteMenuActions {
  move: (site: SiteSummary) => void;
  note: (site: SiteSummary) => void;
  details: (site: SiteSummary) => void;
  remove: (site: SiteSummary) => void;
  findFolder: () => void;
  /** Go to a screen of the app. */
  go: (to: string) => void;
}

const DRAG_TYPE = "application/x-site-id";

function revealLabel(platform: string): string {
  if (platform === "darwin") return "Show in Finder";
  if (platform === "win32") return "Show in File Explorer";
  return "Show the folder";
}

function SiteMenu({ site, actions }: { site: SiteSummary; actions: SiteMenuActions }) {
  const platform = useMeta((s) => s.meta?.platform ?? "");
  const runPreview = usePreview((s) => s.run);
  const previewState = usePreview((s) => s.bySite[site.id]?.state) ?? site.previewState;
  const running = previewState === "ready" || previewState === "starting" || previewState === "installing";
  const desktop = inDesktop();
  const items: MenuItem[] = site.missing
    ? [
        { id: "find", label: "Find the folder…", icon: "folder", onSelect: actions.findFolder },
        { kind: "separator", id: "s0" },
        { id: "remove", label: "Remove from this app…", icon: "trash", tone: "danger", onSelect: () => actions.remove(site) },
      ]
    : [
        { id: "window", label: desktop ? "Open in a new window" : "Open in a new tab", icon: "external", onSelect: () => openInNewWindow(site.id) },
        ...(site.pendingChanges > 0 ? [{ id: "proof", label: "Proof the changes", icon: "proof" as const, onSelect: () => actions.go(`/sites/${encodeURIComponent(site.id)}/proof`) }] : []),
        running
          ? { id: "stop", label: "Stop the preview", icon: "stop", onSelect: () => void runPreview(site.id, "stop").catch(() => undefined) }
          : { id: "start", label: "Start the preview", icon: "play", onSelect: () => void runPreview(site.id, "start").catch(() => undefined) },
        ...(desktop ? [{ id: "reveal", label: revealLabel(platform), icon: "folder" as const, onSelect: () => void revealInFinder(site) }] : []),
        { kind: "separator", id: "s1" },
        { id: "pin", label: site.pinned ? "Unpin" : "Pin to the top", icon: "check", onSelect: () => void fileSite(site, { pinned: !site.pinned }) },
        { id: "move", label: "Move to group…", icon: "sites", onSelect: () => actions.move(site) },
        { id: "note", label: site.note ? "Edit the note…" : "Add a note…", icon: "posts", onSelect: () => actions.note(site) },
        { id: "details", label: "Details…", icon: "data", onSelect: () => actions.details(site) },
        { kind: "separator", id: "s2" },
        { id: "remove", label: "Remove from this app…", icon: "trash", tone: "danger", onSelect: () => actions.remove(site) },
      ];
  return (
    <Menu
      label={`${site.name} options`}
      placement="bottom-end"
      items={items}
      trigger={(props) => (
        <button type="button" className="g-btn g-btn--quiet g-btn--sm g-btn--icon sites-menu" aria-label={`${site.name} options`} {...props}>
          <Icon name="more" />
        </button>
      )}
    />
  );
}

function dragProps(site: SiteSummary) {
  return {
    draggable: !site.missing,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData(DRAG_TYPE, site.id);
      event.dataTransfer.effectAllowed = "move";
    },
  };
}

function SiteName({ site }: { site: SiteSummary }) {
  return site.missing ? (
    <span>{site.name}</span>
  ) : (
    <Link
      to={siteTarget(site.id)}
      className="sites-card__link"
      onClick={(event) => {
        // ⌘/Ctrl-click: a window (desktop) or tab of its own, like any link.
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          openInNewWindow(site.id);
        }
      }}
    >
      {site.name}
    </Link>
  );
}

/** Only when another site has the same name: the folder it lives in (and its group), so the two can be told apart. */
function TwinLine({ site, className }: { site: SiteSummary; className: string }) {
  const twin = useTwinLine(site.id);
  if (!twin) return null;
  return (
    <span className={className} title={site.root}>
      {twin}
    </span>
  );
}

function LiveLine({ site }: { site: SiteSummary }) {
  const host = hostOf(site.facts?.liveUrl);
  if (site.missing) return <span className="sites-live sites-live--none">The folder was moved or renamed</span>;
  if (!host) return <span className="sites-live sites-live--none">No live address yet</span>;
  const behind = site.facts?.notLive ?? null;
  return (
    <span className="sites-live" title={site.facts?.liveUrl}>
      <Icon name="globe" />
      <span className="sites-live__host">{host}</span>
      {behind === 0 ? <span className="sites-live__state">current</span> : behind && behind > 0 ? <span className="sites-live__state sites-live__state--behind">behind</span> : null}
    </span>
  );
}

function opened(site: SiteSummary): string {
  return site.lastOpenedAt > 0 ? `Opened ${relativeTime(site.lastOpenedAt)}` : "Not opened yet";
}

export function SiteCard({ site, group, actions }: { site: SiteSummary; group: SiteGroup | undefined; actions: SiteMenuActions }) {
  // The kind of site, not its exact version: that is in Details.
  const framework = site.framework.name;
  return (
    <article className={cx("sites-card", site.missing && "sites-card--missing", needsAttention(site) && "sites-card--attention")} {...dragProps(site)}>
      <div className="sites-card__media">
        <SiteThumb site={site} group={group} />
        {site.pinned ? (
          <span className="sites-card__pin" title="Pinned">
            <Glyph name="pin" />
            <span className="g-sr">Pinned</span>
          </span>
        ) : null}
      </div>
      <div className="sites-card__body">
        <h3 className="sites-card__name">
          <SiteName site={site} />
        </h3>
        <TwinLine site={site} className="sites-card__twin" />
        <LiveLine site={site} />
        <AttentionChips site={site} />
        {site.note ? (
          <p className="sites-card__note" title={site.note}>
            {site.note}
          </p>
        ) : null}
      </div>
      <footer className="sites-card__foot">
        <Tag variant="mono">{framework}</Tag>
        <span className="sites-card__meta">{opened(site)}</span>
        <span className="g-toolbar__spacer" />
        <SiteMenu site={site} actions={actions} />
      </footer>
    </article>
  );
}

export function SiteRow({ site, group, actions }: { site: SiteSummary; group: SiteGroup | undefined; actions: SiteMenuActions }) {
  // Another site has this name: the folder (and group) take the second line, ahead of the note.
  const twin = useTwinLine(site.id);
  return (
    <li className={cx("sites-row", site.missing && "sites-row--missing")} {...dragProps(site)}>
      <span className="sites-row__grip" aria-hidden="true">
        <Glyph name="grip" />
      </span>
      <SiteThumb site={site} group={group} size="row" />
      <span className="sites-row__main">
        <span className="sites-row__name">
          <SiteName site={site} />
          {site.pinned ? (
            <span className="sites-row__pin" title="Pinned">
              <Glyph name="pin" />
              <span className="g-sr">Pinned</span>
            </span>
          ) : null}
        </span>
        {twin ? (
          <span className="sites-row__note sites-row__note--path" title={site.root}>
            {twin}
          </span>
        ) : site.note ? (
          <span className="sites-row__note">{site.note}</span>
        ) : (
          <span className="sites-row__note sites-row__note--path">{site.root}</span>
        )}
      </span>
      <span className="sites-row__chips">
        <AttentionChips site={site} limit={3} />
      </span>
      <span className="sites-row__live">
        <LiveLine site={site} />
      </span>
      <span className="sites-row__opened">{opened(site)}</span>
      <SiteMenu site={site} actions={actions} />
    </li>
  );
}

/**
 * One group: its header (colour, name, counts, fold, its own menu) and its
 * sites. The whole section takes a dropped site.
 */
export function GroupSection({
  section,
  view,
  actions,
  groupActions,
  dragging,
}: {
  section: SiteSection;
  view: "cards" | "list";
  actions: SiteMenuActions;
  groupActions: { rename: (group: SiteGroup) => void; remove: (group: SiteGroup) => void; toggle: (group: SiteGroup) => void; drop: (siteId: string, group: SiteGroup | null) => void } | null;
  dragging: boolean;
}) {
  const [over, setOver] = useState(false);
  const group = section.group;
  const collapsed = Boolean(group?.collapsed);
  const title = group?.name ?? "Not in a group";
  const accepts = (event: DragEvent) => event.dataTransfer.types.includes(DRAG_TYPE);
  let body: ReactNode;
  if (section.sites.length === 0) {
    body = <p className="sites-section__empty">{dragging ? `Drop a site here to file it under ${title}.` : "No sites here yet. Drag one in, or use a site’s menu › Move to group."}</p>;
  } else if (view === "cards") {
    body = (
      <div className="sites-grid">
        {section.sites.map((site) => (
          <SiteCard key={site.id} site={site} group={group ?? undefined} actions={actions} />
        ))}
      </div>
    );
  } else {
    body = (
      <ul className="sites-rows" aria-label={`Sites in ${title}`}>
        {section.sites.map((site) => (
          <SiteRow key={site.id} site={site} group={group ?? undefined} actions={actions} />
        ))}
      </ul>
    );
  }
  return (
    <section
      className={cx("sites-section", over && "sites-section--over", collapsed && "sites-section--collapsed")}
      aria-label={title}
      onDragOver={(event) => {
        if (!groupActions || !accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        setOver(false);
        const id = event.dataTransfer.getData(DRAG_TYPE);
        if (!groupActions || !id) return;
        event.preventDefault();
        groupActions.drop(id, group);
      }}
    >
      <header className="sites-section__head">
        {group && groupActions ? (
          <button type="button" className="sites-section__fold" aria-expanded={!collapsed} onClick={() => groupActions.toggle(group)}>
            <Icon name={collapsed ? "chevron-right" : "chevron-down"} />
            <span className="g-sr">{collapsed ? `Show ${title}` : `Fold ${title}`}</span>
          </button>
        ) : (
          <span className="sites-section__fold sites-section__fold--none" aria-hidden="true" />
        )}
        <GroupDot group={group} />
        <h2 className="sites-section__title">{title}</h2>
        <span className="sites-section__count">{counted(section.sites.length, "site")}</span>
        {section.attention > 0 ? <span className="sites-section__attention">{section.attention} {section.attention === 1 ? "needs" : "need"} attention</span> : null}
        <span className="g-toolbar__spacer" />
        {group && groupActions ? (
          <Menu
            label={`${title} options`}
            placement="bottom-end"
            items={[
              { id: "rename", label: "Rename or recolour…", icon: "settings", onSelect: () => groupActions.rename(group) },
              { id: "fold", label: collapsed ? "Show its sites" : "Fold it away", icon: collapsed ? "chevron-down" : "chevron-up-down", onSelect: () => groupActions.toggle(group) },
              { kind: "separator", id: "s" },
              { id: "remove", label: "Remove the group…", icon: "trash", tone: "danger", onSelect: () => groupActions.remove(group) },
            ]}
            trigger={(props) => (
              <button type="button" className="g-btn g-btn--quiet g-btn--sm g-btn--icon" aria-label={`${title} options`} {...props}>
                <Icon name="more" />
              </button>
            )}
          />
        ) : null}
      </header>
      {collapsed ? null : body}
    </section>
  );
}

export { DRAG_TYPE };
