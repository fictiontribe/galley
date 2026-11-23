/**
 * The new-site wizard's brief → the first build-mode task for a freshly
 * copied starter. The chat shows the person's own short text; the model gets
 * this.
 */
import { GalleyError } from "../errors";
import type { SiteBrief, SiteModel } from "../types";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function quote(text: string): string {
  return text.trim().replace(/\s+\n/g, "\n");
}

export function briefToPrompt(brief: SiteBrief, model: SiteModel, options: { imagesAvailable?: boolean } = {}): string {
  const description = brief.description?.trim();

  if (!description) throw new GalleyError("invalid", "Describe the organisation in a sentence or two so the site can be written for it.");
  if (brief.brandColor && !HEX.test(brief.brandColor.trim())) {
    throw new GalleyError("invalid", "The brand colour should be a hex value like #1F6FEB.");
  }
  const pages = (brief.pages ?? []).map((page) => page.trim()).filter(Boolean);
  const entries = model.collections.filter((c) => c.kind === "entries" && !c.hidden);
  const data = model.collections.filter((c) => c.kind === "data");
  const instructions = model.ai.instructions;
  const lines: string[] = [];

  lines.push("Build this website for a new organisation. The folder holds a starter template, copied a moment ago; every word, name and picture in it is sample content to be replaced.");
  lines.push("");
  lines.push("<brief>");
  lines.push(`About the organisation: ${quote(description)}`);
  if (brief.audience?.trim()) lines.push(`Who the site is for: ${quote(brief.audience)}`);
  if (brief.tone?.trim()) lines.push(`Tone of voice: ${quote(brief.tone)}`);
  lines.push(`Pages wanted: ${pages.length ? pages.join(", ") : "decide from the description — usually Home, About, Services and Contact"}`);
  if (brief.brandColor) lines.push(`Brand colour: ${brief.brandColor.trim()}`);
  if (brief.notes?.trim()) lines.push(`Other notes: ${quote(brief.notes)}`);
  lines.push("</brief>");
  lines.push("");
  lines.push("Work through it in this order.");
  lines.push("");
  lines.push(
    `1. Learn the starter before changing it.${instructions.length ? ` Read ${instructions.join(" and ")} first — it explains the voice, the section library and the house rules.` : ""} Look at the section types in the site card and at one or two pages that use them, at the site's data files${data.length ? ` (${data.map((c) => c.path).join(", ")})` : ""}, and find the theme's design tokens file (a stylesheet of colour and font variables, usually named something like tokens.css or theme.css).`
  );
  lines.push(
    "2. Rewrite the site's identity: its name, tagline, contact details, navigation and footer, in the data files that hold them. Keep the structure of those files; change the values."
  );
  lines.push(
    `3. Compose each requested page from the existing section types, with real copy written for this organisation and this audience — specific, in the requested tone, no filler. ${pages.length ? "Create pages that don't exist yet; remove sample pages nobody asked for unless the site needs them (keep the home page, and keep legal pages such as a privacy page but clear out the sample organisation's details)." : "Keep the page set small and sensible."} Make sure the navigation links match the pages that now exist.`
  );
  lines.push(
    `4. Deal with the sample content in the other collections${entries.length ? ` (${entries.filter((c) => c.id !== "pages").map((c) => c.label.toLowerCase()).join(", ") || "none besides pages"})` : ""}: rewrite sample blog posts so they suit this organisation, or delete them if there's nothing honest to say yet; remove the sample team members and keep at most one clearly generic placeholder if a page needs one.`
  );
  lines.push(
    brief.brandColor
      ? `5. Re-theme through the design tokens file only: build the accent colours around ${brief.brandColor.trim()} and keep text readable — at least 4.5:1 contrast for body text on its background, including text placed on the accent colour. Adjust the neutrals only if they clash.`
      : "5. Leave the theme's colours as they are unless the description clearly calls for a change; if you change them, do it in the design tokens file and keep text contrast at 4.5:1 or better."
  );
  lines.push(
    options.imagesAvailable
      ? "6. Replace the starter's sample pictures that would mislead visitors (projects, people, logos) with images made by generate_image, described to fit this organisation; keep simple decorative artwork if it still fits. Give every image a real description (alt text)."
      : "6. Image generation isn't set up, so keep the starter's neutral artwork where it still fits, remove pictures that would mislead visitors (sample people, sample client logos), and say in your summary that real photos are needed."
  );
  lines.push("7. Rewrite the content guide (if the site has one) so its voice and facts describe this organisation, not the sample one.");
  lines.push("8. Run the build. Fix every error it reports, and run it again until it passes.");
  lines.push("");
  lines.push(
    "Never invent testimonials, client or partner names, statistics, awards, prices, addresses or phone numbers. Where a page needs one of those, use a neutral, obviously generic placeholder — “[Client name]”, “[Price]”, “[Phone number]” — and keep a list of every placeholder you leave."
  );
  lines.push("");
  lines.push(
    "Finish with a short summary for the person: what pages the site now has, what you changed about its look, and a list of what they should check or supply — real photos, contact details, legal text, and every placeholder you left. Keep it plain: no file names or technical terms."
  );
  return lines.join("\n");
}
