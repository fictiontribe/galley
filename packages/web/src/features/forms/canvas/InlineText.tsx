import { Fragment } from "react";
import { cx } from "@/ui";
import { inlineParts, safeLink } from "../logic/inline";

/** A form text with its inline formatting, drawn as elements. Links open in a new tab (the preview isn't the site). */
export function InlineText({ text, className, as = "span" }: { text: string; className?: string; as?: "span" | "p" | "div" }) {
  const Tag = as;
  const lines = text.split(/\n{2,}/);
  return (
    <Tag className={cx("kit-inline", className)}>
      {lines.map((line, lineIndex) => (
        <Fragment key={lineIndex}>
          {lineIndex > 0 ? <br /> : null}
          {inlineParts(line).map((part, index) => {
            if (part.kind === "bold") return <strong key={index}>{part.text}</strong>;
            if (part.kind === "italic") return <em key={index}>{part.text}</em>;
            if (part.kind === "link") {
              const href = safeLink(part.href);
              return href ? (
                <a key={index} className="g-link" href={href} target="_blank" rel="noreferrer">
                  {part.text}
                </a>
              ) : (
                <span key={index}>{part.text}</span>
              );
            }
            return <Fragment key={index}>{part.text}</Fragment>;
          })}
        </Fragment>
      ))}
    </Tag>
  );
}
