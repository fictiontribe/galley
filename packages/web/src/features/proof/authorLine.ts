/**
 * The Publish dialog's small print about who a version is recorded as:
 * which setting chose the name, and where to change it.
 */
import type { GitStatus } from "@galley/core/types";

export interface AuthorLine {
  /** "Recorded as Ana Ruiz (ana@example.com), from this site’s own author." */
  text: string;
  /** Where to change it, as a link — or null when it is set outside the app. */
  change: { label: string; to: string } | null;
  /** When the setting lives outside the app, who changes it. */
  note?: string;
}

export function authorLine(author: NonNullable<GitStatus["author"]>, siteId: string): AuthorLine {
  const who = `Recorded as ${author.name} (${author.email})`;
  const site = { label: "Site settings › Connections", to: `/sites/${siteId}/settings#connections` };
  const app = { label: "App settings › You", to: "/settings#you" };
  switch (author.from) {
    case "site":
      return { text: `${who}, this site’s own author.`, change: site };
    case "repository":
      return { text: `${who}, from the site’s own version settings.`, change: site, note: "A developer can change those, or set this site’s own author in" };
    case "app":
      return { text: `${who}, from your app settings.`, change: app };
    case "machine":
      return { text: `${who}, from this computer’s settings.`, change: app, note: "To use another name, set it in" };
    default:
      return { text: `${who} — no name is set yet.`, change: app, note: "Set yours in" };
  }
}
