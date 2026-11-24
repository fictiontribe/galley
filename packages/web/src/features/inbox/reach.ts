/**
 * Why visitors' browsers can or can't reach the inbox, decided without a
 * screen. The capture settings say why (`captureReach`); where that isn't
 * given (the kit's `inbox.reachable`, or an older server) the reason follows
 * from where this app runs. On a computer of one's own they never can. A
 * hosted install runs on a server, so when they can't, the editor's own
 * address isn't a public name (a trial on cms.localhost, say) — and that,
 * not "this computer", is what to say.
 */
export type InboxReach =
  /** Visitors' browsers can send to the inbox. */
  | "reachable"
  /** A hosted install whose own address isn't one visitors' browsers can reach. */
  | "private-address"
  /** The app runs on a computer of one's own. */
  | "this-computer";

export function inboxReach(reachable: boolean, hosted: boolean, said?: { kind: "public" | "this-computer" | "private-address" } | null): InboxReach {
  if (said) return said.kind === "public" ? "reachable" : said.kind;
  if (reachable) return "reachable";
  return hosted ? "private-address" : "this-computer";
}

/** The editor's own address, from its capture address (`<address>/f/<siteId>`). */
export function editorAddress(captureAddress: string): string {
  try {
    return new URL(captureAddress).origin;
  } catch {
    return captureAddress.replace(/\/f\/[^/]*$/, "");
  }
}
