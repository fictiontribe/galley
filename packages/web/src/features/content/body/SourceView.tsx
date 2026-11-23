import { useEffect, useRef, useState } from "react";
import type { EntryFormat } from "@galley/core/types";
import { errorShape } from "@/lib/api";
import { ErrorState, ProofMark } from "@/ui";
import { CodeEditor } from "@/ui/form/CodeEditor";
import type { CodeLanguage } from "@/ui/form/codemirror";
import { useForm } from "../form/context";

const IDLE_MS = 800;

function languageFor(format: EntryFormat): CodeLanguage {
  if (format === "json") return "json";
  if (format === "yaml" || format === "toml") return "yaml";
  return "frontmatter";
}

export interface SourceViewProps {
  raw: string;
  format: EntryFormat;
}

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "unreadable"; detail: string } | { kind: "failed"; error: unknown };

/**
 * The whole file as text, for people who want it. Saved 0.8 s after typing
 * stops, as one replacement of the file; text the engine can't read is not
 * saved and the reason is shown.
 */
export function SourceView({ raw, format }: SourceViewProps) {
  const { store } = useForm();
  const [text, setText] = useState(raw);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(text);
  latest.current = text;

  const save = async (value: string) => {
    setStatus({ kind: "saving" });
    try {
      const result = await store.actions.saveRaw(value);
      const refused = result.refused[0];
      if (refused) setStatus({ kind: "unreadable", detail: refused.reason });
      else setStatus({ kind: "saved" });
    } catch (error) {
      setStatus({ kind: "failed", error });
    }
  };

  // Leaving source view sends what's typed, so nothing is lost on the way back to the form.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void store.actions.saveRaw(latest.current);
      }
    },
    [store],
  );

  return (
    <div className="app-source">
      <p className="g-margin-note app-source__note">
        <ProofMark kind="stet" />
        <span>The whole file, as text. Changes save as you type; the form picks them up when you go back.</span>
      </p>
      {status.kind === "unreadable" ? (
        <ErrorState
          compact
          title="This can’t be read yet, so the last change isn’t saved"
          message="Check the line it points to — often a missing quote, colon or indent. The form keeps the last version that could be read."
          detail={status.detail}
        />
      ) : null}
      {status.kind === "failed" ? <ErrorState compact title="Couldn’t save the file" error={status.error} message={`${errorShape(status.error).message} What you typed is still here.`} onRetry={() => void save(latest.current)} /> : null}
      <CodeEditor
        value={text}
        language={languageFor(format)}
        label="File source"
        className="app-source__editor"
        onChange={(next) => {
          setText(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            timer.current = null;
            void save(next);
          }, IDLE_MS);
        }}
      />
      <p className="app-source__status g-hint" role="status">
        {status.kind === "saving" ? "Saving…" : status.kind === "saved" ? "Saved" : ""}
      </p>
    </div>
  );
}
