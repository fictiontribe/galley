import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import type { AgentMode, ChatContext, SendMessageRequest } from "@galley/core/types";
import { api, errorShape } from "@/lib/api";
import { invalidate, useQuery } from "@/lib/query";
import { useSite } from "@/lib/stores/site";
import { usePlaceWords } from "@/lib/where";
import { keys } from "@/lib/sync";
import { ConfirmDialog, EmptyState, ErrorState, IconButton, ProofMark, SegmentedControl, Skeleton, buttonClass } from "@/ui";
import { checkAttachments } from "./attachments";
import { useThreads } from "./ChatHeadActions";
import { Composer, type PendingAttachment } from "./Composer";
import { MessageView } from "./MessageView";
import { useChatUi } from "./store";
import { promptHistory, quickReplies } from "./threadState";
import { useThread } from "./useThread";
import { continueLine, lastConversation } from "./resume";
import "./chat.css";
import { SettingsLink } from "@/features/accounts/SettingsLink";
import { useMayBuild, useWhoPublishes } from "@/lib/may";

export interface ChatPanelProps {
  siteId: string;
  /** What the person is looking at: entry, page, selection. */
  context?: ChatContext;
  /** A request typed elsewhere (Site home), to send or place in the composer on open. */
  initialMessage?: string;
}

const MODES: Array<{ value: AgentMode; label: string; title: string }> = [
  { value: "content", label: "Content", title: "Changes pages, posts and images" },
  { value: "build", label: "Build", title: "Can also change the site’s design and code" },
];
const MODE_LINE: Record<AgentMode, string> = {
  content: "Changes pages, posts and images.",
  build: "Can also change the site’s design and code, and check the build.",
};
const STARTERS = ["Make this page’s heading shorter", "Fix any typos on this page", "Suggest a clearer introduction"];

let attachmentId = 0;
const readFile = (file: File) =>
  new Promise<PendingAttachment>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ id: `a${++attachmentId}`, name: file.name || "image", mime: file.type, dataUrl: String(reader.result) });
    reader.onerror = () => reject(reader.error ?? new Error("The file couldn’t be read."));
    reader.readAsDataURL(file);
  });

function NoKey() {
  const where = usePlaceWords();
  return (
    <div className="chat-nokey">
      <ProofMark kind="reg" className="chat-nokey__mark" />
      <h3 className="chat-nokey__title">Connect the assistant.</h3>
      <p className="chat-nokey__body">{`Paste an API key in Settings. It’s stored ${where.keyStore}. Until then you can still edit in the form and on the page.`}</p>
      <SettingsLink route="PUT /api/secrets/:name" className={buttonClass("primary", "sm")} to="/settings" fallback="An owner of this editor can connect it.">
        Open settings
      </SettingsLink>
    </div>
  );
}

