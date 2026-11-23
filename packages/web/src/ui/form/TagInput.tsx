import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useFieldControl } from "../Field";
import { Icon } from "../Icon";

export interface TagInputProps {
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (index: number) => void;
  /** Values seen elsewhere on the site, offered while typing. */
  suggestions?: string[];
  placeholder?: string;
  onFocus?: () => void;
  /** Accessible name when outside a <Field>. */
  label?: string;
}

/** Chips with a text box: Enter or comma adds, Backspace on an empty box removes the last chip. */
export function TagInput({ tags, onAdd, onRemove, suggestions = [], placeholder = "Add…", onFocus, label }: TagInputProps) {
  const field = useFieldControl();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState("");
  const offered = suggestions.filter((option) => !tags.includes(option));

  const add = () => {
    const tag = typed.trim().replace(/,$/, "").trim();
    if (!tag) return;
    if (!tags.includes(tag)) onAdd(tag);
    setTyped("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      if (!typed.trim()) return;
      event.preventDefault();
      add();
    } else if (event.key === "Backspace" && typed === "" && tags.length > 0) {
      event.preventDefault();
      onRemove(tags.length - 1);
    }
  };

  return (
    <div className="app-tags" onClick={(event) => event.target === event.currentTarget && input.current?.focus()}>
      <ul className="app-tags__list" aria-label={label ? `${label}: chosen` : "Chosen"}>
        {tags.map((tag, index) => (
          <li key={`${tag}-${index}`} className="app-tags__chip">
            <span>{tag}</span>
            <button type="button" className="app-tags__remove" aria-label={`Remove ${tag}`} onClick={() => onRemove(index)}>
              <Icon name="close" />
            </button>
          </li>
        ))}
      </ul>
      <input
        ref={input}
        className="app-tags__input"
        id={field?.id}
        aria-describedby={field?.describedBy}
        aria-label={field ? undefined : label}
        list={offered.length > 0 ? listId : undefined}
        value={typed}
        placeholder={tags.length === 0 ? placeholder : undefined}
        onChange={(event) => {
          const next = event.target.value;
          const native = event.nativeEvent;
          const picked = !(native instanceof InputEvent) || native.inputType === "insertReplacementText";
          // Choosing a suggestion (not typing it) takes it as a chip straight away.
          if (picked && offered.includes(next)) {
            onAdd(next);
            setTyped("");
            return;
          }
          setTyped(next);
        }}
        onKeyDown={onKeyDown}
        onBlur={add}
        onFocus={onFocus}
      />
      {offered.length > 0 ? (
        <datalist id={listId}>
          {offered.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}
