import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { OverlayToHost, PreviewStatus } from "@galley/core/types";
import { PreviewHostAdditions } from "@/additions/places";
import { ArrangePanel } from "@/features/builder/ArrangePanel";
import type { PageReport } from "@/features/builder/declined";
import { useArrange, type BuilderSource } from "@/features/builder/useArrange";
import { usePageFailure } from "@/features/builder/usePageFailure";
import type { EditorSelection } from "@/features/editor/EditorContext";
import { errorShape } from "@/lib/api";
import { useMeta } from "@/lib/stores/meta";
import { usePreview, usePreviewStatus } from "@/lib/stores/preview";
import { notify } from "@/lib/stores/toasts";
import { ErrorState, ProofMark, Spinner } from "@/ui";
import { EditAssist } from "./EditAssist";
import { useAppAppearance } from "./appearance";
import { entryAddress, isSignInNeeded, needsEntry, openEntry, type EntrySession } from "./entry";
import { addressToPath, basePathOf, canGo, frameUrl, go, localizeMessage, pagePath, parseOverlayMessage, startHistory, toOverlay, visit } from "./frames";
import { NoLiveSite, PageFailedState, PreviewStates } from "./PreviewStates";
import { frameName } from "./frameNames";
import { Divider, Sheet } from "./PreviewStage";
import { PreviewToolbar, WIDTHS, type FrameWidth, type PageTool } from "./PreviewToolbar";
import { useClickToEdit } from "./useClickToEdit";
import { useStoredState } from "./useStoredState";
import "./preview.css";

export interface PreviewPaneProps {
  siteId: string;
  /** Page to show, e.g. "/about/". */
  urlPath: string;
  /** The page inside the frame navigated (reported by the overlay script). */
  onNavigate: (urlPath: string) => void;
  /** Proposed (dev server), the live site (baseline proxy), or both side by side. */
  mode: "proposed" | "live" | "split";
  /** Offer click to edit (default true). Proof shows the pages without it. */
  editable?: boolean;
  /** The text the person picked on the page, for the assistant's context. */
  onSelection?: (selection: EditorSelection | null) => void;
  /** "Ask the assistant to change it", for text (or an image) that is part of the design. */
  onAsk?: (text: string, kind?: "text" | "image") => void;
  /** Text to find, scroll to and outline on the proposed page once it's ready (Proof's changed text). */
  highlight?: string;
  /** Show the form (for an image click-to-edit can't place: its section's image field is there). */
  onShowForm?: () => void;
  /** The entry behind the page and its edit queue, so its sections can be arranged on the page (the editor only). */
  builder?: BuilderSource;
}

/** The tool people had before Arrange existed: click to edit on or off. */
function firstTool(): PageTool {
  try {
    return window.localStorage.getItem("galley.preview.clickToEdit") === "false" ? "browse" : "edit";
  } catch {
    return "edit";
  }
}

type Role = "proposed" | "live";
/** How long after Undo puts a file back the proposed page is reloaded: the dev server needs a moment to see the file. */
const RELOAD_AFTER_UNDO_MS = 700;
const ROLES: Role[] = ["proposed", "live"];
const other = (role: Role): Role => (role === "proposed" ? "live" : "proposed");
const originOf = (url: string | null): string | null => {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
};

/** Where a frame starts: its entry address on a hosted install, else the proxy's own. */
const firstAddress = (entry: EntrySession | undefined, role: Role): string | null => (entry ? (role === "proposed" ? entry.first.preview : entry.first.baseline) : null);

