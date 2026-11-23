import { useId, useRef, useState, type FormEvent } from "react";
import { Button, ProofMark } from "@/ui";
import { useAssistantPanel, useAssistantReady } from "./assistant";

export interface AskBoxProps {
  /** What the request is about, for the box's label ("this form"). */
  subject: string;
  /** Prefixed to the request so the assistant knows which file it's about. */
  context: string;
  examples: readonly string[];
  placeholder: string;
}

/** A compact "Ask" line: the request opens the assistant beside the screen and is sent with this file as its context. */
export function AskBox({ subject, context, examples, placeholder }: AskBoxProps) {
  const [text, setText] = useState("");
  const show = useAssistantPanel((s) => s.show);
  const ready = useAssistantReady();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);

  const ask = (request: string) => {
    const words = request.trim();
    if (!words) return;
    show({ send: `${context} ${words}` });
    setText("");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    ask(text);
  };

  return (
    <form className="kit-ask" onSubmit={submit} aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="kit-ask__label">
        <ProofMark kind="caret" />
        Ask about {subject}
      </span>
      <input
        ref={input}
        className="g-input g-input--sm kit-ask__input"
        aria-labelledby={`${id}-label`}
        placeholder={ready === false ? "Connect the assistant in Settings to ask for changes" : placeholder}
        value={text}
        disabled={ready === false}
        onChange={(event) => setText(event.target.value)}
      />
      <Button size="sm" type="submit" disabled={!text.trim() || ready === false}>
        Ask
      </Button>
      {ready !== false ? (
        <span className="kit-ask__chips">
          {examples.map((example) => (
            <button key={example} type="button" className="g-chip kit-ask__chip" onClick={() => {
                setText(example);
                input.current?.focus();
              }}>
              {example}
            </button>
          ))}
        </span>
      ) : null}
    </form>
  );
}
