import { describe, expect, it } from "vitest";
import type { FormDefinition, FormField } from "../src/kit";
import { applies, payloadFor, problem, shownFields, submittedValues } from "../src/forms/logic.js";
import { DEFAULT_MESSAGES } from "../src/forms/messages.js";
import { FREE_EMAIL_DOMAINS } from "../src/forms/free-email-domains.js";
import { nativeTarget, renderForm, renderFormHtml } from "../src/forms/render.js";
import { inlineMarkdown, markdownParagraphs, plainText, safeUrl } from "../src/shared/markdown.js";
import { FIELD_TYPES } from "../src/schema.js";

const base = (fields: FormField[], extra: Partial<FormDefinition> = {}): FormDefinition => ({
  name: "Test form",
  submitLabel: "Send",
  fields,
  destinations: [{ provider: "galley", settings: { endpoint: "https://capture.example.test/f" } }],
  afterSubmit: [],
  ...extra,
});

/** Parse rendered HTML with the DOM the test environment does not have: a tiny helper over regex is enough here. */
const has = (html: string, fragment: string) => expect(html).toContain(fragment);

describe("markdown", () => {
  it("renders the inline subset and escapes everything else", () => {
    expect(inlineMarkdown("**Bold** and *it* and `x<y` <b>raw</b>")).toBe("<strong>Bold</strong> and <em>it</em> and <code>x&lt;y</code> &lt;b&gt;raw&lt;/b&gt;");
    expect(inlineMarkdown("[policy](/privacy/) [site](https://example.com)")).toBe('<a href="/privacy/">policy</a> <a href="https://example.com" rel="noopener">site</a>');
    expect(markdownParagraphs("One\nline\n\nTwo")).toBe("<p>One<br>line</p><p>Two</p>");
    expect(plainText("I agree to the [terms](/t/) and **privacy**.")).toBe("I agree to the terms and privacy.");
  });

  it("never lets an address run code, and never fills an answer into an address", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(inlineMarkdown("[x](javascript:alert(1))")).not.toContain("javascript:");
    expect(inlineMarkdown("Thanks {{name}}")).toBe('Thanks <span data-galley-value="name"></span>');
    expect(inlineMarkdown("[link]({{url}})")).toBe('<a href="">link</a>');
  });
});

