/**
 * CodeMirror, in its own chunk: only loaded when a body, source or JSON
 * editor is on screen. Colours come from the brand tokens (styles/content.css
 * styles the `app-cm-*` classes these decorations add).
 */
import { minimalSetup } from "codemirror";
import { EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, MatchDecorator, ViewPlugin, keymap, placeholder as placeholderExt, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { insertLink, toggleLinePrefix, toggleWrap, type TextEdit } from "./markdownText";
import { minimalChange } from "./minimalChange";

export type CodeLanguage = "markdown" | "yaml" | "json" | "frontmatter";

export interface EditorOptions {
  parent: HTMLElement;
  value: string;
  language: CodeLanguage;
  label: string;
  placeholder?: string;
  /** Markdown shortcuts (⌘B, ⌘I, ⌘K…). */
  shortcuts?: boolean;
  onChange: (text: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export interface EditorControl {
  setValue: (text: string) => void;
  hasFocus: () => boolean;
  focus: () => void;
  /** Apply a text edit to the main selection (toolbar buttons). */
  edit: (make: (text: string, start: number, end: number) => TextEdit) => void;
  destroy: () => void;
}

function decorator(rules: Array<[RegExp, string]>): Extension {
  return rules.map(([regexp, className]) => {
    const matcher = new MatchDecorator({ regexp, decoration: Decoration.mark({ class: className }) });
    return ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = matcher.createDeco(view);
        }
        update(update: ViewUpdate) {
          this.decorations = matcher.updateDeco(update, this.decorations);
        }
      },
      { decorations: (plugin) => plugin.decorations },
    );
  });
}

const MARKDOWN_MARKS: Array<[RegExp, string]> = [
  [/^#{1,6} .*$/gm, "app-cm-heading"],
  [/^>.*$/gm, "app-cm-quote"],
  [/^\s*(?:[-*+]|\d+[.)])(?=\s)/gm, "app-cm-marker"],
  [/\*\*[^*\n]+\*\*|__[^_\n]+__/g, "app-cm-strong"],
  [/(?<![*\w])\*[^*\s][^*\n]*\*(?!\*)|(?<![_\w])_[^_\s][^_\n]*_(?!_)/g, "app-cm-em"],
  [/`[^`\n]+`/g, "app-cm-code"],
  [/!?\[[^\]\n]*\]\([^)\n]*\)/g, "app-cm-link"],
];

const SOURCE_MARKS: Array<[RegExp, string]> = [
  [/^---\s*$/gm, "app-cm-marker"],
  [/^\s*(?:- )?[\w$.-]+(?=:(?:\s|$))/gm, "app-cm-key"],
  [/"(?:[^"\\\n]|\\.)*"(?=\s*:)/g, "app-cm-key"],
  [/(?<=^\s*)#.*$/gm, "app-cm-comment"],
];

function languageOf(language: CodeLanguage): Extension {
  if (language === "json") return [json(), decorator(SOURCE_MARKS)];
  if (language === "yaml") return [yaml(), decorator(SOURCE_MARKS)];
  if (language === "frontmatter") return [markdown(), decorator([...SOURCE_MARKS, ...MARKDOWN_MARKS])];
  return [markdown(), decorator(MARKDOWN_MARKS)];
}

export function createEditor(options: EditorOptions): EditorControl {
  let applying = false;
  let view: EditorView;

  const run = (make: (text: string, start: number, end: number) => TextEdit) => {
    const { from, to } = view.state.selection.main;
    const before = view.state.doc.toString();
    const next = make(before, from, to);
    const change = minimalChange(before, next.text);
    view.dispatch({ ...(change ? { changes: change } : {}), selection: { anchor: next.start, head: next.end }, scrollIntoView: true });
    view.focus();
    return true;
  };

  const shortcuts = options.shortcuts
    ? keymap.of([
        { key: "Mod-b", run: () => run((t, s, e) => toggleWrap(t, s, e, "**")) },
        { key: "Mod-i", run: () => run((t, s, e) => toggleWrap(t, s, e, "*")) },
        { key: "Mod-e", run: () => run((t, s, e) => toggleWrap(t, s, e, "`")) },
        { key: "Mod-k", run: () => run((t, s, e) => insertLink(t, s, e)) },
        { key: "Mod-Alt-2", run: () => run((t, s, e) => toggleLinePrefix(t, s, e, "## ")) },
        { key: "Mod-Alt-3", run: () => run((t, s, e) => toggleLinePrefix(t, s, e, "### ")) },
        { key: "Mod-Shift-8", run: () => run((t, s, e) => toggleLinePrefix(t, s, e, "- ")) },
        { key: "Mod-Shift-9", run: () => run((t, s, e) => toggleLinePrefix(t, s, e, "> ")) },
      ])
    : [];

  view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.value,
      extensions: [
        shortcuts,
        minimalSetup,
        EditorView.lineWrapping,
        languageOf(options.language),
        options.placeholder ? placeholderExt(options.placeholder) : [],
        EditorView.contentAttributes.of({ "aria-label": options.label, "aria-multiline": "true", spellcheck: options.language === "markdown" ? "true" : "false" }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applying) options.onChange(update.state.doc.toString());
          if (update.focusChanged) {
            if (update.view.hasFocus) options.onFocus?.();
            else options.onBlur?.();
          }
        }),
      ],
    }),
  });

  return {
    setValue(text) {
      const change = minimalChange(view.state.doc.toString(), text);
      if (!change) return;
      applying = true;
      view.dispatch({ changes: change });
      applying = false;
    },
    hasFocus: () => view.hasFocus,
    focus: () => view.focus(),
    edit: (make) => void run(make),
    destroy: () => view.destroy(),
  };
}
