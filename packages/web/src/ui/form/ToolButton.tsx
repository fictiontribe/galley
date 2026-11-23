import type { ComponentPropsWithRef } from "react";
import { buttonClass } from "../Button";
import { Tooltip } from "../Tooltip";
import { cx } from "../cx";
import { FormIcon, type FormIconName } from "./FormIcon";

export interface ToolButtonProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  icon: FormIconName;
  /** Accessible name and tooltip. */
  label: string;
  /** Shortcut shown in the tooltip, e.g. "⌘B". */
  shortcut?: string;
}

/** A small square icon button for editing toolbars (the kit's IconButton, with the editing glyphs). */
export function ToolButton({ icon, label, shortcut, className, type = "button", ...rest }: ToolButtonProps) {
  return (
    <Tooltip content={shortcut ? `${label} · ${shortcut}` : label} decorative>
      <button
        type={type}
        className={buttonClass("quiet", "sm", cx("g-btn--icon app-tool", className))}
        aria-label={label}
        {...rest}
      >
        <FormIcon name={icon} />
      </button>
    </Tooltip>
  );
}