function RunningPreview({ siteId, status, urlPath, onNavigate, mode, editable = true, onSelection, onAsk, highlight, onShowForm, builder, entry }: PreviewPaneProps & { status: PreviewStatus; entry?: EntrySession }) {
  // A message is only ever taken from the origin a frame was loaded from: on a hosted install, its entry address's.
  const origins: Record<Role, string | null> = entry
    ? { proposed: originOf(entry.first.preview), live: originOf(entry.first.baseline) }
    : { proposed: originOf(status.url), live: originOf(status.baselineUrl) };
  // Where each frame's pages are: the proxy's origin, or the preview's whole address when it has a path of its own (the in-browser demo's sample site).
  const bases: Record<Role, string | null> = entry ? origins : { proposed: origins.proposed && status.url, live: origins.live && status.baselineUrl };
  const basePaths: Record<Role, string> = { proposed: entry ? "" : basePathOf(status.url), live: entry ? "" : basePathOf(status.baselineUrl) };
  const frames: Record<Role, RefObject<HTMLIFrameElement | null>> = { proposed: useRef<HTMLIFrameElement>(null), live: useRef<HTMLIFrameElement>(null) };
  const stage = useRef<HTMLDivElement>(null);
  const primary: Role = mode === "live" ? "live" : "proposed";

  // Where each frame says it is, where it was last sent, and whether its overlay answered.
  const at = useRef<Record<Role, string | null>>({ proposed: null, live: null });
  const sent = useRef<Record<Role, string | null>>({ proposed: urlPath, live: urlPath });
  const ready = useRef<Record<Role, boolean>>({ proposed: false, live: false });
  const loaded = useRef<Record<Role, boolean>>({ proposed: false, live: false });
  const wanted = useRef(urlPath);
  const [shown, setShown] = useState(urlPath);
  const [history, setHistory] = useState(() => startHistory(urlPath));
  const [width, setWidth] = useStoredState<FrameWidth>("galley.preview.width", "desktop");
  const [ratio, setRatio] = useStoredState<number>("galley.preview.split", 0.5);
  const [storedTool, setTool] = useStoredState<PageTool>("galley.preview.tool", firstTool());
  const tool: PageTool = storedTool === "arrange" || storedTool === "browse" ? storedTool : "edit";

  const post = useCallback(
    (role: Role, message: ReturnType<typeof toOverlay>) => {
      const target = frames[role].current?.contentWindow;
      const origin = origins[role];
      // Until the frame has loaded a page from its proxy, it isn't at that origin yet.
      if (target && origin && (loaded.current[role] || ready.current[role])) target.postMessage(message, origin);
    },
    // The frames' refs and origins are fixed for this component's life: it is keyed by the origins.
    [],
  );
  const loadFrame = useCallback((role: Role, url: string) => {
    const frame = frames[role].current;
    if (!frame) return;
    try {
      // Replacing keeps the app's own back button out of the frame's history.
      frame.contentWindow?.location.replace(url);
    } catch {
      frame.src = url;
    }
  }, []);
  const navigateFrame = useCallback((role: Role, path: string) => {
    const base = bases[role];
    if (!frames[role].current || !base) return;
    sent.current[role] = path;
    loadFrame(role, frameUrl(base, path));
  }, [loadFrame]);

  // Hosted install: a frame turned away at the preview's address goes back in through a fresh entry address.
  const reenter = (role: Role) => {
    if (!entry) return;
    const path = sent.current[role] ?? at.current[role] ?? shown;
    entry.renew(role, path).then(
      (address) => {
        // Null: asked too often lately. The frame's own page says what to do.
        if (!address) return;
        ready.current[role] = false;
        sent.current[role] = path;
        loadFrame(role, address);
      },
      (error: unknown) => notify({ tone: "danger", title: "Couldn’t open the preview", body: errorShape(error).message, detail: errorShape(error).detail }),
    );
  };
  const reenterRef = useRef(reenter);
  reenterRef.current = reenter;
  const openInTab = entry
    ? () => {
        // Opened now, inside the click, so it isn't taken for a pop-up; it gets its address when the ticket arrives.
        const tab = window.open("", "_blank");
        if (!tab) return;
        tab.opener = null;
        entry.address(primary, shown).then(
          (address) => (address ? tab.location.replace(address) : tab.close()),
          (error: unknown) => {
            tab.close();
            notify({ tone: "danger", title: "Couldn’t open the preview", body: errorShape(error).message, detail: errorShape(error).detail });
          },
        );
      }
    : undefined;

  // The overlay outlines and labels in the app's own accent and theme.
  const appearance = useAppAppearance();
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;
  const sendAppearance = useCallback(
    (role: Role) => {
      const look = appearanceRef.current;
      if (look) post(role, toOverlay({ type: "appearance", accent: look.accent, theme: look.theme }));
    },
    [post],
  );
  useEffect(() => {
    for (const role of ROLES) if (ready.current[role]) sendAppearance(role);
  }, [appearance?.accent, appearance?.theme, sendAppearance]);

  // Whether the proposed page was drawn, as its overlay says (page-state), and when it last was.
  const [page, setPage] = useState<PageReport | null>(null);
  const [drawnAt, setDrawnAt] = useState<number | null>(null);
  const [revealed, setRevealed] = useState<number | null>(null);
  const failure = usePageFailure({
    page,
    drawnAt,
    store: editable ? (builder?.store ?? null) : null,
    // Undo put the file back: load the page again once the dev server has had a moment with it (its own reload may come too).
    reload: () => setTimeout(() => post("proposed", toOverlay({ type: "reload" })), RELOAD_AFTER_UNDO_MS),
    onEditSection: editable ? builder?.onEditSection : undefined,
    onShowForm,
  });

  // Arrange: the page's sections, handled on the page (only where the editor hands over the entry's queue).
  const arrange = useArrange({ source: editable ? builder : undefined, on: editable && tool === "arrange" && mode !== "live", post: (message) => post("proposed", message), frame: frames.proposed, page });
  const current: PageTool = tool === "arrange" && !arrange.available ? "edit" : tool;
  const editing = editable && current === "edit" && mode !== "live";
  const arranging = arrange.active;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const arrangeRef = useRef(arrange);
  arrangeRef.current = arrange;

  const clickToEdit = useClickToEdit({ siteId, currentPath: () => at.current.proposed ?? shown, send: (message) => post("proposed", message), onSelection });
  const handlers = useRef(clickToEdit);
  handlers.current = clickToEdit;

  // The page arrived somewhere: follow it everywhere else.
  const arrived = (role: Role, path: string) => {
    at.current[role] = path;
    sent.current[role] = path;
    if (role === primary) {
      setShown(path);
      setHistory((current) => visit(current, path));
      if (path !== wanted.current) {
        wanted.current = path;
        onNavigate(path);
      }
    }
    if (mode === "split") {
      const partner = other(role);
      if (at.current[partner] !== path && sent.current[partner] !== path) navigateFrame(partner, path);
    }
  };
  const handle = (role: Role, message: OverlayToHost) => {
    switch (message.type) {
      case "ready":
        ready.current[role] = true;
        // A new page: whether it was drawn is its overlay's next word.
        if (role === "proposed") setPage(null);
        post(role, toOverlay({ type: "mode", edit: role === "proposed" && editing }));
        sendAppearance(role);
        arrived(role, message.path);
        // Give the page a moment to lay out before scrolling to the changed text.
        if (role === "proposed" && highlight) setTimeout(() => post("proposed", toOverlay({ type: "highlight", text: highlight })), 400);
        if (role === "proposed") arrangeRef.current.resend();
        return;
      case "navigate":
        arrived(role, message.path);
        return;
      case "scroll":
        if (mode === "split") post(other(role), toOverlay({ type: "scroll", y: message.y }));
        return;
      case "select":
        if (role === "proposed" && editing) void handlers.current.onSelect(message);
        return;
      case "select-image":
        if (role === "proposed" && editing) void handlers.current.onSelectImage(message);
        return;
      case "edit":
        // Click to edit saves on its own, marked (useClickToEdit), and changes nothing in the form meanwhile.
        if (role === "proposed") void handlers.current.onEdit(message);
        return;
      case "edit-cancelled":
        if (role === "proposed") handlers.current.onEditCancelled(message);
        return;
      case "page-state":
        if (role !== "proposed") return;
        setPage({ state: message.state, status: message.status, message: message.message, at: Date.now() });
        if (message.state === "drawn") setDrawnAt(Date.now());
        return;
      case "arrange-status":
      case "arrange-select":
      case "arrange-action":
      case "placing-at":
      case "place":
        if (role === "proposed") arrangeRef.current.handle(message);
    }
  };
  const handleRef = useRef(handle);
  handleRef.current = handle;
  // The entry's form, when the editor hands it over: a message from a page is the page's request, not the person's, so
  // any change it makes to the form taints the form until its next save, which goes marked (content/form/store.ts).
  const pageStoreRef = useRef(builder?.store ?? null);
  pageStoreRef.current = builder?.store ?? null;

  // Only messages from the frames this pane loaded, at the origins it loaded them from.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const role = ROLES.find((candidate) => frames[candidate].current?.contentWindow === event.source && origins[candidate] === event.origin);
      if (!role) return;
      if (isSignInNeeded(event.data)) {
        reenterRef.current(role);
        return;
      }
      const message = parseOverlayMessage(event.data);
      if (!message) return;
      // Every change the message makes to the form while it is handled is the page's. (Undo, which finishes after a wait,
      // carries that on itself: listActions.)
      const run = () => handleRef.current(role, localizeMessage(message, basePaths[role]));
      const form = pageStoreRef.current;
      if (form) form.actions.fromPage(run);
      else run();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // The editor moved to another page (another entry, a link elsewhere).
  useEffect(() => {
    wanted.current = urlPath;
    for (const role of mode === "split" ? ROLES : [primary]) {
      const current = at.current[role] ?? sent.current[role];
      if (current !== null && pagePath(current) === pagePath(urlPath)) continue;
      navigateFrame(role, urlPath);
    }
  }, [urlPath, mode, primary, navigateFrame]);

  // Click to edit follows the toggle and the mode.
  useEffect(() => {
    if (ready.current.proposed) post("proposed", toOverlay({ type: "mode", edit: editing }));
    if (!editing) handlers.current.close();
  }, [editing, post]);

  // The first word is the host's: it greets each page as it loads, which also tells an overlay that
  // can't read its parent's origin which origin to trust (see the overlay's own notes).
  const greet = (role: Role) => {
    loaded.current[role] = true;
    post(role, toOverlay({ type: "mode", edit: role === "proposed" && editingRef.current }));
  };

  const goTo = (path: string) => {
    for (const role of mode === "split" ? ROLES : [primary]) navigateFrame(role, path);
  };
  const step = (delta: -1 | 1) => {
    const next = go(history, delta);
    if (!next) return;
    setHistory(next.history);
    goTo(next.path);
  };
  const reload = () => {
    for (const role of mode === "split" ? ROLES : [primary]) {
      if (ready.current[role]) post(role, toOverlay({ type: "reload" }));
      else navigateFrame(role, at.current[role] ?? shown);
    }
  };

  const liveCaption = status.baselineSource === "production" ? "Live site · production" : "Live site · staging";
  const pixel = WIDTHS[width];
  const startAt = at.current[primary] ?? shown;
  const { assist, notice } = clickToEdit;
  const line = assist.kind === "resolving" ? { tone: "working" as const, text: "Finding where this text lives…" } : notice;

  return (
    <div className="preview">
      <PreviewToolbar
        path={shown}
        onGo={(address) => {
          const path = addressToPath(address, [status.url, status.baselineUrl]);
          if (!path) return "Only pages of this site open here. Type a path such as /about/.";
          goTo(path);
          return null;
        }}
        canBack={canGo(history, -1)}
        canForward={canGo(history, 1)}
        onBack={() => step(-1)}
        onForward={() => step(1)}
        onReload={reload}
        width={width}
        onWidth={setWidth}
        tool={editable && mode !== "live" ? { value: current, onChange: setTool, arrange: arrange.available } : undefined}
        openUrl={bases[primary] ? frameUrl(bases[primary] as string, shown) : null}
        onOpen={openInTab}
      />
      <div className="preview-body">
      {arranging ? <ArrangePanel siteId={siteId} arrange={arrange} onShowForm={onShowForm} failure={failure} /> : null}
      <div ref={stage} className={`preview-stage preview-stage--${mode}`} style={mode === "split" ? { gridTemplateColumns: `${ratio}fr auto ${1 - ratio}fr` } : undefined}>
        {mode !== "proposed" ? (
          origins.live ? (
            <Sheet key="live" frameRef={frames.live} name={frameName("live", editable)} src={firstAddress(entry, "live") ? entryAddress(firstAddress(entry, "live") as string, startAt) : frameUrl(bases.live ?? origins.live, startAt)} title="Live site" width={pixel} caption={mode === "split" ? liveCaption : undefined} onLoad={() => greet("live")} />
          ) : (
            <div key="live" className="preview-side">
              <NoLiveSite siteId={siteId} />
            </div>
          )
        ) : null}
        {mode === "split" ? <Divider key="divider" ratio={ratio} onRatio={setRatio} stage={stage} /> : null}
        {mode !== "live" && origins.proposed ? (
          <Sheet key="proposed" frameRef={frames.proposed} name={frameName("proposed", editable)} src={firstAddress(entry, "proposed") ? entryAddress(firstAddress(entry, "proposed") as string, startAt) : frameUrl(bases.proposed ?? origins.proposed, startAt)} title="Proposed page" width={pixel} caption={mode === "split" ? "Proposed · your changes" : undefined} onLoad={() => greet("proposed")} cover={failure && revealed !== page?.at ? <PageFailedState failure={failure} actions={!arranging} onReveal={() => setRevealed(page?.at ?? null)} /> : undefined} />
        ) : null}
      </div>
      </div>
      {line ? (
        <div className={`preview-notice preview-notice--${line.tone}`} role="status">
          {line.tone === "working" ? <Spinner label="Working" /> : <ProofMark kind={line.tone === "done" ? "caret" : "bang"} tone={line.tone === "done" ? "insert" : undefined} />}
          <span>{line.text}</span>
        </div>
      ) : (
        <div className="g-sr" role="status" />
      )}
      {editable ? (
        <PreviewHostAdditions
          siteId={siteId}
          entryPath={builder?.entry?.path}
          lists={arrange.lists}
          postMarks={(marks) => post("proposed", toOverlay({ type: "marks", lists: arrange.lists, marks }))}
        />
      ) : null}
      {editable ? (
        <EditAssist
          siteId={siteId}
          assist={assist}
          frame={frames.proposed}
          onClose={clickToEdit.close}
          onSaveStored={clickToEdit.saveStored}
          onChoose={clickToEdit.choose}
          onChooseSpot={clickToEdit.chooseSpot}
          onPickImage={clickToEdit.pickImage}
          onAsk={onAsk}
          onShowForm={onShowForm}
        />
      ) : null}
    </div>
  );
}

