import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { SearchHit } from "@galley/core/types";
import type { ApiRouteKey } from "@galley/core/api";
import { useAccount, useMay } from "@/lib/may";
import { api } from "@/lib/api";
import { collectionIcon, visibleCollections } from "@/lib/collections";
import { collectionNouns, count } from "@/lib/format";
import { usePendingCount } from "@/lib/stores/changes";
import { usePreview } from "@/lib/stores/preview";
import { useHostedInstall } from "@/lib/stores/meta";
import { useEditorHostingUi } from "@/features/hosting/useHosting";
import { useSite } from "@/lib/stores/site";
import { useSites } from "@/lib/stores/sites";
import { Dialog, Icon, Kbd, Spinner, type IconName } from "@/ui";
import { isKitFile } from "@/features/forms/logic/locate";
import { useChrome } from "./chrome";
import { goToSite, inDesktop, openInNewWindow } from "@/features/sites/actions";
import { attentionChips, rankSites } from "@/features/sites/logic";
import { useSiteShortcuts } from "@/features/sites/session";
import { useGroups } from "@/features/sites/store";

interface Command {
  id: string;
  group: "Go to" | "Actions" | "Sites" | "Content";
  label: string;
  hint?: string;
  icon: IconName;
  run: () => void;
  /** The route this command exists to reach: left out for someone who may not call it. */
  route?: ApiRouteKey;
}

/** Every word of the query appears in the label (case-insensitive). */
function matches(label: string, query: string): boolean {
  const text = label.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}

function useSearch(siteId: string | null, query: string): { hits: SearchHit[]; searching: boolean } {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (!siteId || q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      api("GET /api/sites/:siteId/search", { params: { siteId }, query: { q, limit: 8 }, signal: controller.signal })
        .then((result) => setHits(result))
        .catch(() => setHits([]))
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [siteId, query]);
  return { hits, searching };
}