describe("renderForm: every field type", () => {
  const options = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
  ];
  const fields: FormField[] = [
    { id: "full_name", type: "text", label: "Full name", required: true, help: "As on your badge", validation: { minLength: 2, maxLength: 80 } },
    { id: "email", type: "email", label: "Work email", required: true, width: "half" },
    { id: "phone", type: "tel", label: "Phone", width: "half" },
    { id: "website", type: "url", label: "Website", placeholder: "https://" },
    { id: "seats", type: "number", label: "Seats", validation: { min: 1, max: 500 } },
    { id: "message", type: "textarea", label: "Message", validation: { maxLength: 2000 } },
    { id: "plan", type: "select", label: "Plan", options, defaultValue: "b" },
    { id: "size", type: "radio", label: "Size", options, required: true },
    { id: "updates", type: "checkbox", label: "Send me updates" },
    { id: "topics", type: "checkboxes", label: "Topics", options, defaultValue: "a" },
    { id: "start", type: "date", label: "Start date" },
    { id: "campaign", type: "hidden", defaultValue: "spring" },
    { id: "agree", type: "consent", text: "I agree to the [privacy policy](/privacy/).", required: true },
    { id: "more", type: "heading", text: "A little more" },
    { id: "note", type: "paragraph", text: "We **never** share it." },
  ];
  const html = renderFormHtml(base(fields), "every", { pageUrl: "https://www.example.com/contact/" });

  it("covers the contract's field types", () => {
    expect(new Set(fields.map((field) => field.type))).toEqual(new Set(FIELD_TYPES));
  });

  it("ties labels, help and errors to inputs with native validation attributes", () => {
    has(html, '<label class="galley-form__label" for="galley-every-full_name">Full name<span class="galley-form__required" aria-hidden="true">*</span></label>');
    has(html, 'id="galley-every-full_name" name="full_name" class="galley-form__control" required aria-describedby="galley-every-full_name-help galley-every-full_name-error" type="text" autocomplete="name" minlength="2" maxlength="80"');
    has(html, '<p class="galley-form__help" id="galley-every-full_name-help">As on your badge</p>');
    has(html, '<p class="galley-form__error" id="galley-every-full_name-error" data-galley-error hidden></p>');
    has(html, 'type="email" autocomplete="email"');
    has(html, 'data-galley-field="email" data-type="email" data-width="half"');
    has(html, 'type="tel" autocomplete="tel"');
    has(html, 'type="url" autocomplete="url" placeholder="https://"');
    has(html, 'type="number" inputmode="decimal" min="1" max="500"');
    has(html, '<textarea id="galley-every-message" name="message" class="galley-form__control" aria-describedby="galley-every-message-error" rows="5" maxlength="2000"></textarea>');
    has(html, '<option value="">Choose one</option><option value="a">Alpha</option><option value="b" selected>Beta</option>');
    has(html, 'type="date"');
  });

  it("puts groups in a fieldset with a legend", () => {
    has(html, '<fieldset class="galley-form__field galley-form__group" data-galley-field="size" data-type="radio" aria-describedby="galley-every-size-error"><legend class="galley-form__label" id="galley-every-size-label">Size');
    has(html, '<input type="radio" id="galley-every-size-0" name="size" value="a" class="galley-form__choice" required><label for="galley-every-size-0">Alpha</label>');
    has(html, '<input type="checkbox" id="galley-every-topics-0" name="topics" value="a" class="galley-form__choice" checked>');
  });

  it("renders checkbox, consent (with its Markdown), hidden and layout fields", () => {
    has(html, 'class="galley-form__choice" aria-describedby="galley-every-updates-error" type="checkbox" value="true"><label class="galley-form__label" for="galley-every-updates">Send me updates</label>');
    has(html, 'class="galley-form__choice" required aria-describedby="galley-every-agree-error" type="checkbox" value="true"><label class="galley-form__label" for="galley-every-agree">I agree to the <a href="/privacy/">privacy policy</a>.');
    has(html, '<input type="hidden" id="galley-every-campaign" name="campaign" value="spring" data-galley-field="campaign" data-type="hidden">');
    has(html, '<h3 class="galley-form__heading">A little more</h3>');
    has(html, '<div class="galley-form__text"><p>We <strong>never</strong> share it.</p></div>');
  });

  it("works without JavaScript for a plain-post destination, with a honeypot and a no-JS return address", () => {
    has(html, 'action="https://capture.example.test/f" method="post" accept-charset="UTF-8" aria-label="Test form"');
    has(html, '<input type="hidden" name="_galley_form" value="every"><input type="hidden" name="_galley_return" value="https://www.example.com/contact/#galley-sent-every">');
    has(html, 'name="_galley_hp" tabindex="-1" autocomplete="off" data-galley-hp');
    has(html, 'id="galley-sent-every" tabindex="-1" data-galley-success hidden');
    expect(html).not.toContain("<noscript>");
  });

  it("escapes every text from the file", () => {
    const out = renderFormHtml(base([{ id: "x", type: "text", label: '<img src=x onerror="a()">' }], { submitLabel: "Go <b>" }), "esc");

    expect(out).toContain("&lt;img src=x onerror=&quot;a()&quot;&gt;");
    expect(out).toContain(">Go &lt;b&gt;</button>");
    expect(out).not.toContain("<img");
  });

  it("keeps `</script>` out of the embedded configuration", () => {
    const out = renderFormHtml(base([{ id: "x", type: "text", label: "</script><script>alert(1)</script>" }]), "cfg");
    const config = out.slice(out.indexOf("data-galley-form-config>"));

    expect(config.indexOf("</script>")).toBe(config.length - "</script></div>".length);
  });
});

