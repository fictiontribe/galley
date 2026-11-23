import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useTopBar, type TopBarConfig } from "@/app/chrome";
import type { BuilderSource } from "@/features/builder/useArrange";
import { ChatHeadActions } from "@/features/chat/ChatHeadActions";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { useChatUi } from "@/features/chat/store";
import { EntryForm } from "@/features/content/EntryForm";
import { PreviewPane } from "@/features/preview/PreviewPane";
import { visibleCollections } from "@/lib/collections";
import { fileName, friendlyLabel } from "@/lib/format";
import { useSite } from "@/lib/stores/site";
import type { PreviewMode } from "@/lib/stores/ui";
import { EmptyState, ErrorState, IconButton, SegmentedControl, Skeleton, SplitPane, Tag, buttonClass, usePaneControls, type PaneSpec } from "@/ui";
import { EditorProvider, useEditor } from "./EditorContext";

const PANES: PaneSpec[] = [
  { id: "form", label: "Form", size: 380, min: 300, max: 640, collapsible: true },
  { id: "preview", label: "Preview", min: 320, collapsible: true },
  { id: "chat", label: "Assistant", size: 360, min: 300, max: 560, collapsible: true },
];

const MODES: Array<{ value: PreviewMode; label: string; title: string }> = [
  { value: "proposed", label: "Proposed", title: "Your site with the unpublished changes" },
  { value: "live", label: "Live site", title: "What visitors see now" },
  { value: "split", label: "Side by side", title: "Proposed next to the live site" },
];

function CollapseButton({ paneId, side }: { paneId: string; side: "left" | "right" }) {
  const controls = usePaneControls(paneId);
  if (!controls) return null;
  return (
    <IconButton
      icon={side === "left" ? "panel-left" : "panel-right"}
      label={`Hide ${controls.label.toLowerCase()}`}
      onClick={controls.toggle}
      tooltipSide={side === "left" ? "right" : "left"}
    />
  );
}

/** A pane's head row; the hide button sits at `buttonAt` so it never crowds the pane's own controls. */
function PaneHead({ children, paneId, side, buttonAt = "end" }: { children: ReactNode; paneId: string; side: "left" | "right"; buttonAt?: "start" | "end" }) {
  const button = <CollapseButton paneId={paneId} side={side} />;
  return (
    <div className="g-pane__head app-pane-head">
      {buttonAt === "start" ? button : null}
      {children}
      {buttonAt === "end" ? button : null}
    </div>
  );
}

/** The entry's header: breadcrumbs + Edited tag in the top bar, kind and file chip in the form pane. */
function useEntryHeader(): void {
  const { entry, path, collection, siteId } = useEditor();
  const config: TopBarConfig = {
    crumbs: [
      collection ? { label: collection.label, to: `/sites/${siteId}/c/${encodeURIComponent(collection.id)}` } : { label: "Editor" },
      { label: entry?.title ?? (path ? friendlyLabel(path) : "Choose a page") },
    ],
    tag:
      entry?.status === "modified"
        ? { label: "Edited", tone: "change" }
        : entry?.status === "added"
          ? { label: "New", tone: "insert" }
          : entry?.status === "deleted"
            ? { label: "Deleted", tone: "delete" }
            : undefined,
  };
  useTopBar(config);
}

function FormPane() {
  const { siteId, path, entry, entryLoading, entryError, entryStatus, refresh, collection, unmatchedUrl } = useEditor();
  const model = useSite((s) => s.detail?.model);
  const first = visibleCollections(model)[0];

  const browse = first ? (
    <Link className={buttonClass("secondary", "sm")} to={`/sites/${siteId}/c/${encodeURIComponent(first.id)}`}>
      Browse {first.label.toLowerCase()}
    </Link>
  ) : null;

  let body: ReactNode;
  if (!path && unmatchedUrl) {
    body = (
      <EmptyState
        compact
        title="Nothing to edit at this address."
        body={
          <>
            No page’s content lives at <span className="g-mono">{unmatchedUrl}</span>, so there’s no form for it. The preview shows that address; follow a link there to a page you can edit.
          </>
        }
        actions={browse}
      />
    );
  } else if (!path) {
    body = (
      <EmptyState
        compact
        title="Choose a page to edit."
        body="Pick one from the sidebar, or click a link in the preview."
        actions={browse}
      />
    );
  } else if (entryLoading) {
    body = (
      <div className="app-form-skeleton" aria-busy="true">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="app-form-skeleton__field">
            <Skeleton width={90 + index * 12} height={12} />
            <Skeleton height={32} />
          </div>
        ))}
      </div>
    );
  } else if (entryStatus === "error" && !entry) {
    body = <ErrorState compact title="Couldn’t open this page" error={entryError} onRetry={() => void refresh()} />;
  } else {
    body = <EntryForm siteId={siteId} path={path} />;
  }

  return (
    <section className="g-pane app-pane" aria-label="Form">
      <PaneHead paneId="form" side="left">
        <span className="g-eyebrow app-pane-head__title">{entry ? (collection?.singular ?? "Entry") : "Form"}</span>
        <span className="g-toolbar__spacer" />
        {path ? (
          <Tag variant="mono" title={path}>
            {fileName(path)}
          </Tag>
        ) : null}
      </PaneHead>
      <div className="app-pane__fill">{body}</div>
    </section>
  );
}

