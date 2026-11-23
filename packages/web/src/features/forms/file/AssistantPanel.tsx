import { useEffect, useRef } from "react";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { ChatHeadActions } from "@/features/chat/ChatHeadActions";
import { useChatUi } from "@/features/chat/store";
import { IconButton } from "@/ui";
import { useAssistantPanel } from "./assistant";

export interface AssistantPanelProps {
  siteId: string;
  /** The file the assistant is told the person is working on. */
  entryPath?: string;
}

/**
 * The assistant as a panel at the side of a builder screen. It edits the same
 * file through its normal tools; the screen shows each change as it lands.
 */
export function AssistantPanel({ siteId, entryPath }: AssistantPanelProps) {
  const open = useAssistantPanel((s) => s.open);
  const request = useAssistantPanel((s) => s.request);
  const hide = useAssistantPanel((s) => s.hide);
  const panel = useRef<HTMLElement>(null);

  // A request to finish in the box (rather than send) goes through the chat's own draft hand-off.
  useEffect(() => {
    if (open && request?.draft) useChatUi.getState().offerDraft(siteId, request.draft, request.mode);
  }, [open, request, siteId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && panel.current?.contains(document.activeElement)) hide();
    };
    window.addEventListener("keydown", onKey);
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("textarea")?.focus());
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hide]);

  if (!open) return null;
  return (
    <aside ref={panel} className="g-pane kit-assistant" aria-label="Assistant">
      <div className="g-pane__head kit-assistant__head">
        <span className="kit-assistant__title">Assistant</span>
        <span className="g-toolbar__spacer" />
        <ChatHeadActions siteId={siteId} />
        <IconButton icon="close" label="Close the assistant" onClick={hide} />
      </div>
      <div className="kit-assistant__body">
        <ChatPanel key={request?.send ? request.nonce : "panel"} siteId={siteId} context={entryPath ? { entryPath } : undefined} initialMessage={request?.send} />
      </div>
    </aside>
  );
}
