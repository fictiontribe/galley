import { useCallback, useRef, useState } from "react";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { BodyAddonAdditions } from "@/additions/places";
import { count } from "@/lib/format";
import { ProofMark, keyName } from "@/ui";
import { CodeEditor, type CodeEditorHandle } from "@/ui/form/CodeEditor";
import { insertLink, toggleLinePrefix, toggleWrap, wordCount } from "@/ui/form/markdownText";
import { ToolButton } from "@/ui/form/ToolButton";
import type { FormIconName } from "@/ui/form/FormIcon";
import { useBodyChanged, useForm, useFormState } from "../form/context";
import { BODY_KEY } from "../form/store";

interface Tool {
  icon: FormIconName;
  label: string;
  keys?: string;
  run: (handle: CodeEditorHandle) => void;
}

const MOD = keyName("mod");

const TOOLS: Tool[] = [
  { icon: "heading", label: "Heading", keys: `${MOD}⌥2`, run: (h) => h.edit((t, s, e) => toggleLinePrefix(t, s, e, "## ")) },
  { icon: "bold", label: "Bold", keys: `${MOD}B`, run: (h) => h.edit((t, s, e) => toggleWrap(t, s, e, "**")) },
  { icon: "italic", label: "Italic", keys: `${MOD}I`, run: (h) => h.edit((t, s, e) => toggleWrap(t, s, e, "*")) },
  { icon: "link", label: "Link", keys: `${MOD}K`, run: (h) => h.edit((t, s, e) => insertLink(t, s, e)) },
  { icon: "list-bullet", label: "Bulleted list", keys: `${MOD}⇧8`, run: (h) => h.edit((t, s, e) => toggleLinePrefix(t, s, e, "- ")) },
  { icon: "list-number", label: "Numbered list", run: (h) => h.edit((t, s, e) => toggleLinePrefix(t, s, e, "1. ")) },
  { icon: "quote", label: "Quote", keys: `${MOD}⇧9`, run: (h) => h.edit((t, s, e) => toggleLinePrefix(t, s, e, "> ")) },
  { icon: "code", label: "Code", keys: `${MOD}E`, run: (h) => h.edit((t, s, e) => toggleWrap(t, s, e, "`")) },
];

function BodyState() {
  const state = useFormState((s) => s.saveState[BODY_KEY]);
  const refusal = useFormState((s) => s.refusals[BODY_KEY]);
  if (refusal) {
    return (
      <span className="g-error-text">
        <ProofMark kind="bang" />
        {refusal}
      </span>
    );
  }
  if (!state) return null;
  return <span className={`app-save-note app-save-note--${state}`}>{state === "saving" ? "Saving…" : "Saved"}</span>;
}

/** The main text: CodeMirror in the writing face, a formatting toolbar, images from media, a word count. */
export function BodyEditor() {
  const { store, siteId, entryPath, pickImage, select } = useForm();
  const body = useFormState((s) => s.body ?? "");
  const edited = useBodyChanged();
  const handle = useRef<CodeEditorHandle | null>(null);
  const [cmView, setCmView] = useState<EditorView | null>(null);
  const [extraExtensions, setExtraExtensions] = useState<Extension[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [managedValue, setManagedValue] = useState(false);
  const onExtensions = useCallback((next: Extension[]) => setExtraExtensions(next), []);
  const onReadOnly = useCallback((next: boolean) => setReadOnly(next), []);
  const onManagedValue = useCallback((next: boolean) => setManagedValue(next), []);

  const insertImage = async () => {
    const url = await pickImage();
    if (!url) return;
    handle.current?.edit((text, start, end) => {
      const alt = text.slice(start, end);
      const snippet = `![${alt}](${url})`;
      const caret = start + 2;
      return { text: text.slice(0, start) + snippet + text.slice(end), start: caret, end: caret + alt.length };
    });
  };

  return (
    <section className="app-body" aria-labelledby="body-label" data-path={BODY_KEY}>
      <div className="g-field__head app-body__head">
        <span className="g-label" id="body-label">
          Main text
        </span>
        {edited ? (
          <span className="g-field__state">
            <ProofMark kind="caret" />
            Edited
          </span>
        ) : null}
        <span className="app-field-aside">
          <BodyState />
        </span>
      </div>
      <BodyAddonAdditions
        siteId={siteId}
        entryPath={entryPath}
        store={store}
        view={cmView}
        setExtensions={onExtensions}
        setReadOnly={onReadOnly}
        setManagedValue={onManagedValue}
      />
      <div className="app-body__frame">
        <div className="app-body__toolbar" role="toolbar" aria-label="Formatting">
          {TOOLS.map((tool) => (
            <ToolButton key={tool.label} icon={tool.icon} label={tool.label} shortcut={tool.keys} disabled={readOnly} onClick={() => handle.current && tool.run(handle.current)} />
          ))}
          <ToolButton icon="image" label="Image from media" disabled={readOnly} onClick={() => void insertImage()} className="app-body__image" />
        </div>
        <CodeEditor
          handle={handle}
          value={body}
          language="markdown"
          variant="prose"
          shortcuts
          label="Main text"
          placeholder="Write the main text here…"
          extensions={extraExtensions}
          readOnly={readOnly}
          managedValue={managedValue}
          onView={setCmView}
          onChange={(text) => {
            if (!managedValue) store.actions.editBody(text);
          }}
          onBlur={() => {
            if (!managedValue) store.actions.commitBody();
          }}
          onFocus={() => select("Main text")}
        />
        <div className="app-body__foot">
          <span>{count(wordCount(body), "word")}</span>
          <span className="g-faint">{MOD}B bold · {MOD}I italic · {MOD}K link</span>
        </div>
      </div>
    </section>
  );
}
