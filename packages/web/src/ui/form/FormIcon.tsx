import { Icon } from "../Icon";

/**
 * The editing controls' glyphs: a named subset of the brand's icon family
 * (brand/icons.ts), so the toolbar and the rest of the app share one drawing.
 */
const GLYPHS = ["grip", "arrow-up", "arrow-down", "bold", "italic", "heading", "quote", "list-bullet", "list-number", "code", "link", "image"] as const;

export type FormIconName = (typeof GLYPHS)[number];

export function FormIcon({ name, size }: { name: FormIconName; size?: number }) {
  return size ? <Icon name={name} size={size} /> : <Icon name={name} />;
}
