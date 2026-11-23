// @vitest-environment happy-dom
// @vitest-environment-options { "url": "https://www.example.com/demo/", "settings": { "disableJavaScriptFileLoading": true, "disableIframePageLoading": true } }
// Each built-in destination against a fake of what it talks to, asserting the
// exact request: address, method, encoding, field names, context and cookies.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormDestination, FormField } from "../src/kit";
import type { SubmitContext } from "../src/client/types";
import { payloadFor } from "../src/forms/logic.js";
import { submit as hubspot, hubspotHost } from "../src/client/providers/hubspot.js";
import { submit as marketo } from "../src/client/providers/marketo.js";
import { submit as salesforce, SERVLET } from "../src/client/providers/salesforce.js";
import { submit as webhook } from "../src/client/providers/webhook.js";
import { submit as mailto } from "../src/client/providers/mailto.js";
import { DEFAULT_MESSAGES } from "../src/forms/messages.js";

const fields: FormField[] = [
  { id: "first", type: "text", label: "First name" },
  { id: "email", type: "email", label: "Email" },
  { id: "company", type: "text", label: "Company" },
  { id: "interests", type: "checkboxes", label: "Interests", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
  { id: "updates", type: "checkbox", label: "Updates" },
  { id: "process", type: "consent", text: "I agree to the [processing](/privacy/) of my data." },
  { id: "news", type: "consent", text: "Send me the **newsletter**." },
];
const answers = { first: "Kim", email: "kim@example.com", company: "Acme", interests: ["a", "b"], updates: "true", process: "true", news: "" };

function context(destination: FormDestination): [Record<string, string | string[]>, SubmitContext] {
  const form = document.createElement("form");

  document.body.append(form);
  const { values, items } = payloadFor(destination, fields, answers);

  return [
    values,
    {
      formId: "demo",
      form,
      fields,
      answers,
      items,
      page: { url: "https://www.example.com/demo/", title: "Book a demo", referrer: "" },
      meta: { elapsedMs: 4200, honeypot: "", locale: "en-GB", kit: "0.1.0" },
      messages: DEFAULT_MESSAGES as unknown as Record<string, string>,
    },
  ];
}

const run = (provider: typeof webhook, destination: FormDestination) => provider(...context(destination).slice(0, 1) as [any], destination, context(destination)[1]);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

// ── HubSpot ──────────────────────────────────────────────────────────────
describe("hubspot", () => {
  let calls: Array<{ url: string; init: RequestInit }>;
  let reply: Response;

  beforeEach(() => {
    calls = [];
    reply = new Response(JSON.stringify({ inlineMessage: "<p>Thanks</p>" }), { status: 200 });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => (calls.push({ url, init }), reply)));
    document.cookie = "hubspotutk=0123456789abcdef0123456789abcdef";
  });

  const destination: FormDestination = {
    provider: "hubspot",
    settings: { portalId: "12345678", formId: "0f8fad5b-d9cb-469f-a165-70867728950e" },
    mapping: { first: "firstname", company: "0-2/name", news: "consent:communication:999" },
    constants: { lifecyclestage: "lead" },
  };

  it("posts JSON to the documented endpoint with fields, hutk, page context and legal consent", async () => {
    const result = await run(hubspot, destination);

    expect(result).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.hsforms.com/submissions/v3/integration/submit/12345678/0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers).toEqual({ "content-type": "application/json" });
    const body = JSON.parse(String(calls[0]!.init.body));

    expect(body.submittedAt).toMatch(/^\d{13}$/);
    expect(body.fields).toEqual([
      { objectTypeId: "0-1", name: "firstname", value: "Kim" },
      { objectTypeId: "0-1", name: "email", value: "kim@example.com" },
      { objectTypeId: "0-2", name: "name", value: "Acme" },
      { objectTypeId: "0-1", name: "interests", value: "a;b" },
      { objectTypeId: "0-1", name: "updates", value: "true" },
      { objectTypeId: "0-1", name: "lifecyclestage", value: "lead" },
    ]);
    expect(body.context).toEqual({ hutk: "0123456789abcdef0123456789abcdef", pageUri: "https://www.example.com/demo/", pageName: "Book a demo" });
    expect(body.legalConsentOptions).toEqual({
      consent: {
        consentToProcess: true,
        text: "I agree to the processing of my data.",
        communications: [{ value: false, subscriptionTypeId: 999, text: "Send me the newsletter." }],
      },
    });
  });

  it("uses the regional host", () => {
    expect(hubspotHost("eu1")).toBe("https://api-eu1.hsforms.com");
    expect(hubspotHost("na1")).toBe("https://api.hsforms.com");
  });

  it("puts HubSpot's field errors on our fields", async () => {
    reply = new Response(JSON.stringify({ status: "error", errors: [{ message: "Error in 'fields.email'. Invalid email address", errorType: "INVALID_EMAIL" }] }), { status: 400 });
    const result = await run(hubspot, destination);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual({ email: DEFAULT_MESSAGES.email });
    expect(result.detail).toContain("INVALID_EMAIL");
  });

  it("asks to retry on 429", async () => {
    reply = new Response("{}", { status: 429 });
    expect(await run(hubspot, destination)).toMatchObject({ ok: false, retry: true });
  });
});

