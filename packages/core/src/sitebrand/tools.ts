/**
 * The brand in the shared tool registry (so the built-in assistant and any
 * harness over MCP get exactly the same context), and the block the
 * assistant's instructions carry.
 *
 * - get_brand: the brand's colours, fonts, sizes, sections and guide.
 * - check_brand: the pending changes against it — suggestions, never a block.
 *
 * There is no update_brand: in build mode write_file / edit_file can already
 * change galley/brand/*, and every other change to the brand goes through
 * the Brand screen's review, where the person sees evidence and contrast.
 */
import { z } from "zod";
import type { InstructionFile } from "../ai/site-card";
import { defineTool, READ_ONLY, type AssistantTool } from "../ai/tools/types";
import type { SiteService } from "../types";
import { checkChanges, type ChangedFile } from "./check";
import { brandLocation, readSavedBrand } from "./files";
import { brandDigest, imageryBrief } from "./guide";
import type { SiteBrandFile } from "./types";

async function savedBrand(site: SiteService): Promise<{ brand: SiteBrandFile | null; guide: string | null; dir: string }> {
  const location = brandLocation(await site.readConfig().catch(() => null));
  const saved = await readSavedBrand(site, location);

  return { brand: saved.brand, guide: saved.guide, dir: location.dir };
}

/**
 * The brand as one instruction entry for the site card. It rides with the
 * card in the cached system prefix; when the brand changes mid-conversation
 * the card's hash changes and the runtime appends the new card as a note, so
 * the cached prefix is never rewritten.
 */
export async function siteBrandInstructions(site: SiteService): Promise<InstructionFile[]> {
  try {
    const { brand, guide, dir } = await savedBrand(site);

    return brand ? [{ path: `${dir}/brand.json`, content: brandDigest(brand, guide) }] : [];
  } catch {
    return [];
  }
}

/** The brand's imagery direction and palette as a brief for image generation, or null. */
export async function siteImageryBrief(site: SiteService): Promise<string | null> {
  try {
    const { brand } = await savedBrand(site);

    return brand ? imageryBrief(brand) : null;
  } catch {
    return null;
  }
}

const json = (value: unknown) => JSON.stringify(value);

const getBrand = defineTool({
  name: "get_brand",
  title: "Read the site's brand",
  description:
    "Read the site's brand: its colours (with roles, values and the CSS property that holds each), fonts, type sizes, spacing and radius scales, logo rules, imagery direction, section types and when to use each, and the voice guide (tone, words to use and avoid, formatting). Use it before writing copy, choosing an image style, or (in build mode) changing styles or components, and work inside it: use its colours and fonts by their property names, and its sections.",
  input: z.object({
    part: z.enum(["all", "look", "voice", "sections"]).optional().describe("Only part of it: look (colours, fonts, sizes, logo, imagery), voice (the guide), or sections. Default all."),
  }),
  mode: "any",
  effect: READ_ONLY,
  label: () => "Reading the brand",
  async run(input, ctx) {
    const { brand, guide, dir } = await savedBrand(ctx.site);

    if (!brand) return { content: `This site has no brand set up yet (nothing in ${dir}). Follow the site's own content guide and its existing pages; the person can set a brand up on the Brand screen.`, doneLabel: "No brand set up yet" };
    const part = input.part ?? "all";
    const look = {
      colors: brand.colors.map((c) => ({ role: c.role, name: c.name, value: c.value, ...(c.token ? { property: c.token } : {}), ...(c.usage ? { usage: c.usage } : {}) })),
      hardToRead: brand.contrast.filter((p) => p.result === "fail").map((p) => `${p.text} on ${p.background} ${p.ratio}:1`),
      fonts: brand.typography.fonts.map((f) => ({ role: f.role, family: f.family, ...(f.token ? { property: f.token } : {}) })),
      sizes: brand.typography.scale.map((s) => ({ role: s.role, size: s.size, weight: s.weight, lineHeight: s.lineHeight })),
      spacing: brand.spacing.map((s) => ({ name: s.name, value: s.value })),
      radius: brand.radius.map((s) => ({ name: s.name, value: s.value })),
      logos: brand.logos.map((l) => ({ file: l.file, variant: l.variant, background: l.background, ...(l.clearSpace ? { clearSpace: l.clearSpace } : {}), ...(l.doNotUse ? { doNotUse: true } : {}) })),
      imagery: brand.imagery ? { direction: brand.imagery.direction, light: brand.imagery.light, palette: brand.imagery.palette, avoid: brand.imagery.avoid } : null,
      ...(brand.tokensFile ? { propertiesFile: brand.tokensFile } : {}),
    };
    const out = {
      ...(part === "all" || part === "look" ? { look } : {}),
      ...(part === "all" || part === "sections" ? { sections: brand.components.map((c) => ({ type: c.type, whenToUse: c.whenToUse, usedOn: c.usedOn.slice(0, 5) })) } : {}),
      ...(part === "all" || part === "voice" ? { guide: guide ?? brandDigest(brand, null) } : {}),
    };

    return { content: json(out).slice(0, 20_000), doneLabel: "Read the brand" };
  },
});

const checkBrand = defineTool({
  name: "check_brand",
  title: "Check changes against the brand",
  description:
    "Check the changes waiting to be published against the site's brand: colours or fonts that aren't the brand's, text that has become hard to read, and words the brand guide says not to use. Read-only; it returns suggestions with the file and line, and never blocks anything. Run it after changing styles or writing a lot of copy.",
  input: z.object({ paths: z.array(z.string()).max(40).optional().describe("Only these pending files. Default: every pending change.") }),
  mode: "any",
  effect: READ_ONLY,
  label: () => "Checking the changes against the brand",
  async run(input, ctx) {
    const { brand, dir } = await savedBrand(ctx.site);

    if (!brand) return { content: "This site has no brand set up yet, so there's nothing to check against.", doneLabel: "No brand to check against" };
    const changes = await ctx.site.changes();
    const files: ChangedFile[] = [];

    for (const change of changes.files.filter((f) => !f.binary && f.status !== "deleted" && (!input.paths || input.paths.includes(f.path))).slice(0, 40)) {
      const diff = await ctx.site.diff(change.path).catch(() => null);

      if (diff) files.push({ path: change.path, after: diff.after, added: diff.hunks.flatMap((h) => h.lines.filter((l) => l.type === "add").map((l) => ({ line: l.newNumber ?? 0, text: l.text }))) });
    }
    const items = checkChanges(brand, files, { brandDir: dir });

    return { content: json({ suggestions: items }), doneLabel: items.length ? `Checked against the brand · ${items.length === 1 ? "1 suggestion" : `${items.length} suggestions`}` : "Checked against the brand · all on brand" };
  },
});

export const SITE_BRAND_TOOLS: AssistantTool[] = [getBrand, checkBrand];
