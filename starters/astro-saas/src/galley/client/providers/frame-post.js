// Vendored from @galley/astro 0.4.6 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// A real form post — the way Web-to-Lead and Account Engagement form
// handlers expect browsers to send — either into a hidden frame (the visitor
// stays on the page) or as a normal navigation (the visitor goes on to the
// provider's return page). Neither provider sends CORS headers, so `fetch`
// could not read their answer anyway; a frame at least tells us the post
// completed (its `load` event), and when the provider sends the frame on to a
// page of *this* site, the runtime can read where it landed.

let counter = 0;

/**
 * @param {string} action
 * @param {{ [name: string]: string | string[] }} values
 * @param {{ navigate?: boolean; timeoutMs?: number }} [options]
 * @returns {Promise<{ loaded: boolean; location: string | null }>}
 *   `location` is the frame's final address when it is on this site's origin.
 */
export function framePost(action, values, options = {}) {
  const form = document.createElement("form");

  form.method = "POST";
  form.action = action;
  form.acceptCharset = "UTF-8";
  form.hidden = true;
  for (const [name, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      const input = document.createElement("input");

      input.type = "hidden";
      input.name = name;
      input.value = item;
      form.append(input);
    }
  }
  if (options.navigate) {
    document.body.append(form);
    form.submit();
    return Promise.resolve({ loaded: false, location: null });
  }
  const name = `galley-post-${Date.now().toString(36)}-${(counter += 1)}`;
  const frame = document.createElement("iframe");

  frame.name = name;
  frame.title = "";
  frame.hidden = true;
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  form.target = name;
  document.body.append(frame, form);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (/** @type {boolean} */ loaded) => {
      if (settled) return;
      settled = true;
      let location = null;

      try {
        location = frame.contentWindow?.location.href ?? null;
        if (location === "about:blank") location = null;
      } catch {
        // Another origin: the browser doesn't say where the frame is.
      }
      resolve({ loaded, location });
      setTimeout(() => {
        frame.remove();
        form.remove();
      }, 1000);
    };

    frame.addEventListener("load", () => finish(true));
    setTimeout(() => finish(false), options.timeoutMs ?? 20000);
    form.submit();
  });
}
