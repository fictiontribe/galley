import { readFileSync } from "node:fs";
import { z } from "zod";
import { GalleyError } from "@galley/core";
import { DEFAULT_BRAND } from "@galley/core/brand";
import type { BrandConfig } from "@galley/core/types";
import { describeIssues } from "./validate";

const hex = z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i, "it must be a hex color like #1a2b3c");
const link = z.string().max(2048).refine((value) => /^https?:\/\//i.test(value), "it must start with http:// or https://");
const logo = z
  .string()
  .max(512 * 1024)
  .refine((value) => /^https?:\/\//i.test(value) || /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/i.test(value) || value.startsWith("/"), "it must be an http(s) URL, a site path or a data:image URL");

export const brandFileSchema = z
  .object({
    productName: z.string().trim().min(1).max(60).optional(),
    byline: z.string().max(120).optional(),
    logoUrl: logo.optional(),
    accent: hex.optional(),
    /** A theme's id (built-in, saved or from a plugin): the one the install starts with. */
    theme: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "it must be a theme's id, like plate").optional(),
    supportUrl: link.optional(),
    docsUrl: link.optional(),
  })
  .strict();

/**
 * The brand served at /api/meta: the built-in default, overridden by a JSON
 * file (GALLEY_BRAND_FILE), then by the GALLEY_BRAND_NAME / GALLEY_BRAND_ACCENT
 * shortcuts. A broken brand file stops start-up rather than silently showing
 * the wrong name.
 */
export function loadBrand(env: NodeJS.ProcessEnv, brandFile = env.GALLEY_BRAND_FILE): BrandConfig {
  let brand: BrandConfig = { ...DEFAULT_BRAND };

  if (brandFile) {
    let raw: unknown;

    try {
      raw = JSON.parse(readFileSync(brandFile, "utf8")) as unknown;
    } catch (error) {
      const reason = (error as NodeJS.ErrnoException).code === "ENOENT" ? "it doesn't exist" : "it isn't valid JSON";

      throw new GalleyError("invalid", `The brand file ${brandFile} can't be used because ${reason}.`);
    }
    const parsed = brandFileSchema.safeParse(raw);

    if (!parsed.success) throw new GalleyError("invalid", `The brand file ${brandFile} can't be used. ${describeIssues(parsed.error)}`);
    brand = { ...brand, ...parsed.data };
  }
  const name = env.GALLEY_BRAND_NAME?.trim();

  if (name) brand.productName = name.slice(0, 60);
  const accent = env.GALLEY_BRAND_ACCENT?.trim();

  if (accent) {
    if (!hex.safeParse(accent).success) throw new GalleyError("invalid", `GALLEY_BRAND_ACCENT must be a hex color like #1a2b3c, not “${accent}”.`);
    brand.accent = accent;
  }
  return brand;
}