describe("renderForm: labels, steps, conditions, slots", () => {
  it("hides labels visually but keeps the accessible name, and floats them on request", () => {
    const hidden = renderFormHtml(base([{ id: "email", type: "email", label: "Email" }], { appearance: { labels: "hidden" } }), "h");

    expect(hidden).toContain('class="galley-form__label galley-visually-hidden" for="galley-h-email">Email</label>');
    expect(hidden).toContain('placeholder="Email"');
    const floating = renderFormHtml(base([{ id: "email", type: "email", label: "Email" }], { appearance: { labels: "floating" } }), "f");

    expect(floating).toContain('placeholder=" "');
    expect(floating).toMatch(/<input[^>]+><label class="galley-form__label" for="galley-f-email">/);
  });

  it("renders every step as a fieldset, all visible without JavaScript, with back/next for the runtime", () => {
    const html = renderFormHtml(
      base(
        [
          { id: "email", type: "email", label: "Email", required: true },
          { id: "company", type: "text", label: "Company", step: 1 },
        ],
        { steps: [{ title: "You", nextLabel: "Continue" }, { title: "Your company" }] },
      ),
      "steps",
    );

    expect(html).toContain('data-steps="2"');
    expect(html).toContain('<fieldset class="galley-form__step" data-galley-step="0"><legend class="galley-form__step-title" tabindex="-1">You</legend>');
    expect(html).toContain('<fieldset class="galley-form__step" data-galley-step="1"><legend class="galley-form__step-title" tabindex="-1">Your company</legend>');
    expect(html).toContain('<p class="galley-form__progress" data-galley-progress hidden>Step 1 of 2</p>');
    expect(html).toContain('data-galley-next hidden>Continue</button>');
  });

  it("marks conditional fields, starting hidden ones for first paint, and leaves `required` to the runtime", () => {
    const html = renderFormHtml(
      base([
        { id: "topic", type: "select", label: "Topic", options: [{ value: "other", label: "Other" }] },
        { id: "detail", type: "text", label: "Detail", required: true, showWhen: { field: "topic", equals: "other" } },
      ]),
      "cond",
    );

    expect(html).toContain('data-galley-field="detail" data-type="text" data-galley-when data-galley-hidden');
    expect(html).not.toMatch(/id="galley-cond-detail"[^>]* required/);
  });

  it("gives the parts the component puts slots between", () => {
    const parts = renderForm(base([{ id: "email", type: "email", label: "Email" }]), "slots", { submitClass: "button" });

    expect(parts.submit).toBe('<button type="submit" class="galley-form__submit button" data-galley-submit>Send</button>');
    expect(parts.start.startsWith('<div class="galley-form" data-galley-form="slots"')).toBe(true);
    expect(parts.formEnd).toBe("</form>");
    expect(parts.end.endsWith("</script></div>")).toBe(true);
  });

  it("says, once, when the inbox has no capture address or a script action is left out", () => {
    const parts = renderForm(base([], { destinations: [{ provider: "galley", settings: {} }], afterSubmit: [{ type: "script", code: "x()" }] }), "warn");

    expect(parts.warnings).toHaveLength(2);
    expect(parts.config.afterSubmit).toEqual([]);
    expect(renderForm(base([], { afterSubmit: [{ type: "script", code: "x()" }] }), "ok", { allowFormScripts: true }).config.afterSubmit).toHaveLength(1);
  });

  it("uses the form's and the site's wording over the defaults", () => {
    const html = renderFormHtml(base([{ id: "a", type: "select", label: "A", options: [{ value: "x", label: "X" }] }], { messages: { choose: "Pick" } }), "words", { messages: { choose: "Select", honeypotLabel: "Skip" } });

    expect(html).toContain('<option value="" selected>Pick</option>');
    expect(html).toContain(">Skip</label>");
  });
});