/**
 * The site's own pages on the proofing table: proposed, live, or side by side
 * with scrolling and navigation kept together. Starts the preview the first
 * time it's shown, and says honestly what it's doing until it's ready.
 */
export function PreviewPane(props: PreviewPaneProps) {
  const { siteId } = props;
  const status = usePreviewStatus(siteId);
  const run = usePreview((s) => s.run);
  const hosted = useMeta((s) => needsEntry(s.meta));
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !status || status.state !== "idle") return;
    started.current = true;
    run(siteId, "start").catch((error: unknown) => notify({ tone: "danger", title: "Couldn’t start the preview", body: errorShape(error).message, detail: errorShape(error).detail }));
  }, [siteId, status, run]);

  if (!status || status.state !== "ready" || !status.url) return <PreviewStates siteId={siteId} status={status} />;
  // A restart (a new start time) or new addresses ask for fresh entry addresses: a new EnteredPreview.
  if (hosted) return <EnteredPreview key={`${status.url} ${status.baselineUrl ?? ""} ${status.startedAt ?? ""}`} {...props} status={status} />;
  return <RunningPreview key={`${status.url} ${status.baselineUrl ?? ""}`} {...props} status={status} />;
}

/**
 * A hosted install's preview: the frames' first addresses come from the
 * entry route (one-use tickets that let this browser in), asked for once per
 * running preview. See entry.ts.
 */
function EnteredPreview(props: PreviewPaneProps & { status: PreviewStatus }) {
  const { siteId } = props;
  const [entry, setEntry] = useState<EntrySession | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setFailed(null);
    setEntry(null);
    openEntry(siteId).then(
      (session) => {
        if (current) setEntry(session);
      },
      (error: unknown) => {
        if (current) setFailed(error);
      },
    );
    return () => {
      current = false;
    };
  }, [siteId, attempt]);

  if (failed !== null || entry?.first.preview === null) {
    return (
      <div className="app-preview-state">
        <ErrorState
          compact
          title="The preview couldn’t be opened"
          message={failed !== null ? errorShape(failed).message : "The preview isn’t answering yet. Try again in a moment."}
          detail={failed !== null ? errorShape(failed).detail : undefined}
          onRetry={() => setAttempt((count) => count + 1)}
        />
      </div>
    );
  }
  if (!entry) {
    return (
      <div className="app-preview-state" aria-busy="true">
        <Spinner label="Opening the preview" />
      </div>
    );
  }
  return <RunningPreview {...props} entry={entry} />;
}
