import { DISPLAY, fitWidth } from "@galley/core/seo/text";
import { cx } from "@/ui";

export interface ResultPreviewProps {
  title: string;
  address: string;
  /** Absent: the description line is left out (a title-only preview). */
  description?: string;
  /** Smaller, for the editor's panel. */
  compact?: boolean;
  /** Where the title came from, said plainly under the card. */
  note?: string;
}

/**
 * How the page would likely look in a desktop search result. Cut where the
 * estimate says it would be cut — an approximation, and labelled as one;
 * search engines often show something else.
 */
export function ResultPreview({ title, address, description, compact, note }: ResultPreviewProps) {
  const shownTitle = fitWidth(title || "No title", DISPLAY.title.fontPx, DISPLAY.title.limit).shown;
  const shownDescription = description ? fitWidth(description, DISPLAY.description.fontPx, DISPLAY.description.limit).shown : "";

  return (
    <figure className={cx("seo-result", compact && "seo-result--compact")} aria-label="Approximate search result">
      <span className="seo-result__label">Approximate search result</span>
      <span className="seo-result__address">{address}</span>
      <span className={cx("seo-result__title", !title && "seo-result__title--empty")}>{shownTitle}</span>
      {description === undefined ? null : <span className={cx("seo-result__description", !description && "seo-result__description--empty")}>{shownDescription || "No description, so the search engine picks text from the page."}</span>}
      {note ? <figcaption className="seo-result__note">{note}</figcaption> : null}
    </figure>
  );
}