describe("nativeTarget: which destinations work without JavaScript", () => {
  it("posts to the first destination that accepts a plain post", () => {
    expect(nativeTarget([{ provider: "hubspot", settings: { portalId: "1", formId: "x" } }], "")).toBeNull();
    expect(nativeTarget([{ provider: "marketo", settings: {} }], "")).toBeNull();
    expect(nativeTarget([{ provider: "webhook", settings: { url: "https://h.example/x" } }], "")).toBeNull();
    expect(nativeTarget([{ provider: "webhook", settings: { url: "https://h.example/x", format: "form" } }], "")?.action).toBe("https://h.example/x");
    expect(nativeTarget([{ provider: "salesforce", settings: { orgId: "00D000000000001", returnUrl: "https://e.example/t/" } }], "")).toEqual({
      index: 0,
      action: "https://webto.salesforce.com/servlet/servlet.WebToLead?encoding=UTF-8",
      hidden: { oid: "00D000000000001", retURL: "https://e.example/t/" },
    });
    expect(nativeTarget([{ provider: "pardot", settings: { handlerUrl: "https://go.example.com/l/1/x/y" } }], "")?.action).toBe("https://go.example.com/l/1/x/y");
    expect(nativeTarget([{ provider: "mailto", settings: { to: "a@example.com", subject: "Hi there" } }], "")).toEqual({ index: 0, action: "mailto:a@example.com?subject=Hi%20there", enctype: "text/plain", hidden: {} });
    expect(nativeTarget([{ provider: "hubspot", settings: {} }, { provider: "galley", settings: {} }], "https://c.example/f")?.index).toBe(1);
    expect(nativeTarget([{ provider: "galley", settings: {}, when: { field: "a", equals: "b" } }], "https://c.example/f")).toBeNull();
  });

  it("names the inputs as the native destination's mapping says, and sends its constants", () => {
    const html = renderFormHtml(
      base([{ id: "email", type: "email", label: "Email" }], { destinations: [{ provider: "salesforce", settings: { orgId: "00D000000000001" }, mapping: { email: "email" }, constants: { lead_source: "Web" } }] }),
      "sf",
    );

    expect(html).toContain('<input type="hidden" name="oid" value="00D000000000001"><input type="hidden" name="lead_source" value="Web">');
  });

  it("explains in a <noscript> when the form needs JavaScript", () => {
    const html = renderFormHtml(base([], { destinations: [{ provider: "hubspot", settings: { portalId: "1234", formId: "0f8fad5b-d9cb-469f-a165-70867728950e" } }] }), "hs");

    expect(html).toContain("data-galley-requires-js");
    expect(html).toContain(`<noscript><p class="galley-form__noscript">${DEFAULT_MESSAGES.noScript}</p></noscript>`);
    expect(html).not.toContain(" action=");
  });
});

describe("server-side destinations", () => {
  const form = base([{ id: "email", type: "email", label: "Email" }], {
    destinations: [
      { provider: "galley", settings: {} },
      { provider: "webhook", settings: { url: "https://hooks.example.test/{{secret:token}}", serverSide: true } },
    ],
  });

  it("are left out of the page entirely: the capture server forwards them", () => {
    const parts = renderForm(form, "srv", { endpoint: "https://capture.example.test/f" });

    expect(parts.config.destinations).toEqual([{ provider: "galley", settings: {} }]);
    expect(renderFormHtml(form, "srv", { endpoint: "https://capture.example.test/f" })).not.toContain("hooks.example.test");
    expect(nativeTarget([{ provider: "webhook", settings: { url: "https://h.example/x", format: "form", serverSide: true } }], "")).toBeNull();
    expect(applies({ provider: "webhook", settings: { url: "x", serverSide: true } }, {})).toBe(false);
  });
});