// ── Marketo ──────────────────────────────────────────────────────────────
describe("marketo", () => {
  const host = "https://go.example.com";
  const destination: FormDestination = { provider: "marketo", settings: { munchkinId: "123-ABC-456", formId: "1057", host }, mapping: { first: "FirstName", email: "Email", company: "Company" } };

  /** A stand-in for MktoForms2 that records what our code asks of it. */
  function fakeLibrary(outcome: "success" | "invalid") {
    const log: unknown[][] = [];
    let onSuccess: (values: unknown, url: string) => unknown = () => undefined;
    let onValidate: (ok: boolean) => void = () => undefined;
    const form = {
      getValues: () => ({ Email: "", FirstName: "", munchkinId: "123-ABC-456" }),
      setValues: (values: unknown) => log.push(["setValues", values]),
      addHiddenFields: (values: unknown) => log.push(["addHiddenFields", values]),
      onSuccess: (fn: typeof onSuccess) => (onSuccess = fn),
      onValidate: (fn: typeof onValidate) => (onValidate = fn),
      getFormElem: () => [document.getElementById("mktoForm_1057")],
      submit() {
        log.push(["submit"]);
        if (outcome === "invalid") {
          document.getElementById("mktoForm_1057")!.innerHTML = '<input class="mktoInvalid" name="Email"><div class="mktoErrorMsg">Must be valid email.</div>';
          onValidate(false);
        } else {
          log.push(["onSuccess returned", onSuccess({}, "https://go.example.com/thanks")]);
        }
      },
    };

    return {
      log,
      MktoForms2: {
        loadForm: (base: string, munchkin: string, id: number, cb: (f: typeof form) => void) => {
          log.push(["loadForm", base, munchkin, id, Boolean(document.getElementById(`mktoForm_${id}`))]);
          cb(form);
        },
      },
    };
  }

  it("loads Marketo's own library from the instance, then submits through a hidden Marketo form", async () => {
    const fake = fakeLibrary("success");
    let script: HTMLScriptElement | undefined;

    // Keep the script out of the document so nothing is fetched; we play its "load".
    vi.spyOn(document.head, "append").mockImplementation((node) => void (script = node as HTMLScriptElement));
    const pending = run(marketo, destination);

    expect(script?.src).toBe("https://go.example.com/js/forms2/js/forms2.min.js");
    (window as any).MktoForms2 = fake.MktoForms2;
    script!.onload!(new Event("load"));
    const result = await pending;

    expect(result).toMatchObject({ ok: true, redirect: "https://go.example.com/thanks" });
    expect(fake.log).toEqual([
      ["loadForm", "https://go.example.com", "123-ABC-456", 1057, true],
      ["setValues", { FirstName: "Kim", Email: "kim@example.com" }],
      ["addHiddenFields", { Company: "Acme", interests: "a;b", updates: "true", process: "true", news: "false" }],
      ["submit"],
      ["onSuccess returned", false],
    ]);
    const element = document.getElementById("mktoForm_1057")!;

    expect(element.hidden).toBe(true);
    expect(element.getAttribute("aria-hidden")).toBe("true");
  });

  it("brings Marketo's refusal back onto our field", async () => {
    vi.resetModules();
    const fresh = await import("../src/client/providers/marketo.js");
    const fake = fakeLibrary("invalid");

    (window as any).MktoForms2 = fake.MktoForms2;
    const [values, ctx] = context(destination);
    const result = await fresh.submit(values, destination, ctx);

    expect(result).toMatchObject({ ok: false, errors: { Email: "Must be valid email." } });
    delete (window as any).MktoForms2;
  });
});

