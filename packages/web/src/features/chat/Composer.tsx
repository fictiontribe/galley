import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { IconButton, Kbd, ProofMark } from "@/ui";
import { ACCEPTED_TYPES, ATTACHMENT_RULE } from "./attachments";

export interface PendingAttachment {
  id: string;
  name: string;
  mime: string;
  dataUrl: string;
}

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  /** A turn is running: Send becomes Stop. */
  busy: boolean;
  /** Sending isn't possible (no key yet, or a send in flight). */
  disabled: boolean;
  /** Typing isn't possible either (no key yet). The box is never disabled otherwise, so focus stays put. */
  locked: boolean;
  placeholder: string;
  /** Earlier requests, newest last, for ↑ on an empty box. */
  history: string[];
  attachments: PendingAttachment[];
  onAttach: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  /** Context chips, the mode switch: shown above the text. */
  top?: ReactNode;
  foot?: ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

const MAX_HEIGHT = 220;

/** Enter sends, Shift-Enter makes a new line, ↑ on an empty box brings back the last request. */
export function Composer({ value, onChange, onSend, onStop, busy, disabled, locked, placeholder, history, attachments, onAttach, onRemoveAttachment, top, foot, textareaRef }: ComposerProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [recall, setRecall] = useState<number | null>(null);

  // Grow with the text, up to a limit, then scroll.
  useLayoutEffect(() => {
    const area = textareaRef.current;
    if (!area) return;
    area.style.blockSize = "auto";
    area.style.blockSize = `${Math.min(MAX_HEIGHT, area.scrollHeight)}px`;
    area.style.overflowY = area.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [value, textareaRef]);

  const canSend = !disabled && !busy && (value.trim().length > 0 || attachments.length > 0);

  return (
    <div className="g-composer chat-composer">
      {top ? <div className="chat-composer__top">{top}</div> : null}
      {attachments.length > 0 ? (
        <ul className="chat-composer__files" aria-label="Attached images">
          {attachments.map((file) => (
            <li key={file.id} className="chat-file">
              <img src={file.dataUrl} alt="" className="chat-file__thumb" />
              <span className="chat-file__name" title={file.name}>
                {file.name}
              </span>
              <IconButton icon="close" label={`Remove ${file.name}`} size="sm" onClick={() => onRemoveAttachment(file.id)} />
            </li>
          ))}
        </ul>
      ) : null}
      <label className="g-sr" htmlFor="chat-composer">
        Ask for a change
      </label>
      <textarea
        id="chat-composer"
        ref={textareaRef}
        rows={2}
        value={value}
        placeholder={placeholder}
        disabled={locked && value === ""}
        onChange={(event) => {
          setRecall(null);
          onChange(event.target.value);
        }}
        onPaste={(event) => {
          const files = [...event.clipboardData.files];
          if (files.length > 0) {
            event.preventDefault();
            onAttach(files);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (canSend) onSend();
            return;
          }
          if (event.key === "ArrowUp" && history.length > 0 && (value === "" || recall !== null) && event.currentTarget.selectionStart === 0) {
            event.preventDefault();
            const next = recall === null ? history.length - 1 : Math.max(0, recall - 1);
            setRecall(next);
            onChange(history[next] ?? "");
            return;
          }
          if (event.key === "ArrowDown" && recall !== null) {
            event.preventDefault();
            const next = recall + 1;
            if (next >= history.length) {
              setRecall(null);
              onChange("");
            } else {
              setRecall(next);
              onChange(history[next] ?? "");
            }
          }
        }}
      />
      {busy ? (
        <button className="g-btn g-btn--secondary g-btn--sm chat-stop" type="button" onClick={onStop}>
          <span className="chat-stop__square" aria-hidden="true" />
          Stop
        </button>
      ) : (
        <button className="g-btn g-btn--primary g-btn--icon g-btn--sm" type="button" aria-label="Send" disabled={!canSend} onClick={onSend}>
          <ProofMark kind="send" />
        </button>
      )}
      <div className="g-composer__foot chat-composer__foot">
        <IconButton icon="image" label={`Attach images (${ATTACHMENT_RULE.charAt(0).toLowerCase()}${ATTACHMENT_RULE.slice(1)})`} onClick={() => fileInput.current?.click()} disabled={locked} />
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          multiple
          hidden
          onChange={(event) => {
            onAttach([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
        {foot}
        <span className="chat-composer__keys">
          <Kbd keys={["enter"]} /> to send · <Kbd keys={["shift", "enter"]} /> new line
        </span>
      </div>
    </div>
  );
}