/** The assistant: a conversation per request, streamed, with every change left in Proof and one click from undone. */
export function ChatPanel({ siteId, context, initialMessage }: ChatPanelProps) {
  const chosen = useChatUi((s) => s.threadBySite[siteId]);
  const setThread = useChatUi((s) => s.setThread);
  const buildConfirmed = useChatUi((s) => Boolean(s.buildConfirmed[siteId]));
  const confirmBuild = useChatUi((s) => s.confirmBuild);
  const draftOffer = useChatUi((s) => (s.draft?.siteId === siteId ? s.draft : null));
  // Build mode is offered only when the site allows it AND the person's role includes it; otherwise there is no toggle and no switch to it at all.
  const mayBuild = useMayBuild();
  const allowBuild = useSite((s) => s.detail?.model.ai.allowBuild ?? false) && mayBuild;
  const publishes = useWhoPublishes();
  const threads = useThreads(siteId);
  const settings = useQuery(keys.settings(), () => api("GET /api/settings"));
  const keyReady = settings.data ? settings.data.secrets.some((secret) => secret.name === "anthropic" && secret.configured) : null;

  // The first time a site's assistant opens, it continues the most recent conversation.
  useEffect(() => {
    if (chosen === undefined && threads.data) setThread(siteId, threads.data[0]?.id ?? null);
  }, [chosen, threads.data, siteId, setThread]);
  const threadId = chosen ?? null;
  const forget = useCallback(() => setThread(siteId, null), [siteId, setThread]);
  const { thread, status, error, adopt, retry } = useThread(siteId, threadId, forget);

  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [mode, setMode] = useState<AgentMode>("content");
  const [askBuild, setAskBuild] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [dropped, setDropped] = useState<{ page: boolean; selection: string | null }>({ page: false, selection: null });
  const composer = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    if (thread) setMode(thread.mode === "build" && allowBuild ? "build" : "content");
  }, [thread?.id]);
  // Build mode turned off for the site, or the role changed while the panel was open: the next request goes in content mode.
  useEffect(() => {
    if (!allowBuild && mode === "build") setMode("content");
  }, [allowBuild, mode]);

  const busy = Boolean(thread?.busy);
  const effective: ChatContext = {
    entryPath: context?.entryPath,
    urlPath: dropped.page ? undefined : context?.urlPath,
    selection: context?.selection && dropped.selection !== context.selection.text ? context.selection : undefined,
  };

  const send = useCallback(
    async (text: string, options: { fresh?: boolean; fromComposer?: boolean } = {}) => {
      const words = text.trim();
      if (!words && attachments.length === 0) return;
      if (keyReady === false) return;
      setSending(true);
      setSendError(null);
      try {
        let id = options.fresh ? null : threadId;
        if (!id) {
          const created = await api("POST /api/sites/:siteId/threads", { params: { siteId }, body: { mode } });
          adopt(created);
          setThread(siteId, created.id);
          invalidate(keys.threads(siteId));
          id = created.id;
        }
        const request: SendMessageRequest = {
          text: words || "Here are some images.",
          mode,
          context: effective,
          ...(attachments.length ? { attachments: attachments.map(({ name, mime, dataUrl }) => ({ name, mime, dataUrl })) } : {}),
        };
        await api("POST /api/sites/:siteId/threads/:threadId/messages", { params: { siteId, threadId: id }, body: request });
        stick.current = true;
        if (options.fromComposer) setDraft("");
        setAttachments([]);
        setProblems([]);
      } catch (failure) {
        const shape = errorShape(failure);
        if (shape.code === "unconfigured") void settings.refetch();
        setSendError(shape.message);
        if (!options.fromComposer) setDraft(words);
      } finally {
        setSending(false);
      }
    },
    [attachments, keyReady, threadId, siteId, mode, effective, adopt, setThread, settings],
  );

  // A request typed on Site home: sent once in a fresh conversation (or left in the box until the assistant is connected).
  const initialDone = useRef(false);
  useEffect(() => {
    if (initialDone.current || !initialMessage || keyReady === null) return;
    initialDone.current = true;
    if (keyReady) void send(initialMessage, { fresh: true });
    else setDraft(initialMessage);
  }, [initialMessage, keyReady, send]);

  // "Ask the assistant to change it" from the page.
  useEffect(() => {
    if (!draftOffer) return;
    setDraft(draftOffer.text);
    // A request that needs the site's code switches to build mode — after the usual question, the first time.
    if (draftOffer.mode === "build" && allowBuild) {
      if (buildConfirmed) setMode("build");
      else setAskBuild(true);
    }
    useChatUi.getState().clearDraft();
    requestAnimationFrame(() => {
      const area = composer.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    });
  }, [draftOffer]);

  // Follow the reply as it streams, unless the person scrolled up to read.
  useLayoutEffect(() => {
    if (stick.current && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [thread?.messages]);
  const lastMessage = thread?.messages[thread.messages.length - 1];
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) setAnnounce(lastMessage?.error ? "The assistant stopped." : "The assistant replied.");
    wasBusy.current = busy;
  }, [busy, lastMessage?.error]);

  const addFiles = async (files: File[]) => {
    const { accepted, problems: refused } = checkAttachments(files, attachments.length);
    setProblems(refused);
    try {
      const read = await Promise.all(accepted.map(readFile));
      setAttachments((current) => [...current, ...read]);
    } catch (failure) {
      setProblems((current) => [...current, `An image couldn’t be read. ${errorShape(failure).message}`]);
    }
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDropping(false);
    void addFiles([...event.dataTransfer.files]);
  };

  const options = quickReplies(thread);
  const stop = () => void (threadId ? api("POST /api/sites/:siteId/threads/:threadId/cancel", { params: { siteId, threadId } }).catch(() => undefined) : undefined);

  let content;
  if (keyReady === false && !thread) content = <NoKey />;
  else if (threadId && status === "loading" && !thread) {
    content = (
      <div className="g-chat" aria-busy="true">
        <Skeleton width="70%" height={40} />
        <Skeleton lines={3} />
      </div>
    );
  } else if (status === "error" && !thread) content = <ErrorState compact title="Couldn’t open this chat" error={error} onRetry={() => void retry()} />;
  else if (!thread || thread.messages.length === 0) {
    const earlier = lastConversation(threads.data, threadId);
    const line = earlier ? continueLine(earlier) : null;
    content = (
      <EmptyState compact mark="caret" title="Ask for a change." body="Say it in plain words. The assistant reads the page, makes the change, and leaves it in Proof for you to check.">
        {earlier && line ? (
          <button type="button" className="chat-continue" onClick={() => setThread(siteId, earlier.id)}>
            <span className="chat-continue__label">{line.label}</span>
            <span className="chat-continue__detail">{line.detail}</span>
          </button>
        ) : null}
        {keyReady ? (
          <div className="g-quick-replies chat-starters">
            {STARTERS.map((starter) => (
              <button key={starter} type="button" className="g-chip" onClick={() => setDraft(starter)}>
                {starter}
              </button>
            ))}
          </div>
        ) : null}
      </EmptyState>
    );
  } else {
    content = (
      <div className="g-chat" role="log" aria-label="Conversation" aria-busy={busy}>
        {keyReady === false ? <NoKey /> : null}
        {thread.messages.map((message) => (
          <MessageView key={message.id} siteId={siteId} threadId={thread.id} message={message} options={message === lastMessage ? options : []} onReply={(text) => void send(text)} disabled={busy || sending} />
        ))}
      </div>
    );
  }

  const chips = (
    <>
      {effective.urlPath ? (
        <span className="chat-chip" title="The assistant will be told which page you’re looking at">
          <ProofMark kind="reg" />
          <span className="chat-chip__text">Looking at {effective.urlPath}</span>
          <IconButton icon="close" label="Don’t mention this page" size="sm" tooltip={false} onClick={() => setDropped((current) => ({ ...current, page: true }))} />
        </span>
      ) : null}
      {effective.selection ? (
        <span className="chat-chip" title="The text you picked on the page">
          <ProofMark kind="caret" />
          <span className="chat-chip__text">“{effective.selection.text}”</span>
          <IconButton icon="close" label="Don’t mention the selected text" size="sm" tooltip={false} onClick={() => setDropped((current) => ({ ...current, selection: effective.selection?.text ?? null }))} />
        </span>
      ) : null}
    </>
  );

  return (
    <div
      className={dropping ? "chat chat--dropping" : "chat"}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDropping(false);
      }}
      onDrop={onDrop}
    >
      <div
        ref={body}
        className="g-pane__body chat-body"
        onScroll={(event) => {
          const element = event.currentTarget;
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
      >
        {content}
      </div>
      <p className="g-sr" role="status" aria-live="polite">
        {announce}
      </p>
      <div className="g-pane__foot chat-foot">
        {allowBuild ? (
          <div className="chat-mode">
            <SegmentedControl
              label="What the assistant may change"
              options={MODES}
              value={mode}
              onChange={(next) => {
                if (next === "build" && !buildConfirmed) setAskBuild(true);
                else setMode(next);
              }}
            />
            <span className="chat-mode__line">{MODE_LINE[mode]}</span>
          </div>
        ) : null}
        {sendError ? (
          <p className="g-error-text chat-send-error" role="alert">
            <ProofMark kind="bang" />
            <span>{sendError}</span>
          </p>
        ) : null}
        {problems.map((problem) => (
          <p key={problem} className="g-error-text" role="alert">
            <ProofMark kind="bang" />
            <span>{problem}</span>
          </p>
        ))}
        <Composer
          textareaRef={composer}
          value={draft}
          onChange={setDraft}
          onSend={() => void send(draft, { fromComposer: true })}
          onStop={stop}
          busy={busy}
          disabled={sending || keyReady === false}
          locked={keyReady === false}
          placeholder={keyReady === false ? "Connect the assistant to ask for changes" : busy ? "Working… you can type the next request" : "Ask for a change…"}
          history={promptHistory(thread)}
          attachments={attachments}
          onAttach={(files) => void addFiles(files)}
          onRemoveAttachment={(id) => setAttachments((current) => current.filter((file) => file.id !== id))}
          top={effective.urlPath || effective.selection ? chips : undefined}
        />
      </div>
      <ConfirmDialog
        open={askBuild}
        onClose={() => setAskBuild(false)}
        tone="primary"
        title="Let the assistant change the site’s code?"
        body={`In build mode the assistant can also change the site’s design — its layouts, components and styles — and run the site’s build to check its work. Every change still waits in Proof until ${publishes}.`}
        confirmLabel="Use build mode"
        cancelLabel="Keep content mode"
        onConfirm={() => {
          confirmBuild(siteId);
          setMode("build");
        }}
      />
    </div>
  );
}