describe("logic", () => {
  const fields: FormField[] = [
    { id: "topic", type: "select", options: [{ value: "sales", label: "Sales" }, { value: "other", label: "Other" }] },
    { id: "detail", type: "text", showWhen: { field: "topic", equals: "other" } },
    { id: "deeper", type: "text", showWhen: { field: "detail", notEquals: "" } },
    { id: "team", type: "checkboxes", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
    { id: "lead", type: "text", showWhen: { field: "team", in: ["b"] } },
    { id: "note", type: "paragraph", text: "x" },
    { id: "agree", type: "consent", text: "Yes" },
  ];

  it("shows a field only while its condition holds, and hides what depends on a hidden field", () => {
    expect([...shownFields(fields, { topic: "sales", detail: "kept", team: [] })]).toEqual(["topic", "team", "note", "agree"]);
    expect(shownFields(fields, { topic: "other", detail: "x" }).has("deeper")).toBe(true);
    expect(shownFields(fields, { topic: "other", detail: "" }).has("deeper")).toBe(false);
    expect(shownFields(fields, { team: ["a", "b"] }).has("lead")).toBe(true);
  });

  it("sends only showing, non-layout fields — hidden ones are not submitted", () => {
    expect(submittedValues(fields, { topic: "sales", detail: "stale", team: ["a"], agree: "true" })).toEqual({ topic: "sales", team: ["a"], agree: "true" });
  });

  it("maps names per destination, adds constants, and reports unticked boxes as false", () => {
    const payload = payloadFor({ provider: "x", settings: {}, mapping: { topic: "Topic__c" }, constants: { lead_source: "Web" } }, fields, { topic: "other", detail: "hi", team: [], agree: "" });

    expect(payload.values).toEqual({ Topic__c: "other", detail: "hi", deeper: "", team: [], agree: "false", lead_source: "Web" });
    expect(payload.items.map((item) => item.name)).toEqual(["Topic__c", "detail", "deeper", "team", "agree"]);
  });

  it("reads a ticked box as “yes” in conditions, as the capture server and the app's builder do", () => {
    const boxes: FormField[] = [
      { id: "agree", type: "checkbox", label: "Agree" },
      { id: "why", type: "text", showWhen: { field: "agree", equals: "yes" } },
      { id: "unless", type: "text", showWhen: { field: "agree", notEquals: "yes" } },
    ];

    expect([...shownFields(boxes, { agree: "true" })]).toEqual(["agree", "why"]);
    expect([...shownFields(boxes, { agree: "" })]).toEqual(["agree", "unless"]);
    expect(applies({ provider: "x", settings: {}, when: { field: "agree", equals: "yes" } }, { agree: "true" }, boxes)).toBe(true);
    expect(applies({ provider: "x", settings: {}, when: { field: "agree", equals: "yes" } }, { agree: "" }, boxes)).toBe(false);
  });

  it("applies `when` to a destination", () => {
    expect(applies({ provider: "x", settings: {}, when: { field: "topic", equals: "sales" } }, { topic: "sales" })).toBe(true);
    expect(applies({ provider: "x", settings: {}, when: { field: "team", equals: "b" } }, { team: ["a", "b"] })).toBe(true);
    expect(applies({ provider: "x", settings: {}, when: { field: "topic", equals: "sales" } }, { topic: "other" })).toBe(false);
  });

  it("refuses answers with the form's words", () => {
    const m = DEFAULT_MESSAGES as unknown as Record<string, string>;
    const check = (field: FormField, value: string | string[]) => problem(field, value, m, FREE_EMAIL_DOMAINS);

    expect(check({ id: "a", type: "text", required: true }, "")).toBe(m.required);
    expect(check({ id: "a", type: "radio", required: true, options: [{ value: "x", label: "X" }] }, "")).toBe(m.requiredChoice);
    expect(check({ id: "a", type: "consent", required: true }, "")).toBe(m.requiredCheck);
    expect(check({ id: "a", type: "text" }, "")).toBe("");
    expect(check({ id: "e", type: "email" }, "nope")).toBe(m.email);
    expect(check({ id: "e", type: "email", validation: { businessEmailOnly: true } }, "kim@gmail.com")).toBe("Use your work email address. gmail.com is a personal mailbox.");
    expect(check({ id: "e", type: "email", validation: { businessEmailOnly: true } }, "kim@example.com")).toBe("");
    expect(check({ id: "u", type: "url" }, "example.com")).toBe(m.url);
    expect(check({ id: "t", type: "tel" }, "12")).toBe(m.tel);
    expect(check({ id: "n", type: "number", validation: { min: 2 } }, "1")).toBe("Enter 2 or more.");
    expect(check({ id: "n", type: "number", validation: { max: 2 } }, "3")).toBe("Enter 2 or less.");
    expect(check({ id: "d", type: "date" }, "13/01/2026")).toBe(m.date);
    expect(check({ id: "s", type: "text", validation: { minLength: 3 } }, "ab")).toBe("Use at least 3 characters.");
    expect(check({ id: "s", type: "text", validation: { pattern: "[A-Z]{3}" } }, "ABCD")).toBe(m.pattern);
    expect(check({ id: "s", type: "text", validation: { pattern: "[A-Z]{3}", message: "Three capitals." } }, "ab")).toBe("Three capitals.");
    expect(check({ id: "c", type: "select", options: [{ value: "x", label: "X" }] }, "forged")).toBe(m.requiredChoice);
  });
});
