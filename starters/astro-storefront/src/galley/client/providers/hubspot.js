// Vendored from @galley/astro 0.3.0 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// HubSpot: the Forms API's unauthenticated, CORS-enabled "submit data to a
// form" endpoint (legacy v3, still supported):
//   POST https://api.hsforms.com/submissions/v3/integration/submit/{portalId}/{formGuid}
//   (api-{region}.hsforms.com for accounts in another data region, e.g. eu1)
//   { submittedAt, fields: [{ objectTypeId, name, value }],
//     context: { hutk, pageUri, pageName }, legalConsentOptions? }
// The form must exist in HubSpot with the same field names; HubSpot runs its
// own validation and answers 400 with `errors: [{ message, errorType }]`.
//
// Mapping conventions (docs/forms.md):
//   "email"                 a contact property (objectTypeId 0-1)
//   "0-2/name"              another object's property (here: company name)
//   "consent:process"       a consent field → legalConsentOptions.consent.consentToProcess
//   "consent:communication:<subscriptionTypeId>"
//                           a consent field → one communications subscription
// An unmapped consent field counts as consent to process.

import { plainText } from "../../shared/markdown.js";

/** @param {string} name */
function cookie(name) {
  const match = document.cookie.split(/;\s*/).find((part) => part.startsWith(`${name}=`));

  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

/** @param {string} region */
export function hubspotHost(region) {
  return !region || region === "na1" ? "https://api.hsforms.com" : `https://api-${region}.hsforms.com`;
}

/** @type {import("../types").Submitter} */
export async function submit(_values, destination, context) {
  const settings = destination.settings;
  const portalId = String(settings.portalId ?? "");
  const formId = String(settings.formId ?? "");

  if (!portalId || !formId) return { ok: false, notConnected: true, detail: "HubSpot needs settings.portalId and settings.formId." };
  /** @type {{ objectTypeId: string; name: string; value: string }[]} */
  const fields = [];
  /** @type {{ consentToProcess: boolean; text: string; communications: { value: boolean; subscriptionTypeId: number; text: string }[] } | null} */
  let consent = null;
  const consentBlock = () => (consent ??= { consentToProcess: false, text: "", communications: [] });

  for (const item of context.items) {
    const value = Array.isArray(item.value) ? item.value.join(";") : item.value;

    if (item.field.type === "consent") {
      const text = plainText(item.field.text ?? item.field.label ?? "");
      const agreed = value === "true";
      const communication = /^consent:communication:(\d+)$/.exec(item.name);

      if (communication) consentBlock().communications.push({ value: agreed, subscriptionTypeId: Number(communication[1]), text });
      else if (item.name === "consent:process" || !destination.mapping?.[item.field.id]) Object.assign(consentBlock(), { consentToProcess: agreed, text });
      else fields.push({ objectTypeId: "0-1", name: item.name, value });
      continue;
    }
    const [, objectTypeId = "0-1", name = item.name] = /^(\d+-\d+)\/(.+)$/.exec(item.name) ?? [];

    fields.push({ objectTypeId, name, value });
  }
  for (const [name, value] of Object.entries(destination.constants ?? {})) {
    const [, objectTypeId = "0-1", property = name] = /^(\d+-\d+)\/(.+)$/.exec(name) ?? [];

    fields.push({ objectTypeId, name: property, value });
  }
  const hutk = cookie("hubspotutk");
  /** @type {Record<string, unknown>} */
  const body = {
    submittedAt: String(Date.now()),
    fields,
    context: { ...(hutk ? { hutk } : {}), pageUri: context.page.url, pageName: context.page.title },
  };

  if (consent) body.legalConsentOptions = { consent };
  const region = typeof settings.region === "string" ? settings.region : "";
  let response;

  try {
    response = await fetch(`${hubspotHost(region)}/submissions/v3/integration/submit/${encodeURIComponent(portalId)}/${encodeURIComponent(formId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return { ok: false, detail: `HubSpot couldn't be reached: ${error instanceof Error ? error.message : String(error)}` };
  }
  /** @type {any} */
  const answer = await response.json().catch(() => ({}));

  if (response.ok) return { ok: true, redirect: answer.redirectUri, detail: "HubSpot accepted the submission." };
  if (response.status === 429) return { ok: false, retry: true, detail: "HubSpot asked to slow down (429)." };
  /** @type {Record<string, string>} */
  const errors = {};

  for (const error of Array.isArray(answer.errors) ? answer.errors : []) {
    // e.g. "Error in 'fields.email'. Invalid email address"
    const field = /fields\.([\w-]+)/.exec(String(error.message ?? ""))?.[1];
    const item = field ? context.items.find((entry) => entry.name === field || entry.name.endsWith(`/${field}`)) : undefined;

    if (item) errors[item.field.id] = error.errorType === "INVALID_EMAIL" ? context.messages.email ?? String(error.message) : String(error.message).replace(/^Error in '[^']*'\.\s*/, "");
  }
  return {
    ok: false,
    errors,
    detail: `HubSpot refused the submission (${response.status}): ${(Array.isArray(answer.errors) ? answer.errors : []).map((/** @type {any} */ error) => error.errorType ?? error.message).join(", ") || answer.message || "no reason given"}`,
  };
}