function PreviewPaneShell() {
  const { siteId, urlPath, navigate, previewMode, setPreviewMode, setSelection, entry, formStore } = useEditor();
  const chat = usePaneControls("chat");
  const form = usePaneControls("form");
  // Text (or an image) that is part of the design goes to the assistant, with the selection as its context.
  const ask = (text: string, kind: "text" | "image" = "text") => {
    if (text) setSelection({ text });
    const draft = kind === "image" ? (text ? `Replace the image “${text}” with ` : "Replace the image I clicked with ") : `Change “${text}” to `;
    useChatUi.getState().offerDraft(siteId, draft);
    if (chat?.collapsed) chat.toggle();
  };
  // An image click-to-edit can't place: show the form, at its sections, where section images live.
  const showForm = () => {
    if (form?.collapsed) form.toggle();
    requestAnimationFrame(() => {
      const pane = document.querySelector<HTMLElement>(".app-form");
      const sections = pane?.querySelector<HTMLElement>('[data-path="sections"], [data-path="blocks"]');
      const target = sections ?? pane;
      target?.scrollIntoView({ block: "start", behavior: "smooth" });
      target?.querySelector<HTMLElement>("button, input, textarea")?.focus({ preventScroll: true });
    });
  };
  // Arrange's "Edit content": the section's card in the form, opened and scrolled to.
  const builder = useMemo<BuilderSource>(
    () => ({
      entry,
      store: formStore,
      onEditSection: (field, index) => {
        if (form?.collapsed) form.toggle();
        formStore?.actions.revealField([field, index]);
      },
    }),
    [entry, formStore, form],
  );
  return (
    <section className="g-pane app-pane" aria-label="Preview">
      <PaneHead paneId="preview" side="right">
        <SegmentedControl label="Preview mode" options={MODES} value={previewMode} onChange={setPreviewMode} />
        <span className="g-toolbar__spacer" />
      </PaneHead>
      <div className="app-pane__fill">
        <PreviewPane siteId={siteId} urlPath={urlPath} onNavigate={navigate} mode={previewMode} onSelection={setSelection} onAsk={ask} onShowForm={showForm} builder={builder} />
      </div>
    </section>
  );
}

function ChatPane({ initialMessage }: { initialMessage?: string }) {
  const { siteId, chatContext } = useEditor();
  return (
    <section className="g-pane app-pane" aria-label="Assistant">
      <PaneHead paneId="chat" side="right" buttonAt="start">
        <ChatHeadActions siteId={siteId} />
      </PaneHead>
      <div className="app-pane__fill">
        <ChatPanel siteId={siteId} context={chatContext} initialMessage={initialMessage} />
      </div>
    </section>
  );
}

function EditorLayout() {
  useEntryHeader();
  const [params, setParams] = useSearchParams();
  // A request typed on Site home arrives as ?ask=…; hand it to the chat once and drop it from the URL.
  const ask = useRef(params.get("ask") ?? undefined);
  useEffect(() => {
    if (!params.has("ask")) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("ask");
        return next;
      },
      { replace: true },
    );
  }, [params, setParams]);

  return (
    <SplitPane id="editor" panes={PANES} className="app-editor">
      <FormPane />
      <PreviewPaneShell />
      <ChatPane initialMessage={ask.current} />
    </SplitPane>
  );
}

/** /sites/:siteId/edit?path=… — form · preview · assistant, each resizable and collapsible. */
export function EditorScreen() {
  const { siteId = "" } = useParams();
  return (
    <EditorProvider siteId={siteId}>
      <EditorLayout />
    </EditorProvider>
  );
}
