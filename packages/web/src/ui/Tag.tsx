import type { ReactNode } from "react";
import { ProofMark, type MarkKind } from "./ProofMark";

export interface TagProps {
  children: ReactNode;
  /** "outline" for lighter metadata; "mono" for keys, file names, frameworks. */
  variant?: "default" | "outline" | "mono";
  title?: string;
  className?: string;
}

/** Neutral metadata: a collection, a file name, a framework. */
export function Tag({ children, variant = "default", title, className }: TagProps) {
  const classes = ["g-tag"];
  if (variant === "outline") classes.push("g-tag--outline");
  if (variant === "mono") classes.push("g-tag--mono");
  if (className) classes.push(className);
  return (
    <span className={classes.join(" ")} title={title}>
      {children}
    </span>
  );
}

export type BadgeTone = "neutral" | "insert" | "delete" | "change" | "success" | "warning" | "danger" | "info" | "accent";

const DEFAULT_MARK: Record<BadgeTone, MarkKind> = {
  neutral: "stet",
  insert: "caret",
  delete: "dele",
  change: "transpose",
  success: "reg",
  warning: "bang",
  danger: "bang",
  info: "stet",
  accent: "stet",
};

export interface BadgeProps {
  /** Always a word as well as a mark — never colour alone. */
  children: ReactNode;
  tone?: BadgeTone;
  /** Override the mark; `null` for none. */
  mark?: MarkKind | null;
  className?: string;
}

/** Status: a mark and a word on a tint. */
export function Badge({ children, tone = "neutral", mark, className }: BadgeProps) {
  const kind = mark === undefined ? DEFAULT_MARK[tone] : mark;
  const classes = ["g-badge"];
  if (tone !== "neutral") classes.push(`g-badge--${tone}`);
  if (className) classes.push(className);
  return (
    <span className={classes.join(" ")}>
      {kind ? <ProofMark kind={kind} /> : null}
      {children}
    </span>
  );
}

export interface CountProps {
  value: number;
  /** Quiet: on a sunken pill instead of the accent. */
  quiet?: boolean;
  /** Spoken text, e.g. "3 unpublished changes". */
  label?: string;
}

/** A small number pill (sidebar, buttons, tabs). */
export function Count({ value, quiet, label }: CountProps) {
  return (
    <span className={quiet ? "g-count g-count--quiet" : "g-count"}>
      <span aria-hidden={label ? true : undefined}>{typeof value === "number" ? value.toLocaleString() : value}</span>
      {label ? <span className="g-sr">{label}</span> : null}
    </span>
  );
}
