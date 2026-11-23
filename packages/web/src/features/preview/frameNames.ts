/**
 * The names of the frames the app shows a site in, all starting
 * "galley-preview" — the site kit's sign that a page is in the editor's
 * preview, where its third-party scripts stay inert (docs/scripts.md): the
 * proposed page, the live-site comparison, and Proof's two (shown without
 * click-to-edit).
 */
export function frameName(role: "proposed" | "live", editable: boolean): string {
  return `galley-preview${editable ? "" : "-proof"}${role === "live" ? "-live" : ""}`;
}
