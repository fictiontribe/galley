import { useRef, useState, type KeyboardEvent } from "react";
import { SegmentedControl, Textarea } from "@/ui";
import { MarkdownPreview } from "@/ui/form/MarkdownPreview";
import { insertLink, toggleWrap, type TextEdit } from "@/ui/form/markdownText";
import { asText, useBinding } from "./binding";
import { placeholderFor, type FieldProps } from "./common";
import { FieldShell } from "./FieldShell";

const MODES = [
  { value: "write", label: "Write" },
  { value: "preview", label: "Preview" },
];

function isMod(event: KeyboardEvent): boolean {
  return navigator.platform.toLowerCase().includes("mac") ? event.metaKey : event.ctrlKey;
}

/** `markdown`: a small textarea that knows ⌘B, ⌘I and ⌘K, with a preview. */
export function MarkdownField({ field, path, showKey }: FieldProps) {
  const { value, change, commit, focus } = useBinding(field, path);
  const [mode, setMode] = useState("write");
  const area = useRef<HTMLTextAreaElement>(null);
  const text = asText(value);

  const apply = (edit: TextEdit) => {
    change(edit.text);
    requestAnimationFrame(() => area.current?.setSelectionRange(edit.start, edit.end));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isMod(event)) return;
    const el = event.currentTarget;
    const key = event.key.toLowerCase();
    if (key === "b") apply(toggleWrap(el.value, el.selectionStart, el.selectionEnd, "**"));
    else if (key === "i") apply(toggleWrap(el.value, el.selectionStart, el.selectionEnd, "*"));
    else if (key === "k") apply(insertLink(el.value, el.selectionStart, el.selectionEnd));
    else return;
    event.preventDefault();
  };

  return (
    // The switch sits in the label row as a part of it, not pulled up over it, where "Saved" and "Put back" would land under it.
    <FieldShell field={field} path={path} showKey={showKey} tools={<SegmentedControl label={`${field.label}: write or preview`} options={MODES} value={mode} onChange={setMode} />}>
      <div className="app-md-field">
        {mode === "write" ? (
          <Textarea
            ref={area}
            value={text}
            placeholder={placeholderFor(field)}
            maxRows={16}
            className="app-md-field__input"
            onChange={(event) => change(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={commit}
            onFocus={focus}
          />
        ) : (
          <MarkdownPreview markdown={text} className="app-md-field__preview" />
        )}
      </div>
    </FieldShell>
  );
}
