import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { OverlayToHost, PreviewStatus } from "@galley/core/types";
import { ArrangePanel } from "@/features/builder/ArrangePanel";
import { useArrange, type BuilderSource } from "@/features/builder/useArrange";
import type { EditorSelection } from "@/features/editor/EditorContext";
import { errorShape } from "@/lib/api";
import { usePreview, usePreviewStatus } from "@/lib/stores/preview";
import { notify } from "@/lib/stores/toasts";
import { ProofMark, Spinner } from "@/ui";
import { EditAssist } from "./EditAssist";
import { useAppAppearance } from "./appearance";
import { addressToPath, canGo, frameUrl, go, pagePath, parseOverlayMessage, startHistory, toOverlay, visit } from "./frames";
import { NoLiveSite, PreviewStates } from "./PreviewStates";
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
const ROLES: Role[] = ["proposed", "live"];
const other = (role: Role): Role => (role === "proposed" ? "live" : "proposed");
const originOf = (url: string | null): string | null => {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
};

function RunningPreview({ siteId, status, urlPath, onNavigate, mode, editable = true, onSelection, onAsk, highlight, onShowForm, builder }: PreviewPaneProps & { status: PreviewStatus }) {
  const origins: Record<Role, string | null> = { proposed: originOf(status.url), live: originOf(status.baselineUrl) };
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
  const navigateFrame = useCallback((role: Role, path: string) => {
    const frame = frames[role].current;
    const origin = origins[role];
    if (!frame || !origin) return;
    sent.current[role] = path;
    const url = frameUrl(origin, path);
    try {
      // Replacing keeps the app's own back button out of the frame's history.
      frame.contentWindow?.location.replace(url);
    } catch {
      frame.src = url;
    }
  }, []);

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

  // Arrange: the page's sections, handled on the page (only where the editor hands over the entry's queue).
  const arrange = useArrange({ source: editable ? builder : undefined, on: editable && tool === "arrange" && mode !== "live", post: (message) => post("proposed", message), frame: frames.proposed });
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
        if (role === "proposed") void handlers.current.onEdit(message);
        return;
      case "edit-cancelled":
        if (role === "proposed") handlers.current.onEditCancelled(message);
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

  // Only messages from the frames this pane loaded, at the origins it loaded them from.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const role = ROLES.find((candidate) => frames[candidate].current?.contentWindow === event.source && origins[candidate] === event.origin);
      if (!role) return;
      const message = parseOverlayMessage(event.data);
      if (message) handleRef.current(role, message);
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
        openUrl={origins[primary] ? frameUrl(origins[primary] as string, shown) : null}
      />
      <div className="preview-body">
      {arranging ? <ArrangePanel siteId={siteId} arrange={arrange} onShowForm={onShowForm} /> : null}
      <div ref={stage} className={`preview-stage preview-stage--${mode}`} style={mode === "split" ? { gridTemplateColumns: `${ratio}fr auto ${1 - ratio}fr` } : undefined}>
        {mode !== "proposed" ? (
          origins.live ? (
            <Sheet key="live" frameRef={frames.live} name={frameName("live", editable)} src={frameUrl(origins.live, startAt)} title="Live site" width={pixel} caption={mode === "split" ? liveCaption : undefined} onLoad={() => greet("live")} />
          ) : (
            <div key="live" className="preview-side">
              <NoLiveSite siteId={siteId} />
            </div>
          )
        ) : null}
        {mode === "split" ? <Divider key="divider" ratio={ratio} onRatio={setRatio} stage={stage} /> : null}
        {mode !== "live" && origins.proposed ? (
          <Sheet key="proposed" frameRef={frames.proposed} name={frameName("proposed", editable)} src={frameUrl(origins.proposed, startAt)} title="Proposed page" width={pixel} caption={mode === "split" ? "Proposed · your changes" : undefined} onLoad={() => greet("proposed")} />
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
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !status || status.state !== "idle") return;
    started.current = true;
    run(siteId, "start").catch((error: unknown) => notify({ tone: "danger", title: "Couldn’t start the preview", body: errorShape(error).message, detail: errorShape(error).detail }));
  }, [siteId, status, run]);

  if (!status || status.state !== "ready" || !status.url) return <PreviewStates siteId={siteId} status={status} />;
  return <RunningPreview key={`${status.url} ${status.baselineUrl ?? ""}`} {...props} status={status} />;
}
