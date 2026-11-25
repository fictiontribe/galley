/**
 * Showing other people's words. An addition shows text that someone else
 * wrote (a note, a comment, a name): these are the ways to put it on the
 * page. `dangerouslySetInnerHTML` is not.
 *
 * Both wrap long words, so one unbroken run of characters can't push what is
 * beside it off the screen. How much to show (one line in a bar or a row) is
 * the addition's to decide.
 */
import { useEffect, useMemo, useState } from "react";
import "./safe-text.css";

/** Someone's words as plain text: nothing in them is read as markup. */
export function SafeText({ text, className }: { text: string; className?: string }) {
  return <span className={className ? `app-safe-text ${className}` : "app-safe-text"}>{String(text ?? "")}</span>;
}

type Render = (text: string) => string;

let renderer: Render | null = null;
let loading: Promise<Render> | null = null;

/**
 * The renderer the assistant's replies go through, with its rules (Markdown
 * with raw HTML escaped, then sanitised). Asked for the first time something
 * is drawn with it, so an addition that never shows Markdown never loads it.
 */
function load(): Promise<Render> {
  loading ??= import("@/features/chat/Markdown").then(async (chat) => (renderer = await chat.markdownRenderer));
  return loading;
}

/**
 * Someone's words as a small Markdown: emphasis, lists, code, quotes, and
 * links to web and mail addresses that open in a new tab. Raw HTML is shown
 * as text, a picture as its description, and the result is sanitised before
 * it reaches the page. Plain text until the renderer has loaded.
 */
export function SafeMarkdown({ text }: { text: string }) {
  const words = String(text ?? "");
  const [render, setRender] = useState<Render | null>(() => renderer);

  useEffect(() => {
    let here = true;

    if (!render) void load().then((loaded) => here && setRender(() => loaded), () => undefined);
    return () => {
      here = false;
    };
  }, [render]);
  const html = useMemo(() => (render ? render(words) : null), [render, words]);

  if (html === null) return <span className="app-safe-text">{words}</span>;
  return <div className="app-safe-md" dangerouslySetInnerHTML={{ __html: html }} />;
}
