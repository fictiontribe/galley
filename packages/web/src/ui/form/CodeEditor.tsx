import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Skeleton } from "../Skeleton";
import { cx } from "../cx";
import type { CodeLanguage, EditorControl } from "./codemirror";
import type { TextEdit } from "./markdownText";

export interface CodeEditorHandle {
  edit: (make: (text: string, start: number, end: number) => TextEdit) => void;
  focus: () => void;
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
}

/**
 * CodeMirror 6, loaded on first use. Outside changes to `value` are applied
 * only while the editor isn't focused, so typing is never overwritten.
 */
export function CodeEditor({ value, onChange, onFocus, onBlur, language, label, variant = "code", placeholder, shortcuts, className, handle, describedBy }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const control = useRef<EditorControl | null>(null);
  const [ready, setReady] = useState(false);
  const callbacks = useRef({ onChange, onFocus, onBlur });
  callbacks.current = { onChange, onFocus, onBlur };
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    let live = true;
    void import("./codemirror").then(({ createEditor }) => {
      if (!live || !host.current) return;
      control.current = createEditor({
        parent: host.current,
        value: latest.current,
        language,
        label,
        placeholder,
        shortcuts,
        onChange: (text) => callbacks.current.onChange(text),
        onFocus: () => callbacks.current.onFocus?.(),
        onBlur: () => callbacks.current.onBlur?.(),
      });
      setReady(true);
    });
    return () => {
      live = false;
      control.current?.destroy();
      control.current = null;
    };
    // The editor is built once per language; value changes flow through setValue below.
  }, [language, label, placeholder, shortcuts]);

  useEffect(() => {
    const editor = control.current;
    if (editor && !editor.hasFocus()) editor.setValue(value);
  }, [value, ready]);

  useImperativeHandle(handle, () => ({
    edit: (make) => control.current?.edit(make),
    focus: () => control.current?.focus(),
  }));

  return (
    <div className={cx("app-cm", `app-cm--${variant}`, className)} aria-describedby={describedBy} aria-busy={!ready || undefined}>
      {!ready ? <Skeleton lines={4} className="app-cm__loading" /> : null}
      <div ref={host} className="app-cm__host" />
    </div>
  );
}
