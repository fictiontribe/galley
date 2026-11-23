import { useId, useRef } from "react";
import type { FieldPath } from "@galley/core/types";
import type { FormField } from "@galley/core/kit";
import { useFormValue } from "@/features/content/form/context";
import { ToolButton } from "@/ui/form/ToolButton";
import { Field, Menu, Textarea, type MenuItem } from "@/ui";
import { wrapSelection } from "../logic/inline";
import { settingText } from "../logic/json";
import { sendableFields } from "../logic/mapping";
import { useEdits } from "../file/hooks";

export interface MessageEditorProps {
  path: FieldPath;
  label: string;
  fields: readonly FormField[];
  hint?: string;
}

/** The thank-you text, with bold, italic, links, and "insert a field's answer" (`{{field}}`). */
export function MessageEditor({ path, label, fields, hint }: MessageEditorProps) {
  const edits = useEdits();
  const value = settingText(useFormValue(path));
  const area = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();

  const replace = (make: (text: string, start: number, end: number) => { text: string; start: number; end: number }) => {
    const element = area.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    const next = make(value, start, end);
    edits.type(path, next.text, true);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(next.start, next.end);
    });
  };
  const answers: MenuItem[] = sendableFields(fields)
    .filter((field) => field.type !== "hidden")
    .map((field) => ({
      id: field.id,
      label: field.label?.trim() || field.id,
      hint: `{{${field.id}}}`,
      onSelect: () =>
        replace((text, start, end) => {
          const token = `{{${field.id}}}`;
          return { text: `${text.slice(0, start)}${token}${text.slice(end)}`, start: start + token.length, end: start + token.length };
        }),
    }));

  return (
    <Field label={label} hint={hint}>
      <div className="kit-message">
        <div className="kit-message__bar" role="toolbar" aria-label="Formatting">
          <ToolButton icon="bold" label="Bold" onClick={() => replace((text, start, end) => wrapSelection(text, start, end, "**"))} />
          <ToolButton icon="italic" label="Italic" onClick={() => replace((text, start, end) => wrapSelection(text, start, end, "*"))} />
          <ToolButton icon="link" label="Link" onClick={() => replace((text, start, end) => wrapSelection(text, start, end, "[", "](/)", "link text"))} />
          <span className="g-toolbar__spacer" />
          <Menu
            label="Insert an answer"
            items={answers.length ? answers : [{ id: "none", label: "No fields to quote yet", disabled: true, onSelect: () => undefined }]}
            placement="bottom-end"
            trigger={(props) => (
              <button {...props} type="button" className="g-btn g-btn--quiet g-btn--sm">
                Insert an answer
              </button>
            )}
          />
        </div>
        <Textarea ref={area} value={value} rows={3} maxRows={10} aria-describedby={hintId} onChange={(event) => edits.type(path, event.target.value, true)} onBlur={() => edits.commit(path)} />
        <span id={hintId} className="g-sr">
          Answers appear where you put their names in double braces.
        </span>
      </div>
    </Field>
  );
}
