/**
 * The theme file's JSON Schema, served at THEME_SCHEMA_URL (the `$schema` an
 * exported theme names). The art director's file is the source; this only
 * hands it on (`galley schema --out` writes it for the site to serve).
 */
import schema from "../../../../brand/themes/theme.schema.json" with { type: "json" };

export function themeJsonSchema(): Record<string, unknown> {
  return structuredClone(schema) as Record<string, unknown>;
}