/** ⌘K / Ctrl-K: jump to a collection or screen, search content, Proof, Publish, switch site. */
export function CommandPalette() {
  const open = useChrome((s) => s.paletteOpen);
  const setOpen = useChrome((s) => s.setPaletteOpen);
  const setPublishOpen = useChrome((s) => s.setPublishOpen);
  const navigate = useNavigate();
  const siteId = useSite((s) => s.siteId);
  const detail = useSite((s) => s.detail);
  const sites = useSites((s) => s.sites) ?? [];
  const groups = useGroups((s) => s.groups);
  // A hosted install has one site: no other sites to jump or switch to, no groups to load.
  const hosted = useHostedInstall();
  // ⌘1…⌘9: the pinned and most recent sites, from anywhere in the app.
  useSiteShortcuts(!hosted);
  useEffect(() => {
    if (open && !hosted && !useGroups.getState().groups) void useGroups.getState().load();
  }, [open, hosted]);
  const pending = usePendingCount();
  const runPreview = usePreview((s) => s.run);
  const previewState = usePreview((s) => (siteId ? s.bySite[siteId]?.state : undefined));
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const { hits, searching } = useSearch(open ? siteId : null, query);
  const may = useMay();
  const account = useAccount();

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      // A text editor with its own ⌘K (the body editor, Markdown fields: "add a link") has already used the key.
      // One rule everywhere: in a text editor ⌘K adds a link; anywhere else it opens the palette.
      if (event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(!useChrome.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to);
    const list: Command[] = [];
    if (siteId && detail) {
      const base = `/sites/${siteId}`;
      list.push({ id: "home", group: "Go to", label: "Site home", icon: "home", run: go(base) });
      for (const collection of visibleCollections(detail.model).filter((candidate) => !isKitFile(candidate))) {
        list.push({
          id: `c-${collection.id}`,
          group: "Go to",
          label: collection.label,
          hint: collection.kind === "entries" ? count(collection.count, collection.singular, collectionNouns(collection).many) : undefined,
          icon: collectionIcon(collection),
          run: go(`${base}/c/${encodeURIComponent(collection.id)}`),
        });
      }
      list.push(
        { id: "media", group: "Go to", label: "Media", icon: "image", run: go(`${base}/media`) },
        { id: "forms", group: "Go to", label: "Forms", icon: "posts", run: go(`${base}/forms`) },
        { id: "scripts", group: "Go to", label: "Scripts", hint: "Analytics, tags and consent", icon: "data", run: go(`${base}/scripts`) },
        { id: "brand", group: "Go to", label: "Brand", hint: "Colours, fonts and voice", icon: "registration", run: go(`${base}/brand`) },
        { id: "history", group: "Go to", label: "Version history", icon: "history", run: go(`${base}/history`) },
        { id: "site-settings", group: "Go to", label: "Site settings", icon: "settings", run: go(`${base}/settings`), route: "PUT /api/sites/:siteId/config" },
        { id: "site-plugins", group: "Go to", label: "Plugins for this site", hint: "What’s active here", icon: "plugin", run: go(`${base}/plugins`), route: "POST /api/plugins/enabled" },
        { id: "proof", group: "Actions", label: "Open the proof", hint: count(pending, "change"), icon: "proof", run: go(`${base}/proof`) },
      );
      if (pending > 0) list.push({ id: "publish", group: "Actions", label: "Publish changes", hint: count(pending, "change"), icon: "arrow-up", run: () => setPublishOpen(true), route: "POST /api/sites/:siteId/publish" });
      list.push(
        previewState === "ready"
          ? { id: "restart", group: "Actions", label: "Restart preview", icon: "refresh", run: () => void runPreview(siteId, "restart") }
          : { id: "start", group: "Actions", label: "Start preview", icon: "play", run: () => void runPreview(siteId, "start") },
        { id: "ask", group: "Actions", label: "Ask the assistant", icon: "chat", run: go(`${base}/edit`) },
        { id: "import-wordpress", group: "Actions", label: "Bring your WordPress site", hint: "Posts, pages and images as changes to check", icon: "download", run: go(`${base}/import`) },
      );
      // A hosted install never makes other installs.
      if (!hosted) {
        const hostEditor = () => {
          useEditorHostingUi.getState().open(siteId);
          navigate(`${base}/online`);
        };
        list.push({ id: "host-editor", group: "Actions", label: "Host the editor online", hint: "Edit this site from any browser", icon: "globe", run: hostEditor });
      }
    }
    if (hosted) {
      list.push(
        { id: "install", group: "Go to", label: "Install", hint: account ? "Address, people and backups" : "Address, password and backups", icon: "folder", run: go("/install"), route: "GET /api/install" },
        { id: "settings", group: "Go to", label: "App settings", icon: "settings", run: go("/settings"), route: "PATCH /api/settings" },
        { id: "plugins", group: "Go to", label: "Plugins", hint: "Generators, destinations, tools", icon: "plugin", run: go("/plugins"), route: "POST /api/plugins/enabled" },
      );
      if (account) list.push({ id: "account", group: "Go to", label: "Your account", hint: "Name, e-mail and password", icon: "person", run: go("/account") });
      if (!siteId) list.push({ id: "site", group: "Go to", label: "The site", icon: "folder-site", run: go("/") });
      return list.filter((command) => !command.route || may(command.route));
    }
    list.push(
      { id: "sites", group: "Go to", label: "All sites", icon: "sites", run: go("/") },
      { id: "new", group: "Actions", label: "Create a new site", icon: "plus", run: go("/new") },
      { id: "settings", group: "Go to", label: "App settings", icon: "settings", run: go("/settings") },
      { id: "plugins", group: "Go to", label: "Plugins", hint: "Generators, destinations, tools", icon: "plugin", run: go("/plugins") },
    );
    // Every site, each to where it was left; the hint says what it's waiting on, or its group.
    for (const site of sites) {
      if (site.id === siteId || site.missing) continue;
      const waiting = attentionChips(site).find((chip) => chip.attention)?.label;
      const group = groups?.find((candidate) => candidate.id === site.group)?.name;
      list.push({ id: `s-${site.id}`, group: "Sites", label: `Switch to ${site.name}`, hint: waiting ?? group, icon: "folder-site", run: () => goToSite(navigate, site.id) });
      if (inDesktop()) list.push({ id: `w-${site.id}`, group: "Sites", label: `Open ${site.name} in a new window`, icon: "external", run: () => openInNewWindow(site.id) });
    }
    list.push({ id: "add-sites", group: "Actions", label: "Add sites from a folder", icon: "sites", run: go("/?open=sites") });
    return list;
  }, [siteId, detail, sites, groups, pending, previewState, navigate, runPreview, setPublishOpen, hosted, account, may]);

  const visible = useMemo(() => {
    const others = query.trim() ? commands.filter((command) => command.group !== "Sites" && matches(command.label, query)) : commands.filter((command) => command.group !== "Sites");
    // A query that names a site lists sites first, best match first (by name, initials, group or note).
    const ranked = query.trim() && !hosted ? rankSites(sites.filter((site) => site.id !== siteId), query, groups ?? []) : [];
    const siteCommands = ranked.flatMap((site) => commands.filter((command) => command.id === `s-${site.id}` || command.id === `w-${site.id}`));
    const filtered = [...siteCommands, ...others];
    // One row per page: the first (best-ranked) place the words were found.
    const firstPerPage = hits.filter((hit, index) => hits.findIndex((other) => other.path === hit.path) === index);
    const content: Command[] = firstPerPage.map((hit, index) => ({
      id: `h-${index}-${hit.path}`,
      group: "Content",
      label: hit.title,
      hint: hit.location.kind === "field" ? hit.location.label : hit.excerpt,
      icon: "page",
      run: () => navigate(`/sites/${siteId}/edit?path=${encodeURIComponent(hit.path)}`),
    }));
    return [...filtered, ...content];
  }, [commands, hits, query, navigate, siteId, sites, groups, hosted]);

  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, visible.length - 1)));
  }, [visible.length]);

  const choose = (command: Command | undefined) => {
    if (!command) return;
    setOpen(false);
    command.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") setActive((index) => (index + 1) % Math.max(1, visible.length));
    else if (event.key === "ArrowUp") setActive((index) => (index - 1 + visible.length) % Math.max(1, visible.length));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(visible.length - 1);
    else if (event.key === "Enter") choose(visible[active]);
    else return;
    event.preventDefault();
  };

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  let lastGroup = "";
  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Search and jump" hideTitle size="lg" className="app-palette" initialFocus={input}>
      <div className="app-palette__search">
        <Icon name="search" />
        <input
          ref={input}
          className="app-palette__input"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={visible[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          aria-label="Search pages, or type a command"
          placeholder={siteId ? "Search pages, or jump to…" : "Jump to…"}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        {searching ? <Spinner label="Searching" /> : null}
      </div>
      <div className="app-palette__list" id={listId} role="listbox" aria-label="Results">
        {visible.length === 0 ? (
          <p className="app-palette__empty">{searching ? "Searching…" : `Nothing matches “${query.trim()}”. Try a shorter word.`}</p>
        ) : (
          visible.map((command, index) => {
            const heading = command.group !== lastGroup ? command.group : null;
            lastGroup = command.group;
            return (
              <div key={command.id} role="presentation">
                {heading ? (
                  <div className="g-eyebrow app-palette__group" role="presentation">
                    {heading}
                  </div>
                ) : null}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className="app-palette__option"
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(command)}
                >
                  <Icon name={command.icon} />
                  <span className="app-palette__label">{command.label}</span>
                  {command.hint ? <span className="app-palette__hint">{command.hint}</span> : null}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="app-palette__foot">
        <span>
          <Kbd keys={["up", "down"]} /> to move
        </span>
        <span>
          <Kbd keys={["enter"]} /> to open
        </span>
        <span>
          <Kbd keys={["escape"]} /> to close
        </span>
      </div>
    </Dialog>
  );
}
