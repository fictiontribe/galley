import { useEffect, useState } from "react";
import { Skeleton } from "../Skeleton";
import { cx } from "../cx";

type Render = (markdown: string) => string;

let renderer: Promise<Render> | null = null;

/** marked + DOMPurify, loaded the first time a preview is shown. */
function loadRenderer(): Promise<Render> {
  renderer ??= Promise.all([import("marked"), import("dompurify")]).then(([{ marked }, { default: purify }]) => (markdown: string) =>
    purify.sanitize(marked.parse(markdown, { async: false, gfm: true, breaks: false }) as string),
  );
  return renderer;
}

export interface MarkdownPreviewProps {
  markdown: string;
  className?: string;
  /** Shown when there's nothing to preview. */
  empty?: string;
}

/** Read-only rendering of markdown in the writing face. Links and HTML are sanitised. */
export function MarkdownPreview({ markdown, className, empty = "Nothing written yet." }: MarkdownPreviewProps) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadRenderer().then((render) => {
      if (live) setHtml(render(markdown));
    });
    return () => {
      live = false;
    };
  }, [markdown]);

  if (!markdown.trim()) return <p className={cx("app-md-preview app-md-preview--empty", className)}>{empty}</p>;
  if (html === null) return <Skeleton lines={3} />;
  return <div className={cx("app-md-preview", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
