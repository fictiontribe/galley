/**
 * Showing other people's words. An addition shows text that someone else
 * wrote (a note, a comment, a name): these are the ways to put it on the
 * page. `dangerouslySetInnerHTML` is not.
 */
import { Markdown } from "@/features/chat/Markdown";

/** Someone's words as plain text: nothing in them is read as markup. */
export function SafeText({ text, className }: { text: string; className?: string }) {
  return <span className={className}>{String(text ?? "")}</span>;
}

/**
 * Someone's words as a small Markdown: emphasis, lists, code, quotes, and
 * links to web and mail addresses that open in a new tab. Raw HTML is shown
 * as text, a picture as its description, and the result is sanitised before
 * it reaches the page.
 */
export function SafeMarkdown({ text }: { text: string }) {
  return <Markdown text={String(text ?? "")} />;
}
