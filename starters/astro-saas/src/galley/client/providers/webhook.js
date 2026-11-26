// Vendored from @galley/astro 0.4.7 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// Any address that accepts a POST: an automation tool, a serverless
// function, the site owner's own service. `format: "json"` (default) sends
// { form, values, page, at }; `format: "form"` sends the values
// form-encoded. The receiving server must allow this site's origin (CORS):
// a JSON post is preceded by an OPTIONS preflight; a form-encoded one is not,
// but its answer is still only readable with Access-Control-Allow-Origin.
// An answer of { errors: { name: message } } puts messages on the fields.

/** @type {import("../types").Submitter} */
export async function submit(values, destination, context) {
  const url = typeof destination.settings.url === "string" ? destination.settings.url : "";

  if (!url) return { ok: false, notConnected: true, detail: "The webhook needs settings.url." };
  const form = destination.settings.format === "form";
  let body;

  if (form) {
    const params = new URLSearchParams();

    for (const [name, value] of Object.entries(values)) for (const item of Array.isArray(value) ? value : [value]) params.append(name, item);
    body = params;
  } else {
    body = JSON.stringify({ form: context.formId, values, page: context.page, at: new Date().toISOString() });
  }
  let response;

  try {
    response = await fetch(url, { method: "POST", body, ...(form ? {} : { headers: { "content-type": "application/json" } }) });
  } catch (error) {
    return { ok: false, detail: `The webhook couldn't be reached (or doesn't allow this site's origin): ${error instanceof Error ? error.message : String(error)}` };
  }
  if (response.status === 429) return { ok: false, retry: true, detail: "The webhook asked to slow down (429)." };
  if (response.ok) return { ok: true, detail: `The webhook answered ${response.status}.` };
  /** @type {any} */
  const answer = await response.json().catch(() => null);

  return { ok: false, errors: answer?.errors && typeof answer.errors === "object" ? answer.errors : {}, detail: `The webhook answered ${response.status}.` };
}
