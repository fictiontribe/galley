// Builds the e2e site: a throwaway copy of starters/astro-saas with the kit
// vendored in (scripts/vendor.mjs), three forms, a scripts file, and the
// starter's tokens mapped onto the kit's custom properties — the wiring the
// starters will get. Used by run.mjs.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const KIT = fileURLToPath(new URL("../..", import.meta.url));
const STARTER = fileURLToPath(new URL("../../../../starters/astro-saas", import.meta.url));

export const CAPTURE = "https://capture.galley.test/f/site_e2e";
export const WEBHOOK = "https://hooks.automation.test/contact";
export const MARKETO = "https://go.marketo.test";

/** @param {string} path @param {(text: string) => string} change */
function edit(path, change) {
  const before = readFileSync(path, "utf8");
  const after = change(before);

  if (after === before) throw new Error(`setup: nothing changed in ${path}`);
  writeFileSync(path, after);
}

/** @param {string} root */
export function makeSite(root) {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  execFileSync("rsync", ["-a", "--exclude", "node_modules", "--exclude", "dist", "--exclude", ".astro", `${STARTER}/`, `${root}/`]);
  symlinkSync(join(STARTER, "node_modules"), join(root, "node_modules"));
  const git = (/** @type {string[]} */ args) => execFileSync("git", ["-c", "user.name=Test Editor", "-c", "user.email=editor@example.com", ...args], { cwd: root, stdio: "ignore" });

  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "Initial site"]);

  execFileSync("node", [join(KIT, "scripts/vendor.mjs"), root], { stdio: "ignore" });

  // ── The kit's settings and the forms collection ──────────────────────
  writeFileSync(
    join(root, "src/galley/settings.json"),
    `${JSON.stringify({ forms: { collection: "forms", endpoint: CAPTURE, allowFormScripts: false, messages: { optional: "Optional" }, freeEmailDomains: [] }, mailto: { options: ["gmail", "outlook", "app", "copy"], strings: {} } }, null, 2)}\n`,
  );
  edit(join(root, "src/content.config.ts"), (text) =>
    text
      .replace('import { z } from "astro/zod";', 'import { z } from "astro/zod";\nimport { formSchema } from "./galley/schema.js";')
      .replace("export const collections = {", 'export const collections = {\n  forms: defineCollection({ loader: glob({ pattern: "*.json", base: "./src/content/forms" }), schema: formSchema }),'),
  );
  mkdirSync(join(root, "src/content/forms"), { recursive: true });
  const forms = {
    contact: {
      name: "Contact",
      submitLabel: "Send message",
      fields: [
        { id: "name", type: "text", label: "Full name", required: true, width: "half" },
        { id: "email", type: "email", label: "Work email", required: true, width: "half", validation: { businessEmailOnly: true } },
        { id: "company", type: "text", label: "Company", width: "half" },
        { id: "topic", type: "select", label: "What is this about?", width: "half", options: [{ value: "demo", label: "Book a demo" }, { value: "pricing", label: "Pricing and plans" }, { value: "other", label: "Something else" }] },
        { id: "detail", type: "text", label: "Which topic?", required: true, showWhen: { field: "topic", equals: "other" } },
        { id: "message", type: "textarea", label: "How can we help?", required: true },
        { id: "source", type: "hidden", autofill: { from: "utm", key: "utm_source", touch: "first" } },
      ],
      destinations: [
        { provider: "galley", settings: {} },
        { provider: "webhook", settings: { url: WEBHOOK }, mapping: { email: "contact_email" }, constants: { channel: "website" } },
      ],
      afterSubmit: [
        { type: "event", name: "contact_sent", params: { topic: "{{topic}}" } },
        { type: "message", title: "Thanks, {{name}}", text: "We'll reply to **{{email}}** within one working day. Or write to [support@example.com](mailto:support@example.com)." },
      ],
      spam: { honeypot: true, minSeconds: 1 },
    },
    demo: {
      name: "Request a walkthrough",
      submitLabel: "Request a walkthrough",
      steps: [{ title: "About you", nextLabel: "Continue" }, { title: "Your company" }],
      fields: [
        { id: "first_name", type: "text", label: "First name", required: true, width: "half" },
        { id: "last_name", type: "text", label: "Last name", required: true, width: "half" },
        { id: "email", type: "email", label: "Work email", required: true },
        { id: "company", type: "text", label: "Company", required: true, step: 1 },
        { id: "sites", type: "radio", label: "Number of sites", step: 1, options: [{ value: "1-9", label: "1–9" }, { value: "10-49", label: "10–49" }, { value: "50+", label: "50 or more" }] },
        { id: "consent", type: "consent", required: true, step: 1, text: "I agree to the [privacy policy](/privacy/) and to being contacted about this request." },
        { id: "campaign", type: "hidden", autofill: { from: "utm", key: "utm_campaign" } },
      ],
      destinations: [
        {
          provider: "hubspot",
          settings: { portalId: "12345678", formId: "0f8fad5b-d9cb-469f-a165-70867728950e" },
          mapping: { first_name: "firstname", last_name: "lastname", sites: "number_of_sites", consent: "consent:process", campaign: "utm_campaign" },
          constants: { lifecyclestage: "lead" },
        },
      ],
      afterSubmit: [
        { type: "event", name: "generate_lead", params: { form: "demo" } },
        { type: "redirect", url: "/contact/", passFields: ["email"] },
      ],
    },
    newsletter: {
      name: "Newsletter",
      submitLabel: "Subscribe",
      appearance: { layout: "inline", labels: "hidden" },
      fields: [{ id: "email", type: "email", label: "Email address", required: true }],
      destinations: [{ provider: "marketo", settings: { munchkinId: "123-ABC-456", formId: "1057", host: MARKETO }, mapping: { email: "Email" } }],
      afterSubmit: [{ type: "message", title: "You're subscribed", text: "The next issue goes to **{{email}}**." }],
    },
  };

  for (const [id, form] of Object.entries(forms)) writeFileSync(join(root, `src/content/forms/${id}.json`), `${JSON.stringify(form, null, 2)}\n`);

  // ── Managed scripts: GTM + GA4 behind the banner with Consent Mode; a custom script on one page ──
  writeFileSync(
    join(root, "src/data/scripts.json"),
    `${JSON.stringify(
      {
        consent: { mode: "banner", googleConsentMode: true, banner: { policyUrl: "/privacy/" } },
        scripts: [
          { id: "gtm", kind: "gtm", enabled: true, settings: { containerId: "GTM-AB12CDE3" } },
          { id: "ga4", kind: "ga4", enabled: true, settings: { measurementId: "G-TEST12345" } },
          { id: "pricing-chat", kind: "custom", label: "Pricing chat", enabled: true, consent: "preferences", include: ["/pricing/"], settings: { src: "https://cdn.chatvendor.test/widget.js", attributes: { "data-key": "pk_test" } } },
        ],
      },
      null,
      2,
    )}\n`,
  );

  // ── The layout: scripts at their three places; a footer link that reopens the banner ──
  edit(join(root, "src/layouts/Base.astro"), (text) =>
    text
      .replace('import StarterNotice from "../components/StarterNotice.astro";', 'import StarterNotice from "../components/StarterNotice.astro";\nimport { Scripts } from "../galley/components/index.js";\nimport "../styles/galley.css";')
      .replace('<meta charset="utf-8" />', '<meta charset="utf-8" />\n    <Scripts placement="head" />')
      .replace("  <body>\n", '  <body>\n    <Scripts placement="body-start" />\n')
      .replace("    <Footer />\n  </body>", '    <Footer />\n    <Scripts placement="body-end" />\n  </body>'),
  );
  edit(join(root, "src/data/navigation.json"), (text) => text.replace('{ "label": "Security", "href": "/security/" }', '{ "label": "Security", "href": "/security/" },\n    { "label": "Privacy choices", "href": "/privacy/#choices" }'));
  edit(join(root, "src/components/Footer.astro"), (text) =>
    text.replace("<a href={withBase(link.href)}>{link.label}</a>", '<a href={withBase(link.href)} data-galley-consent-open={link.href.endsWith("#choices") ? "" : undefined}>{link.label}</a>'),
  );

  // ── The starter's tokens, mapped (this is the whole theme) ──────────────
  writeFileSync(
    join(root, "src/styles/galley.css"),
    `/* Galley forms, consent banner and email dialog, in this site's tokens. */
.galley-form {
  --galley-form-gap: var(--space-s);
  --galley-field-bg: var(--tone-bg);
  --galley-field-text: var(--tone-text);
  --galley-field-border: var(--tone-control);
  --galley-field-radius: var(--radius-m);
  --galley-field-height: 2.875rem;
  --galley-field-focus: var(--tone-focus);
  --galley-form-error: var(--color-negative);
  --galley-form-muted: var(--tone-muted);
  --galley-label-weight: var(--weight-medium);
  --galley-button-bg: var(--tone-button-bg);
  --galley-button-text: var(--tone-button-text);
  --galley-button-radius: var(--radius-button);
}
.galley-form__label { font-size: var(--step--1); }
.galley-consent {
  --galley-consent-bg: var(--color-surface);
  --galley-consent-text: var(--color-text);
  --galley-consent-border: var(--color-border);
  --galley-consent-radius: var(--radius-l);
  --galley-consent-shadow: var(--shadow-raised);
  --galley-button-bg: var(--color-accent);
  --galley-button-text: var(--color-accent-contrast);
  --galley-button-radius: var(--radius-button);
  --galley-field-focus: var(--color-accent);
}
.galley-mailto {
  --galley-mailto-bg: var(--color-surface);
  --galley-mailto-text: var(--color-text);
  --galley-mailto-border: var(--color-border);
  --galley-mailto-radius: var(--radius-m);
  --galley-mailto-shadow: var(--shadow-raised);
  --galley-field-focus: var(--color-accent);
}
`,
  );

  // ── The three ad-hoc forms become kit forms ───────────────────────────
  /** Replaces the text from `from` up to and including `to` (first occurrences, after `from`). */
  const swap = (/** @type {string} */ text, /** @type {string} */ from, /** @type {string} */ to, /** @type {string} */ insert) => {
    const start = text.indexOf(from);
    const end = text.indexOf(to, start) + to.length;

    if (start < 0 || end < to.length) throw new Error(`setup: “${from}” … “${to}” not found`);
    return text.slice(0, start) + insert + text.slice(end);
  };
  const importForm = (/** @type {string} */ text, /** @type {string} */ after) => text.replace(after, `${after}\nimport { Form } from "../../galley/components/index.js";`);

  edit(join(root, "src/components/sections/Contact.astro"), (text) =>
    swap(importForm(text, 'import SectionHeader from "../SectionHeader.astro";'), "    <form", "</form>", '    <div class="contact__form card"><Form id="contact" submitClass="button" /></div>'),
  );
  edit(join(root, "src/components/sections/HeroForm.astro"), (text) => {
    let out = importForm(text, 'import Checklist from "../Checklist.astro";');

    out = swap(out, '      <div class="field">', "    </form>", '      <Form id="demo" submitClass="button button--block" backClass="button button--secondary" />\n      {note && <p class="form-note">{note}</p>}\n    </div>');
    return out.replace(/<form\n\s+class="hero-form__form card"[\s\S]*?aria-labelledby=\{formHeadingId\}\n\s+>/, '<div class="hero-form__form card" role="group" aria-labelledby={formHeadingId}>');
  });
  edit(join(root, "src/components/sections/Newsletter.astro"), (text) =>
    swap(importForm(text, 'import Section from "../Section.astro";'), "    <form", "    </form>", '    <div class="newsletter__form"><Form id="newsletter" submitClass="button" />{note && <p class="form-note">{note}</p>}</div>'),
  );
  edit(join(root, "src/content/pages/about.md"), (text) =>
    text.replace("sections:\n", "sections:\n  - type: newsletter\n    heading: The maintenance notes\n    text: One email a month on planned maintenance, audits and inspections.\n    submit: Subscribe\n    note: Unsubscribe in one click.\n"),
  );
  return root;
}
