import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatThreadSummary } from "@galley/core/types";
import { api, errorShape } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { getQueryState, invalidate, setQueryData, useQuery } from "@/lib/query";
import { notify } from "@/lib/stores/toasts";
import { keys } from "@/lib/sync";
import { ConfirmDialog, Icon, IconButton, Menu, type MenuItem } from "@/ui";
import { useChatUi } from "./store";

/** The conversations of a site, most recent first. */
export function useThreads(siteId: string) {
  return useQuery(keys.threads(siteId), async () => {
    const { threads } = await api("GET /api/sites/:siteId/threads", { params: { siteId } });
    return [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
  });
}

const RECENT = 8;

/** The chat's name, retyped in place. Enter or leaving the field saves; Escape keeps the old name. */
function RenameField({ siteId, thread, onDone }: { siteId: string; thread: ChatThreadSummary; onDone: () => void }) {
  const [value, setValue] = useState(thread.title);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (settled.current) return;
    const title = value.trim().replace(/\s+/g, " ");
    if (!title || title === thread.title) {
      settled.current = true;
      onDone();
      return;
    }
    settled.current = true;
    setBusy(true);
    try {
      const updated = await api("PATCH /api/sites/:siteId/threads/:threadId", { params: { siteId, threadId: thread.id }, body: { title } });
      const list = getQueryState<ChatThreadSummary[]>(keys.threads(siteId)).data;
      if (list) setQueryData(keys.threads(siteId), list.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
      invalidate(keys.threads(siteId));
    } catch (error) {
      notify({ tone: "danger", title: "Couldn’t rename the chat", body: errorShape(error).message });
    } finally {
      setBusy(false);
      onDone();
    }
  };

  return (
    <form className="chat-head__rename" onSubmit={(event) => void save(event)}>
      <input
        ref={input}
        className="g-input g-input--sm chat-head__rename-input"
        aria-label="Chat name"
        value={value}
        maxLength={120}
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            settled.current = true;
            onDone();
          }
        }}
      />
    </form>
  );
}

/** In the assistant pane's head: which conversation this is, a new one, recent ones, delete. */
export function ChatHeadActions({ siteId }: { siteId: string }) {
  const threads = useThreads(siteId);
  const current = useChatUi((s) => s.threadBySite[siteId] ?? null);
  const setThread = useChatUi((s) => s.setThread);
  const [deleting, setDeleting] = useState<ChatThreadSummary | null>(null);
  const [renaming, setRenaming] = useState(false);
  const menuButton = useRef<HTMLButtonElement | null>(null);
  const list = threads.data ?? [];
  const open = list.find((thread) => thread.id === current) ?? null;

  const items: MenuItem[] = [
    { id: "new", label: "New chat", icon: "plus", onSelect: () => setThread(siteId, null) },
    ...(list.length > 0 ? [{ kind: "heading" as const, id: "recent", label: "Recent chats" }] : []),
    ...list.slice(0, RECENT).map(
      (thread): MenuItem => ({
        id: thread.id,
        label: thread.title,
        hint: relativeTime(thread.updatedAt),
        current: thread.id === current,
        onSelect: () => setThread(siteId, thread.id),
      }),
    ),
    ...(open
      ? [
          { kind: "separator" as const, id: "sep" },
          { id: "rename", label: "Rename this chat…", onSelect: () => setRenaming(true) },
          { id: "delete", label: "Delete this chat…", icon: "trash" as const, tone: "danger" as const, onSelect: () => setDeleting(open) },
        ]
      : []),
  ];

  return (
    <>
      {renaming && open ? (
        <RenameField
          siteId={siteId}
          thread={open}
          onDone={() => {
            setRenaming(false);
            requestAnimationFrame(() => menuButton.current?.focus());
          }}
        />
      ) : (
        <span className="chat-head__title" title={open?.title}>
          {open?.title ?? "Assistant"}
        </span>
      )}
      {renaming ? null : <span className="g-toolbar__spacer" />}
      <IconButton icon="plus" label="New chat" disabled={current === null} onClick={() => setThread(siteId, null)} tooltipSide="bottom" />
      <Menu
        label="Chats"
        placement="bottom-end"
        items={items}
        trigger={(props) => (
          <button
            type="button"
            className="g-btn g-btn--quiet g-btn--sm g-btn--icon"
            aria-label="Chats"
            {...props}
            ref={(node) => {
              menuButton.current = node;
              props.ref.current = node;
            }}
          >
            <Icon name="history" />
          </button>
        )}
      />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.title ?? "this chat"}”?`}
        body="The conversation goes away. Changes it made stay where they are — in Proof, or published."
        confirmLabel="Delete chat"
        busyLabel="Deleting…"
        errorTitle="Couldn’t delete the chat"
        onConfirm={async () => {
          if (!deleting) return;
          await api("DELETE /api/sites/:siteId/threads/:threadId", { params: { siteId, threadId: deleting.id } });
          if (current === deleting.id) setThread(siteId, null);
          invalidate(keys.threads(siteId));
        }}
      />
    </>
  );
}
