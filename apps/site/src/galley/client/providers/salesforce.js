// Vendored from @galley/astro 0.2.0 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// Salesforce Web-to-Lead. A form post to the Web-to-Lead servlet with the
// org's `oid`, standard lead fields by their Salesforce names (first_name,
// last_name, email, company, phone, lead_source, …) and custom fields by
// their field ids (00N…), mapped in the destination's `mapping`. Fixed
// values (lead_source, Campaign_ID, recordType, debug, debugEmail) go in
// `constants`.
//
// What the browser cannot know: Salesforce answers with a redirect to
// `retURL` and no CORS headers, so the page never learns whether the lead was
// accepted (duplicate rules, bad picklist values, the daily limit all look
// the same). A completed post counts as success; docs/forms.md says so.

import { framePost } from "./frame-post.js";

export const SERVLET = "https://webto.salesforce.com/servlet/servlet.WebToLead?encoding=UTF-8";

/** @type {import("../types").Submitter} */
export async function submit(values, destination, context) {
  const settings = destination.settings;
  const orgId = typeof settings.orgId === "string" ? settings.orgId : "";

  if (!orgId) return { ok: false, notConnected: true, detail: "Salesforce needs settings.orgId." };
  /** @type {{ [name: string]: string | string[] }} */
  const fields = {};

  for (const [name, value] of Object.entries(values)) {
    // Checkboxes: Salesforce reads "1" as ticked; an unticked box is left out.
    if (value === "true" || value === "false") {
      const field = context.items.find((item) => item.name === name)?.field;

      if (field && (field.type === "checkbox" || field.type === "consent")) {
        if (value === "true") fields[name] = "1";
        continue;
      }
    }
    fields[name] = value;
  }
  const navigate = settings.mode === "navigate";
  const returnUrl = typeof settings.returnUrl === "string" ? settings.returnUrl : "";
  // In a frame, no retURL means Salesforce answers with an empty page — the
  // lightest possible end to the post. (A page of this site loaded in the
  // frame skips its third-party scripts: see scripts/runtime.js.)
  const target = navigate ? returnUrl || location.href : returnUrl;
  const result = await framePost(SERVLET, { oid: orgId, ...(target ? { retURL: target } : {}), ...fields }, { navigate });

  if (navigate) return { ok: true, detail: "Sent to Salesforce; the visitor is on their way to the return address." };
  return result.loaded ? { ok: true, detail: "Posted to Web-to-Lead. Salesforce does not tell the page whether it created the lead." } : { ok: false, detail: "Web-to-Lead didn't answer in time." };
}
