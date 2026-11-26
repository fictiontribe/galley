// Vendored from @galley/astro 0.4.9 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// Account Engagement (Pardot) form handler: a form post to the handler's
// address with fields under the handler's external field names (`mapping`).
// Handlers don't accept fetch/XHR posts (no CORS), so the post goes through a
// hidden frame — or, with `mode: "navigate"`, as a normal navigation, which
// is the better choice when visitor tracking matters (the handler's cookie is
// set in a top-level page, not a third-party frame).
//
// Telling success from failure: point the handler's Success Location and
// Error Location at two pages on this site and copy them into
// `successLocation` / `errorLocation`. The frame then lands on one of them
// (same origin, so the page can read where) and the runtime knows which.
// Without them, a completed post counts as success.

import { framePost } from "./frame-post.js";

/** @param {string} a @param {string} b */
const samePage = (a, b) => {
  try {
    const x = new URL(a);
    const y = new URL(b, location.href);

    return x.origin === y.origin && x.pathname.replace(/\/+$/, "") === y.pathname.replace(/\/+$/, "");
  } catch {
    return false;
  }
};

/** @type {import("../types").Submitter} */
export async function submit(values, destination) {
  const settings = destination.settings;
  const handler = typeof settings.handlerUrl === "string" ? settings.handlerUrl : "";

  if (!handler) return { ok: false, notConnected: true, detail: "Account Engagement needs settings.handlerUrl." };
  const navigate = settings.mode === "navigate";
  const result = await framePost(handler, values, { navigate });

  if (navigate) return { ok: true };
  if (!result.loaded) return { ok: false, detail: "The form handler didn't answer in time." };
  const errorLocation = typeof settings.errorLocation === "string" ? settings.errorLocation : "";
  const successLocation = typeof settings.successLocation === "string" ? settings.successLocation : "";

  if (result.location && errorLocation && samePage(result.location, errorLocation)) {
    const message = new URL(result.location).searchParams.get("errorMessage");

    return { ok: false, detail: message ? `The form handler refused the submission: ${message}` : "The form handler sent the visitor to its error location." };
  }
  if (result.location && successLocation && !samePage(result.location, successLocation) && errorLocation) {
    return { ok: false, detail: `The form handler finished on ${result.location}, which is neither its success nor its error location.` };
  }
  return { ok: true, detail: result.location ? "The form handler reached its success location." : "Posted to the form handler; it does not tell the page more." };
}
