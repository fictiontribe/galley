// Vendored from @galley/astro 0.4.6 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// Every word the form runtime says on its own, written to brand/voice.md:
// what happened, then what to do; no exclamation marks, no "we".
//
// A site replaces any of them for all its forms with the integration's
// `forms.messages` option (or src/galley/config.js when vendored), and one
// form replaces them with `messages` in its file. `{placeholders}` are filled
// in by the runtime; the ones each message takes are listed beside it.

export const DEFAULT_MESSAGES = Object.freeze({
  /** A required text answer is empty. {label} */
  required: "Fill in this answer.",
  /** A required choice (select, radio, checkboxes) has nothing chosen. {label} */
  requiredChoice: "Choose an answer.",
  /** A required checkbox or consent is not ticked. {label} */
  requiredCheck: "Tick this box to continue.",
  email: "Enter an email address, like name@example.com.",
  /** {domain} */
  businessEmail: "Use your work email address. {domain} is a personal mailbox.",
  url: "Enter a full web address, starting with https://.",
  tel: "Enter a phone number, using digits.",
  number: "Enter a number.",
  date: "Enter a date.",
  /** {min} */
  min: "Enter {min} or more.",
  /** {max} */
  max: "Enter {max} or less.",
  /** {min} */
  minLength: "Use at least {min} characters.",
  /** {max} */
  maxLength: "Use {max} characters or fewer.",
  pattern: "Check the format of this answer.",
  /** The error summary's title. {count} */
  summaryOne: "1 answer needs checking.",
  summaryMany: "{count} answers need checking.",
  sending: "Sending…",
  /** When a destination does not answer the page (Salesforce, Pardot): sent as far as the browser can tell. */
  sent: "Sent.",
  error: "Couldn't send the form. Your answers are still here, so you can try again.",
  rateLimited: "Too many tries just now. Wait a moment, then send again.",
  /** When the destination says how long to wait (Retry-After). {seconds} */
  rateLimitedFor: "Too many tries just now. Try again in {seconds} seconds.",
  rateLimitedForOne: "Too many tries just now. Try again in a second.",
  tooFast: "That was quick. Check your answers, then send again.",
  notConnected: "This form isn't connected yet, so it can't send. Your answers are still here.",
  noScript: "This form needs JavaScript to send your answers.",
  next: "Next",
  back: "Back",
  /** {step} {total} */
  step: "Step {step} of {total}",
  choose: "Choose one",
  optional: "",
  /** Read out with the visual required mark. */
  requiredMark: "*",
  honeypotLabel: "Leave this empty",
  thanksTitle: "Thank you",
  thanksText: "Your answers were sent.",
  /** Shown when the destination is the visitor's own mail program. */
  mailtoText: "Your email program should open with your answers in a new message. Send it from there.",
  download: "Download",
});

/** @typedef {keyof typeof DEFAULT_MESSAGES} MessageKey */

/**
 * @param {...(Record<string, string> | undefined)} layers  Later layers win.
 * @returns {Record<MessageKey, string>}
 */
export function resolveMessages(...layers) {
  return /** @type {Record<MessageKey, string>} */ (Object.assign({}, DEFAULT_MESSAGES, ...layers.filter(Boolean)));
}

/**
 * "{count} answers" with values filled in.
 *
 * @param {string} template
 * @param {Record<string, string | number>} [values]
 */
export function fill(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (whole, key) => (key in values ? String(values[key]) : whole));
}
