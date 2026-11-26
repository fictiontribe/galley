import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Skeleton } from "../Skeleton";
import { cx } from "../cx";
import type { CodeLanguage, EditorControl } from "./codemirror";
import type { TextEdit } from "./markdownText";

export interface CodeEditorHandle {
  edit: (make: (text: string, start: number, end: number) => TextEdit) => void;
  focus: () => void;
  view?: () => EditorView | null;
}

export interface CodeEditorProps {
  value: string;
  onChange: (text: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  language: CodeLanguage;
  /** Accessible name of the text area. */
  label: string;
  /** "prose": the serif writing face for long text. "code": mono, for source. */
  variant?: "prose" | "code";
  placeholder?: string;
  shortcuts?: boolean;
  className?: string;
  handle?: Ref<CodeEditorHandle>;
  /** Labelled-by / described-by ids, when the editor sits inside a field. */
  describedBy?: string;
  /** Optional extra CodeMirror extensions. */
  extensions?: Extension[];
  /** When true, the editor shows its text read-only. */
  readOnly?: boolean;
  /** When true, external `value` prop syncing is suppressed (managed by an extension). */
  managedValue?: boolean;
  /** Called once the underlying CodeMirror view mounts and with null on unmount. */
  onView?: (view: EditorView | null) => void;
}

/**
 * CodeMirror 6, loaded on first use. Outside changes to `value` are applied
 * only while the editor isn't focused, so typing is never overwritten.
 */
export function CodeEditor({
  value,
  onChange,
  onFocus,
  onBlur,
  language,
  label,
  variant = "code",
  placeholder,
  shortcuts,
  className,
  handle,
  describedBy,
  extensions,
  readOnly = false,
  managedValue = false,
  onView,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const control = useRef<EditorControl | null>(null);
  const [ready, setReady] = useState(false);
  const callbacks = useRef({ onChange, onFocus, onBlur, onView });
  callbacks.current = { onChange, onFocus, onBlur, onView };
  const latest = useRef({ value, extensions, readOnly });
  latest.current = { value, extensions, readOnly };

  useEffect(() => {
    let live = true;
    void import("./codemirror").then(({ createEditor }) => {
      if (!live || !host.current) return;
      control.current = createEditor({
        parent: host.current,
        value: latest.current.value,
        language,
        label,
        placeholder,
        shortcuts,
        extra: latest.current.extensions,
        readOnly: latest.current.readOnly,
        onChange: (text) => callbacks.current.onChange(text),
        onFocus: () => callbacks.current.onFocus?.(),
        onBlur: () => callbacks.current.onBlur?.(),
      });
      callbacks.current.onView?.(control.current.view());
      setReady(true);
    });
    return () => {
      live = false;
      callbacks.current.onView?.(null);
      control.current?.destroy();
      control.current = null;
    };
    // The editor is built once per language; value changes flow through setValue below.
  }, [language, label, placeholder, shortcuts]);

  useEffect(() => {
    const editor = control.current;
    if (editor && !managedValue && !editor.hasFocus()) editor.setValue(value);
  }, [value, ready, managedValue]);

  useEffect(() => {
    control.current?.setExtra(extensions ?? []);
  }, [extensions, ready]);

  useEffect(() => {
    control.current?.setReadOnly(readOnly);
  }, [readOnly, ready]);

  useImperativeHandle(handle, () => ({
    edit: (make) => control.current?.edit(make),
    focus: () => control.current?.focus(),
    view: () => control.current?.view() ?? null,
  }));

  return (
    <div className={cx("app-cm", `app-cm--${variant}`, className)} aria-describedby={describedBy} aria-busy={!ready || undefined}>
      {!ready ? <Skeleton lines={4} className="app-cm__loading" /> : null}
      <div ref={host} className="app-cm__host" />
    </div>
  );
}
