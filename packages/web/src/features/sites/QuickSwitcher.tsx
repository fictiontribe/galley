import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SiteGroup, SiteSummary } from "@galley/core/types";
import { useSites } from "@/lib/stores/sites";
import { Icon, Kbd, Popover, cx } from "@/ui";
import { goToSite, inDesktop, openInNewWindow, rememberHere } from "./actions";
import { counted, needsAttention, rankSites, shortcutSites, switcherSections } from "./logic";
import { AttentionChips, GroupDot, SiteThumb } from "./parts";
import { useGroups, useTwinLine } from "./store";

interface Row {
  site: SiteSummary;
  section: string;
}

/**
 * The sidebar's site switcher: type to filter, pinned and recent first, then
 * by group; arrows and Enter all the way (⌘/Ctrl+Enter opens the site in a
 * new window in the desktop app). A footer says how many sites need
 * attention and leads to them.
 */
/** Under the name: the group — and, when another site has the same name, the folder that tells them apart. */
function SwitcherSub({ siteId, group }: { siteId: string; group: SiteGroup | undefined }) {
  const twin = useTwinLine(siteId);
  if (twin) {
    return (
      <span className="sites-switcher__sub">
        {group ? <GroupDot group={group} /> : null}
        <span className="sites-switcher__twin">{twin}</span>
      </span>
    );
  }
  if (!group) return null;
  return (
    <span className="sites-switcher__sub">
      <GroupDot group={group} />
      {group.name}
    </span>
  );
}

export function QuickSwitcher({ open, onClose, anchor, currentId }: { open: boolean; onClose: () => void; anchor: RefObject<HTMLElement | null>; currentId: string | null }) {
  const navigate = useNavigate();
  const sites = useSites((s) => s.sites);
  const groups = useGroups((s) => s.groups);
  const loadGroups = useGroups((s) => s.load);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const groupList: SiteGroup[] = useMemo(() => groups ?? [], [groups]);
  const all = useMemo(() => sites ?? [], [sites]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    if (!groups) void loadGroups();
    requestAnimationFrame(() => input.current?.focus());
  }, [open, groups, loadGroups]);

  const rows: Row[] = useMemo(() => {
    if (query.trim()) return rankSites(all, query, groupList).map((site) => ({ site, section: "Matches" }));
    return switcherSections(all, groupList).flatMap((section) => section.sites.map((site) => ({ site, section: section.label })));
  }, [all, groupList, query]);
  const shortcuts = useMemo(() => shortcutSites(all), [all]);
  const attention = all.filter(needsAttention).length;

  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, rows.length - 1)));
  }, [rows.length]);
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  const choose = (row: Row | undefined, newWindow = false) => {
    if (!row) return;
    onClose();
    if (newWindow) openInNewWindow(row.site.id);
    else goToSite(navigate, row.site.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") setActive((index) => (index + 1) % Math.max(1, rows.length));
    else if (event.key === "ArrowUp") setActive((index) => (index - 1 + rows.length) % Math.max(1, rows.length));
    else if (event.key === "Home" && !query) setActive(0);
    else if (event.key === "End" && !query) setActive(rows.length - 1);
    else if (event.key === "Enter") choose(rows[active], event.metaKey || event.ctrlKey);
    else return;
    event.preventDefault();
  };

  let lastSection = "";
  const desktop = inDesktop();
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} placement="bottom-start" className="sites-switcher" role="dialog" aria-label="Switch site" autoFocus={false}>
      <div className="sites-switcher__search">
        <Icon name="search" />
        <input
          ref={input}
          className="sites-switcher__input"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          aria-label="Find a site"
          placeholder={all.length > 8 ? `Find one of ${all.length} sites…` : "Find a site…"}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="sites-switcher__list" id={listId} role="listbox" aria-label="Sites">
        {rows.length === 0 ? (
          <p className="sites-switcher__empty">{all.length === 0 ? "No sites yet." : `No site matches “${query.trim()}”.`}</p>
        ) : (
          rows.map((row, index) => {
            const heading = row.section !== lastSection ? row.section : null;
            lastSection = row.section;
            const group = groupList.find((candidate) => candidate.id === row.site.group);
            const shortcut = shortcuts.findIndex((site) => site.id === row.site.id);
            return (
              <div key={`${row.section}-${row.site.id}`} role="presentation">
                {heading && !query ? (
                  <div className="g-eyebrow sites-switcher__group" role="presentation">
                    {heading}
                  </div>
                ) : null}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  aria-current={row.site.id === currentId ? "page" : undefined}
                  className={cx("sites-switcher__option", row.site.id === currentId && "sites-switcher__option--current")}
                  onMouseMove={() => setActive(index)}
                  onClick={(event) => choose(row, event.metaKey || event.ctrlKey)}
                >
                  <SiteThumb site={row.site} group={group} size="mini" />
                  <span className="sites-switcher__text">
                    <span className="sites-switcher__name">{row.site.name}</span>
                    <SwitcherSub siteId={row.site.id} group={group} />
                  </span>
                  <AttentionChips site={row.site} limit={2} showClean={false} />
                  {shortcut >= 0 ? <Kbd keys={["mod", String(shortcut + 1)]} className="sites-switcher__kbd" /> : null}
                  {row.site.id === currentId ? <Icon name="check" label="This site" /> : null}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="sites-switcher__foot">
        <Link to="/" className="g-link" onClick={() => (rememberHere(), onClose())}>
          All sites
        </Link>
        {attention > 0 ? (
          <Link to="/?attention=1" className="g-link sites-switcher__attention" onClick={() => (rememberHere(), onClose())}>
            {counted(attention, "site")} {attention === 1 ? "needs" : "need"} attention
          </Link>
        ) : null}
        <span className="g-toolbar__spacer" />
        <span className="sites-switcher__hint">
          <Kbd keys={["enter"]} /> open{desktop ? <> · <Kbd keys={["mod", "enter"]} /> new window</> : null}
        </span>
      </div>
    </Popover>
  );
}
