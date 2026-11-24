import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ChatAttachment, ChatMessage, ChatOption, ToolActivity } from "@galley/core/types";
import { api, errorShape, rawFileUrl } from "@/lib/api";
import { count } from "@/lib/format";
import { useMayBuild } from "@/lib/may";
import { useNameOf } from "@/lib/names";
import { Button, ProofMark } from "@/ui";
import { Markdown } from "./Markdown";
import { activityKind } from "./threadState";
import { undoneNote, undoRefusal } from "./undone";

function Activity({ tool }: { tool: ToolActivity }) {
  const kind = activityKind(tool);
  const className = { running: "g-activity--running", read: "g-activity--done", edit: "g-activity--edit", remove: "g-activity--remove", failed: "g-activity--failed" }[kind];
  return (
    <div className={`g-activity ${className}`} title={tool.detail ?? tool.label}>
      {kind === "running" ? (
        <span className="g-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : (
        <ProofMark kind={kind === "read" ? "stet" : kind === "edit" ? "caret" : kind === "remove" ? "dele" : "bang"} />
      )}
      <span className="g-activity__text">
        {tool.label}
        {kind === "failed" && tool.detail ? ` — ${tool.detail}` : null}
      </span>
    </div>
  );
}

function Thumbnails({ siteId, attachments }: { siteId: string; attachments: ChatAttachment[] }) {
  return (
    <div className="chat-thumbs">
      {attachments.map((attachment, index) =>
        attachment.path ? <img key={index} className="chat-thumb" src={rawFileUrl(siteId, attachment.path)} alt={attachment.name} loading="lazy" /> : <span key={index} className="g-tag">{attachment.name}</span>,
      )}
    </div>
  );
}

function TurnActions({ siteId, threadId, message }: { siteId: string; threadId: string; message: ChatMessage }) {
  const navigate = useNavigate();
  const nameOf = useNameOf();
  // Not offered where it would be refused: the reason stands in the button's place.
  const refusal = undoRefusal(message, useMayBuild());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const changed = message.changedPaths ?? [];
  if (changed.length === 0 || message.pending) return null;
  if (message.undone) {
    const left = message.undoLeft ?? [];
    const note = (
      <p className="chat-turn__note">
        <ProofMark kind={left.length ? "bang" : "stet"} />
        <span>
          {undoneNote(
            left.map((path) => nameOf({ path })),
            // A page it left may be one the reply wrote too late to be counted among its changes.
            changed.some((path) => !left.includes(path)),
          )}
        </span>
      </p>
    );
    if (left.length === 0) return note;
    return (
      <div className="chat-turn">
        {note}
        <div className="chat-turn__actions">
          <Button size="sm" variant="secondary" icon="proof" onClick={() => navigate(`/sites/${siteId}/proof?path=${encodeURIComponent(left[0] ?? "")}`)}>
            Review in Proof
          </Button>
        </div>
      </div>
    );
  }
  const undo = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api("POST /api/sites/:siteId/threads/:threadId/undo", { params: { siteId, threadId }, body: { turnId: message.turnId } });
    } catch (error) {
      setProblem(errorShape(error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="chat-turn">
      <div className="chat-turn__actions">
        <Button size="sm" variant="secondary" icon="proof" onClick={() => navigate(`/sites/${siteId}/proof?path=${encodeURIComponent(changed[0] ?? "")}`)}>
          Review in Proof
        </Button>
        {refusal ? null : (
          <Button size="sm" variant="quiet" icon="undo" busy={busy} busyLabel="Undoing" onClick={() => void undo()}>
            {changed.length === 1 ? "Undo this change" : `Undo these ${count(changed.length, "change")}`}
          </Button>
        )}
      </div>
      {refusal ? (
        <p className="chat-turn__note">
          <ProofMark kind="bang" />
          <span>{refusal}</span>
        </p>
      ) : null}
      {problem ? (
        <p className="g-error-text" role="alert">
          <ProofMark kind="bang" />
          <span>{problem}</span>
        </p>
      ) : null}
    </div>
  );
}

export interface MessageViewProps {
  siteId: string;
  threadId: string;
  message: ChatMessage;
  /** Quick replies, shown on the last question only. */
  options: ChatOption[];
  onReply: (text: string) => void;
  disabled: boolean;
}

/** One message: the person's words, or the assistant's tool lines, reply, question and turn actions. */
export function MessageView({ siteId, threadId, message, options, onReply, disabled }: MessageViewProps) {
  if (message.role === "user") {
    return (
      <div className="g-msg g-msg--user">
        {message.attachments?.length ? <Thumbnails siteId={siteId} attachments={message.attachments} /> : null}
        <p className="chat-user-text">{message.text}</p>
      </div>
    );
  }
  const waiting = message.pending && !message.text && !(message.tools ?? []).length;
  return (
    <div className="g-msg g-msg--assistant">
      <span className="g-msg__by" aria-hidden="true" />
      <div className="g-msg__body">
        <span className="g-sr">The assistant:</span>
        {(message.tools ?? []).map((tool) => (
          <Activity key={tool.id} tool={tool} />
        ))}
        {waiting ? (
          <div className="g-activity g-activity--running">
            <span className="g-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="g-activity__text">Reading the page</span>
          </div>
        ) : null}
        {message.text ? <Markdown text={message.text} /> : null}
        {message.error && message.error !== message.text ? (
          <p className="g-error-text chat-error">
            <ProofMark kind="bang" />
            <span>{message.error}</span>
          </p>
        ) : null}
        {options.length > 0 ? (
          <div className="g-quick-replies" role="group" aria-label="Answers">
            {options.map((option) => (
              <button key={option.label} type="button" className="g-chip" disabled={disabled} title={option.detail} onClick={() => onReply(option.label)}>
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
        <TurnActions siteId={siteId} threadId={threadId} message={message} />
      </div>
    </div>
  );
}
