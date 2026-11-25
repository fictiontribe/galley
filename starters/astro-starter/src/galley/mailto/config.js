// Vendored from @galley/astro 0.4.2 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// Settings, wording and styles of the email-link dialog (docs/mailto.md).
import { MAILTO_RUNTIME } from "./runtime.gen.js";

/** The actions, in their default order. "outlook-live" (Outlook.com's own address) is available but not offered by default. */
export const MAILTO_OPTIONS = /** @type {const} */ (["gmail", "outlook", "app", "copy"]);
export const MAILTO_KNOWN = new Set([...MAILTO_OPTIONS, "outlook-live"]);

/** Every word the dialog says, per brand/voice.md. `{address}` is the link's address. */
export const MAILTO_STRINGS = Object.freeze({
  label: "Email {address}",
  labelNoAddress: "Write an email",
  gmail: "Send with Gmail",
  outlook: "Send with Outlook",
  "outlook-live": "Send with Outlook.com",
  app: "Open my mail app",
  copy: "Copy address",
  copied: "Copied",
  copyFailed: "Couldn't copy. Select the address above instead.",
  close: "Close",
});

/*
 * Custom properties (with system fallbacks):
 *   --galley-mailto-bg      --galley-mailto-text    --galley-mailto-border
 *   --galley-mailto-radius  --galley-mailto-shadow  --galley-mailto-hover
 *   --galley-field-focus (focus ring)
 * No animation, so nothing moves for anyone (reduced motion included).
 */
export const MAILTO_CSS =
  ".galley-mailto{position:fixed;z-index:2147483001;box-sizing:border-box;min-width:14rem;max-width:22rem;padding:.5rem;border:1px solid var(--galley-mailto-border,#8886);border-radius:var(--galley-mailto-radius,.5rem);background:var(--galley-mailto-bg,Canvas);color:var(--galley-mailto-text,CanvasText);box-shadow:var(--galley-mailto-shadow,0 8px 28px #0003);font:inherit;font-size:.9375rem;line-height:1.4}" +
  ".galley-mailto[data-sheet]{inset:auto 0 0;max-width:none;padding:1rem}" +
  ".galley-mailto p{margin:.25rem 2.25rem .5rem .5rem}.galley-mailto__address{font-weight:600;user-select:all;overflow-wrap:anywhere}" +
  ".galley-mailto ul{margin:0;padding:0;list-style:none}" +
  ".galley-mailto__option{display:block;box-sizing:border-box;width:100%;padding:.5rem;border:0;border-radius:.25rem;background:none;color:inherit;font:inherit;text-align:start;text-decoration:none;cursor:pointer}" +
  ".galley-mailto__option:hover,.galley-mailto__option:focus-visible{background:var(--galley-mailto-hover,#8882)}" +
  ".galley-mailto :focus-visible{outline:2px solid var(--galley-field-focus,Highlight)}" +
  ".galley-mailto__status:empty{display:none}" +
  ".galley-mailto__close{position:absolute;top:.25rem;right:.25rem;width:2rem;height:2rem;border:0;background:none;color:inherit;font:inherit;font-size:1.25rem;cursor:pointer}";

/**
 * @typedef {object} MailtoOptions
 * @property {string[]} [options]  Which actions, in which order: "gmail", "outlook", "outlook-live", "app", "copy".
 * @property {Record<string, string>} [strings]  Wording, by key (MAILTO_STRINGS).
 */

/**
 * The dialog's settings with defaults, or null when it is off.
 *
 * @param {MailtoOptions | boolean | undefined} given
 * @returns {{ options: string[]; strings: Record<string, string> } | null}
 */
export function resolveMailto(given) {
  if (given === false) return null;
  const settings = typeof given === "object" && given ? given : {};
  const options = (settings.options ?? [...MAILTO_OPTIONS]).filter((option) => MAILTO_KNOWN.has(/** @type {any} */ (option)));

  if (settings.options && options.length !== settings.options.length) {
    throw new Error(`mailto.options can only list ${[...MAILTO_KNOWN].map((option) => `"${option}"`).join(", ")}.`);
  }
  return { options, strings: { ...MAILTO_STRINGS, ...(settings.strings ?? {}) } };
}

/** The inline script's text — the same on every page of a site (one CSP hash). */
export function mailtoScript(/** @type {{ options: string[]; strings: Record<string, string> }} */ config) {
  return `(${MAILTO_RUNTIME})(${JSON.stringify({ ...config, css: MAILTO_CSS }).replace(/</g, "\\u003c")})`;
}

/** The <script> element, with the marker that keeps it from being added twice. */
export function mailtoTag(/** @type {{ options: string[]; strings: Record<string, string> }} */ config) {
  return `<script data-galley-mailto-script>${mailtoScript(config)}</script>`;
}

/** Whether a page has an email link worth enhancing. */
export const HAS_MAILTO = /<a\b[^>]*\bhref\s*=\s*["']?mailto:/i;
