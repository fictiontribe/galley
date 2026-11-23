import type { ReactNode } from "react";
import { cx } from "../cx";
import { richParts, type InlineStyle, type RichPart } from "./inlineMarkdown";
import type { ProofPart } from "./wordDiff";
import "./diff.css";

export interface ProofTextProps {
  parts: ProofPart[];
  /** Plain marks (no caret or dele glyph) for dense rows such as source lines. */
  plain?: boolean;
  /** Draw the marks in when they first appear. */
  inkIn?: boolean;
  /**
   * Show inline Markdown as it reads (emphasis, link text with its address
   * beside it) instead of the stored markers. The marks stay exact.
   */
  markdown?: boolean;
  className?: string;
}

/** Leading and trailing spaces stay outside a mark, so the caret sits on the word. */
function split(text: string): [string, string, string] {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  return match ? [match[1] ?? "", match[2] ?? "", match[3] ?? ""] : ["", text, ""];
}

function mark(part: Extract<ProofPart, { kind: "ins" | "del" }>, key: number, plain: boolean, inkIn: boolean): ReactNode {
  const [lead, core, trail] = split(part.text);
  if (!core) return part.kind === "ins" ? part.text : null;
  const ink = inkIn ? "g-ink-in" : undefined;
  const node =
    part.kind === "ins" ? (
      <ins className={cx("g-ins", plain && "g-ins--plain", ink)}>
        <span className="g-sr">Added: </span>
        {core}
      </ins>
    ) : (
      <del className={cx("g-del", plain && "g-del--plain", ink)}>
        <span className="g-sr">Removed: </span>
        {core}
      </del>
    );
  return (
    <span key={key}>
      {lead}
      {node}
      {trail}
    </span>
  );
}

function styled(text: string, style: InlineStyle, stored: boolean | undefined): ReactNode {
  if (stored) return <span className="g-mono ui-md-stored">{text}</span>;
  let node: ReactNode = text;
  if (style.code) node = <code className="ui-md-code">{node}</code>;
  if (style.address) node = <span className="ui-md-address">{node}</span>;
  if (style.link) node = <span className="ui-md-link">{node}</span>;
  if (style.em) node = <em>{node}</em>;
  if (style.strong) node = <strong>{node}</strong>;
  return node;
}

function richMark(part: Exclude<RichPart, { kind: "gap" }>, key: number, plain: boolean, inkIn: boolean): ReactNode {
  const [lead, core, trail] = split(part.text);
  if (!core) return part.kind === "ins" ? <span key={key}>{part.text}</span> : null;
  const ink = inkIn ? "g-ink-in" : undefined;
  const inner = styled(core, part.style, part.stored);
  const node =
    part.kind === "ins" ? (
      <ins className={cx("g-ins", plain && "g-ins--plain", ink)}>
        <span className="g-sr">Added: </span>
        {inner}
      </ins>
    ) : (
      <del className={cx("g-del", plain && "g-del--plain", ink)}>
        <span className="g-sr">Removed: </span>
        {inner}
      </del>
    );
  return (
    <span key={key}>
      {lead}
      {node}
      {trail}
    </span>
  );
}

function Gap({ words }: { words: number }) {
  return (
    <span className="ui-proof__gap" title={`${words} unchanged words`}>
      <span aria-hidden="true"> … </span>
      <span className="g-sr">{`(${words} unchanged words)`}</span>
    </span>
  );
}

/** Text proofed in place: insertions underlined with a caret, deletions struck with a dele, folds as “…”. */
export function ProofText({ parts, plain = false, inkIn = false, markdown = false, className }: ProofTextProps) {
  if (markdown) {
    return (
      <span className={cx("ui-proof", "ui-proof--rendered", className)}>
        {richParts(parts).map((part, index) => {
          if (part.kind === "gap") return <Gap key={index} words={part.words} />;
          if (part.kind === "same") return <span key={index}>{styled(part.text, part.style, part.stored)}</span>;
          return richMark(part, index, plain, inkIn);
        })}
      </span>
    );
  }
  return (
    <span className={cx("ui-proof", className)}>
      {parts.map((part, index) => {
        if (part.kind === "same") return <span key={index}>{part.text}</span>;
        if (part.kind === "gap") return <Gap key={index} words={part.words} />;
        return mark(part, index, plain, inkIn);
      })}
    </span>
  );
}
