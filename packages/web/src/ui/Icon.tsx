import type { CSSProperties, SVGProps } from "react";
import { ICONS, iconStroke, type IconName } from "@brand/icons";

/**
 * The brand's icon family (brand/icons.ts — shared with the marketing site):
 * a 16-unit grid, a 1.5 ruled stroke, currentColor. Each glyph has an accent
 * part that takes the Blue Pencil where the icon marks the current place
 * (set --icon-accent and --icon-tint on an ancestor); at rest it is one ink.
 * The markup is the brand's own constant strings, never user input.
 */
export type { IconName };

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  /** Pixel size; defaults to 16 via the .g-icon class. Larger sizes thin the stroke so its weight stays near the text's. */
  size?: number;
  /** Accessible name. Without it the icon is decorative (aria-hidden). */
  label?: string;
}

export function Icon({ name, size, label, className, style, ...rest }: IconProps) {
  const sized: CSSProperties | undefined = size
    ? ({ inlineSize: size, blockSize: size, "--icon-stroke": iconStroke(size) } as CSSProperties)
    : undefined;
  return (
    <svg
      className={className ? `g-icon ${className}` : "g-icon"}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      style={sized || style ? { ...sized, ...style } : undefined}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
      {...rest}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
