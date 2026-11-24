/**
 * The Publish dialog's small print about who a version is recorded as:
 * which setting chose the name, and where to change it.
 */
import type { GitStatus } from "@galley/core/types";
import { placeWords } from "@/lib/where";

export interface AuthorLine {
  /** "Recorded as Ana Ruiz (ana@example.com), from this site’s own author." */
  text: string;
  /** Where to change it, as a link — or null when it is set outside the app. */
  change: { label: string; to: string } | null;
  /** When the setting lives outside the app, who changes it. */
  note?: string;
}

/** `hosted`: a hosted install has one site, so its author is always changed in App settings › You. */
export function authorLine(author: NonNullable<GitStatus["author"]>, siteId: string, hosted = false): AuthorLine {
  const who = `Recorded as ${author.name} (${author.email})`;
  const app = { label: "App settings › You", to: "/settings#you" };
  const site = hosted ? app : { label: "Site settings › Connections", to: `/sites/${siteId}/settings#connections` };
  if (hosted && (author.from === "site" || author.from === "app")) return { text: `${who}, this editor’s publishing name.`, change: app };
  switch (author.from) {
    case "site":
      return { text: `${who}, this site’s own author.`, change: site };
    case "repository":
      return { text: `${who}, from the site’s own version settings.`, change: site, note: "A developer can change those, or set this site’s own author in" };
    case "app":
      return { text: `${who}, from your app settings.`, change: app };
    case "machine":
      return { text: `${who}, from ${placeWords(hosted).machines} settings.`, change: app, note: "To use another name, set it in" };
    default:
      return { text: `${who} — no name is set yet.`, change: app, note: "Set yours in" };
  }
}