// ── Salesforce and Account Engagement: real form posts into a frame ───────
describe("salesforce", () => {
  let posted: Array<{ action: string; method: string; target: string; charset: string; fields: Array<[string, string]> }>;

  beforeEach(() => {
    posted = [];
    vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function (this: HTMLFormElement) {
      posted.push({
        action: this.action,
        method: this.method,
        target: this.target,
        charset: this.acceptCharset,
        fields: [...this.querySelectorAll("input")].map((input) => [input.name, input.value]),
      });
      // The frame finishes loading Salesforce's answer.
      const frame = document.querySelector<HTMLIFrameElement>(`iframe[name="${this.target}"]`);

      setTimeout(() => frame?.dispatchEvent(new Event("load")), 5);
    });
  });

  const destination: FormDestination = {
    provider: "salesforce",
    settings: { orgId: "00D5g000000ABCD" },
    mapping: { first: "first_name", company: "company", interests: "00N5g00000Interest", updates: "00N5g00000Optin" },
    constants: { lead_source: "Web", Campaign_ID: "7015g000000XYZ" },
  };

  it("posts the Web-to-Lead form (oid, Salesforce names, custom field ids, ticked boxes as 1) into a hidden frame", async () => {
    const result = await run(salesforce, destination);

    expect(result).toMatchObject({ ok: true });
    expect(posted).toHaveLength(1);
    expect(posted[0]!.action).toBe(SERVLET);
    expect(SERVLET).toBe("https://webto.salesforce.com/servlet/servlet.WebToLead?encoding=UTF-8");
    expect(posted[0]!.method.toLowerCase()).toBe("post");
    expect(posted[0]!.charset).toBe("UTF-8");
    expect(posted[0]!.target).toMatch(/^galley-post-/);
    expect(posted[0]!.fields).toEqual([
      ["oid", "00D5g000000ABCD"],
      ["first_name", "Kim"],
      ["email", "kim@example.com"],
      ["company", "Acme"],
      ["00N5g00000Interest", "a"],
      ["00N5g00000Interest", "b"],
      ["00N5g00000Optin", "1"],
      ["process", "1"],
      ["lead_source", "Web"],
      ["Campaign_ID", "7015g000000XYZ"],
    ]);
    const frame = document.querySelector(`iframe[name="${posted[0]!.target}"]`)!;

    expect(frame.hasAttribute("hidden")).toBe(true);
    expect(frame.getAttribute("aria-hidden")).toBe("true");
  });

  it("with mode navigate, posts as a normal page change with retURL", async () => {
    const result = await run(salesforce, { ...destination, settings: { orgId: "00D5g000000ABCD", returnUrl: "https://www.example.com/thanks/", mode: "navigate" } });

    expect(result.ok).toBe(true);
    expect(posted[0]!.target).toBe("");
    expect(posted[0]!.fields.slice(0, 2)).toEqual([
      ["oid", "00D5g000000ABCD"],
      ["retURL", "https://www.example.com/thanks/"],
    ]);
  });
});

describe("pardot", () => {
  it("posts to the handler in a frame and reads its error location when it lands on this site", async () => {
    vi.resetModules();
    const answersFrom: Array<{ loaded: boolean; location: string | null }> = [
      { loaded: true, location: "https://www.example.com/forms/sent/" },
      { loaded: true, location: "https://www.example.com/forms/not-sent/?errorMessage=Email%20is%20required" },
      { loaded: true, location: null },
      { loaded: false, location: null },
    ];
    const calls: unknown[] = [];

    vi.doMock("../src/client/providers/frame-post.js", () => ({
      framePost: async (action: string, values: unknown, options: unknown) => (calls.push([action, values, options]), answersFrom.shift()),
    }));
    const { submit } = await import("../src/client/providers/pardot.js");
    const destination: FormDestination = {
      provider: "pardot",
      settings: { handlerUrl: "https://go.example.com/l/123456/2026-01-01/abc123", successLocation: "https://www.example.com/forms/sent/", errorLocation: "https://www.example.com/forms/not-sent/" },
      mapping: { email: "email", first: "first_name" },
    };
    const [values, ctx] = context(destination);

    expect(await submit(values, destination, ctx)).toMatchObject({ ok: true });
    expect(calls[0]).toEqual(["https://go.example.com/l/123456/2026-01-01/abc123", values, { navigate: false }]);
    expect(await submit(values, destination, ctx)).toMatchObject({ ok: false, detail: "The form handler refused the submission: Email is required" });
    expect(await submit(values, destination, ctx)).toMatchObject({ ok: true, detail: "Posted to the form handler; it does not tell the page more." });
    expect(await submit(values, destination, ctx)).toMatchObject({ ok: false });
    vi.doUnmock("../src/client/providers/frame-post.js");
  });
});

// ── Webhook and mail ─────────────────────────────────────────────────────
describe("webhook", () => {
  it("sends JSON by default and form-encoded on request", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];

    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response("", { status: 204 }))));
    expect(await run(webhook, { provider: "webhook", settings: { url: "https://hooks.example.test/a" } })).toMatchObject({ ok: true });
    expect(calls[0]!.init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ form: "demo", values: { first: "Kim", interests: ["a", "b"] }, page: { url: "https://www.example.com/demo/" } });
    await run(webhook, { provider: "webhook", settings: { url: "https://hooks.example.test/b", format: "form" } });
    expect(calls[1]!.init.body).toBeInstanceOf(URLSearchParams);
    expect(String(calls[1]!.init.body)).toBe("first=Kim&email=kim%40example.com&company=Acme&interests=a&interests=b&updates=true&process=true&news=false");
  });

  it("reports a server that doesn't allow this origin as not sent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await run(webhook, { provider: "webhook", settings: { url: "https://hooks.example.test/a" } })).toMatchObject({ ok: false });
  });
});

describe("mailto", () => {
  it("opens the mail program with labelled answers", async () => {
    const fakeLocation = { href: "" };

    vi.stubGlobal("location", fakeLocation);
    expect(await run(mailto, { provider: "mailto", settings: { to: "hello@example.com", subject: "Demo request" } })).toMatchObject({ ok: true });
    expect(fakeLocation.href).toBe(
      `mailto:hello@example.com?subject=Demo%20request&body=${encodeURIComponent("First name: Kim\nEmail: kim@example.com\nCompany: Acme\nInterests: a, b\nUpdates: true\nprocess: true\nnews: false")}`,
    );
  });
});

