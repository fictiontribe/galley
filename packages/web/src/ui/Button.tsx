import type { ComponentPropsWithRef, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { Tooltip } from "./Tooltip";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "danger-quiet";
export type ButtonSize = "sm" | "md" | "lg" | "xl";

/** The brand classes for a button look — use on links that should look like buttons. */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string): string {
  const classes = ["g-btn"];
  if (variant === "danger-quiet") classes.push("g-btn--danger", "g-btn--quiet");
  else classes.push(`g-btn--${variant}`);
  if (size !== "md") classes.push(`g-btn--${size}`);
  if (extra) classes.push(extra);
  return classes.join(" ");
}

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. */
  icon?: IconName;
  /** Working: shows the stet dots and blocks clicks. */
  busy?: boolean;
  /** Label while busy, e.g. "Publishing…". */
  busyLabel?: ReactNode;
  /** Keyboard hint shown inside the button, e.g. "⌘↵". */
  kbd?: string;
  block?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  busy = false,
  busyLabel,
  kbd,
  block,
  className,
  children,
  type = "button",
  disabled,
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, cx(block && "g-btn--block", className))}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      disabled={disabled}
      onClick={busy ? (event) => event.preventDefault() : onClick}
      {...rest}
    >
      {icon && !busy ? <Icon name={icon} /> : null}
      {busy && busyLabel ? busyLabel : children}
      {busy ? (
        <span className="g-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : null}
      {kbd && !busy ? <span className="g-btn__kbd">{kbd}</span> : null}
    </button>
  );
}

export interface IconButtonProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  icon: IconName;
  /** Accessible name, also shown as the tooltip. */
  label: string;
  variant?: ButtonVariant;
  size?: Exclude<ButtonSize, "xl">;
  /** Show the label as a tooltip on hover/focus (default true). */
  tooltip?: boolean;
  tooltipSide?: "top" | "bottom" | "left" | "right";
}

export function IconButton({
  icon,
  label,
  variant = "quiet",
  size = "sm",
  tooltip = true,
  tooltipSide = "bottom",
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  const button = (
    <button type={type} className={buttonClass(variant, size, cx("g-btn--icon", className))} aria-label={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
  return tooltip ? (
    <Tooltip content={label} side={tooltipSide} decorative>
      {button}
    </Tooltip>
  ) : (
    button
  );
}
