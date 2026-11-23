export type MarkKind = "caret" | "dele" | "transpose" | "stet" | "reg" | "pilcrow" | "bang" | "chevron" | "send";
export type MarkTone = "insert" | "delete" | "change";

export interface ProofMarkProps {
  kind: MarkKind;
  /** Proof colour. Without it the mark takes the text colour. */
  tone?: MarkTone;
  /** Words for screen readers; without it the mark is decorative (always pair it with visible words then). */
  label?: string;
  className?: string;
}

/** A proofreader's mark from the brand glyph set (CSS mask, currentColor). */
export function ProofMark({ kind, tone, label, className }: ProofMarkProps) {
  const classes = ["g-mark", `g-mark--${kind}`];
  if (tone) classes.push(`g-mark--${tone}`);
  if (className) classes.push(className);
  return label ? (
    <span className={classes.join(" ")} role="img" aria-label={label} />
  ) : (
    <span className={classes.join(" ")} aria-hidden="true" />
  );
}
