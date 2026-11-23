import { useEffect, useMemo, useState } from "react";

type Render = (text: string) => string;

let render: Render | null = null;
// The Markdown and sanitiser libraries load in their own chunk, shared with the form's preview.
const ready: Promise<Render> = Promise.all([import("dompurify"), import("./renderMarkdown")]).then(([purify, markdown]) => {
  render = (text) => purify.default.sanitize(markdown.renderMarkdown(text), { ADD_ATTR: ["target", "rel"], FORBID_TAGS: ["style", "img", "form", "input", "button"] });
  return render;
});

/** An assistant reply, rendered from Markdown and sanitised before it touches the page. Plain text until the renderer loads. */
export function Markdown({ text }: { text: string }) {
  const [renderer, setRenderer] = useState<Render | null>(() => render);
  useEffect(() => {
    if (!renderer) void ready.then((loaded) => setRenderer(() => loaded));
  }, [renderer]);
  const html = useMemo(() => (renderer ? renderer(text) : null), [renderer, text]);
  if (html === null) return <p className="chat-user-text">{text}</p>;
  return <div className="chat-md" dangerouslySetInnerHTML={{ __html: html }} />;
}
