// @vitest-environment happy-dom
// @vitest-environment-options { "url": "https://www.example.com/contact/?plan=team&utm_source=search" }
// The forms runtime on a server-rendered form: validation, conditions,
// steps, autofill, sending, after-submit actions, spam checks and events.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormDefinition } from "../src/kit";
import { initForms, KIT_VERSION, registerFormProvider } from "../src/client/forms.js";
import { renderFormHtml, type RenderOptions } from "../src/forms/render.js";

const sleep = (ms = 0) => new Promise((done) => setTimeout(done, ms));
const settle = async () => {
  for (let index = 0; index < 8; index += 1) await sleep(5);
};

function mount(definition: FormDefinition, id = "contact", options: RenderOptions = {}) {
  document.body.innerHTML = `<main>${renderFormHtml(definition, id, { endpoint: "https://capture.example.test/f/site", pageUrl: "https://www.example.com/contact/", ...options })}</main>`;
  initForms();
  const root = document.querySelector<HTMLElement>(".galley-form")!;
  const form = root.querySelector("form")!;
  const control = (field: string) => root.querySelector<HTMLInputElement>(`#galley-${id}-${field}`)!;
  const type = (field: string, value: string) => {
    const input = control(field);

    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const leave = (field: string) => control(field).dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
  const submit = async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
  };
  const error = (field: string) => root.querySelector<HTMLElement>(`#galley-${id}-${field}-error`)!;

  return { root, form, control, type, leave, submit, error };
}

const contact = (extra: Partial<FormDefinition> = {}): FormDefinition => ({
  name: "Contact",
  submitLabel: "Send",
  fields: [
    { id: "name", type: "text", label: "Name", required: true },
    { id: "email", type: "email", label: "Work email", required: true, validation: { businessEmailOnly: true } },
    { id: "topic", type: "select", label: "Topic", options: [{ value: "sales", label: "Sales" }, { value: "other", label: "Other" }] },
    { id: "detail", type: "text", label: "Tell us more", required: true, showWhen: { field: "topic", equals: "other" } },
    { id: "plan", type: "hidden", autofill: { from: "query", key: "plan" } },
  ],
  destinations: [{ provider: "galley", settings: {} }],
  afterSubmit: [{ type: "message", title: "Thanks, {{name}}", text: "We'll reply to **{{email}}**." }],
  spam: { honeypot: true },
  ...extra,
});

let requests: Array<{ url: string; init: RequestInit }> = [];
let answer: () => Response;

beforeEach(() => {
  requests = [];
  answer = () => new Response(JSON.stringify({ ok: true, id: "sub_1" }), { status: 200, headers: { "content-type": "application/json" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url: String(url), init });
      return answer();
    }),
  );
  localStorage.clear();
  (window as any).dataLayer = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("validation", () => {
  it("checks a field when the visitor leaves it, and clears the message as they fix it", () => {
    const page = mount(contact());

    page.type("email", "kim@gmail.com");
    page.leave("email");
    expect(page.error("email").textContent).toBe("Use your work email address. gmail.com is a personal mailbox.");
    expect(page.error("email").hidden).toBe(false);
    expect(page.control("email").getAttribute("aria-invalid")).toBe("true");
    expect(page.root.querySelector('[data-galley-field="email"]')!.hasAttribute("data-invalid")).toBe(true);
    page.type("email", "kim@example.com");
    expect(page.error("email").hidden).toBe(true);
    expect(page.control("email").hasAttribute("aria-invalid")).toBe(false);
  });

  it("doesn't complain about an empty field just because it was tabbed through", () => {
    const page = mount(contact());

    page.leave("name");
    expect(page.error("name").hidden).toBe(true);
  });

  it("on submit, shows a summary that takes focus and links to each field; nothing is sent and nothing typed is lost", async () => {
    const page = mount(contact());

    page.type("email", "not-an-address");
    await page.submit();
    const summary = page.root.querySelector<HTMLElement>(".galley-form__summary")!;

    expect(summary.hidden).toBe(false);
    expect(document.activeElement).toBe(summary);
    expect(summary.querySelector(".galley-form__summary-title")!.textContent).toBe("2 answers need checking.");
    expect([...summary.querySelectorAll("a")].map((link) => [link.getAttribute("href"), link.textContent])).toEqual([
      ["#galley-contact-name", "Name: Fill in this answer."],
      ["#galley-contact-email", "Work email: Enter an email address, like name@example.com."],
    ]);
    summary.querySelector("a")!.click();
    expect(document.activeElement).toBe(page.control("name"));
    expect(page.control("email").value).toBe("not-an-address");
    expect(requests).toEqual([]);
  });
});

describe("conditions", () => {
  it("shows a field only while its condition holds; a hidden field is disabled, unchecked and not sent", async () => {
    const page = mount(contact());
    const detail = page.root.querySelector<HTMLElement>('[data-galley-field="detail"]')!;
    const topic = page.control("topic") as unknown as HTMLSelectElement;

    expect(detail.hidden).toBe(true);
    expect(detail.hasAttribute("data-galley-hidden")).toBe(false);
    expect(page.control("detail").disabled).toBe(true);
    topic.value = "other";
    topic.dispatchEvent(new Event("change", { bubbles: true }));
    expect(detail.hidden).toBe(false);
    expect(page.control("detail").disabled).toBe(false);
    page.type("name", "Kim");
    page.type("email", "kim@example.com");
    await page.submit();
    expect(page.error("detail").textContent).toBe("Fill in this answer.");
    page.type("detail", "A question");
    topic.value = "sales";
    topic.dispatchEvent(new Event("change", { bubbles: true }));
    await page.submit();
    expect(JSON.parse(String(requests[0]!.init.body)).values).toEqual({ name: "Kim", email: "kim@example.com", topic: "sales", plan: "team" });
  });
});

describe("steps", () => {
  const stepped = contact({
    steps: [{ title: "About you", nextLabel: "Continue" }, { title: "Your question" }],
    fields: [
      { id: "name", type: "text", label: "Name", required: true },
      { id: "email", type: "email", label: "Email", required: true },
      { id: "question", type: "textarea", label: "Question", required: true, step: 1 },
    ],
    afterSubmit: [],
  });

  it("checks each step before moving on, keeps answers going back, and only offers Send on the last", async () => {
    const page = mount(stepped);
    const steps = [...page.root.querySelectorAll<HTMLElement>("[data-galley-step]")];
    const next = page.root.querySelector<HTMLButtonElement>("[data-galley-next]")!;
    const back = page.root.querySelector<HTMLButtonElement>("[data-galley-back]")!;
    const submit = page.root.querySelector<HTMLButtonElement>("[data-galley-submit]")!;
    const progress = page.root.querySelector<HTMLElement>("[data-galley-progress]")!;

    expect(steps.map((step) => step.hidden)).toEqual([false, true]);
    expect([next.hidden, back.hidden, submit.hidden, progress.textContent]).toEqual([false, true, true, "Step 1 of 2"]);
    expect(next.textContent).toBe("Continue");
    next.click();
    expect(steps[1]!.hidden).toBe(true);
    expect(page.error("name").textContent).toBe("Fill in this answer.");
    page.type("name", "Kim");
    page.type("email", "kim@example.com");
    // Enter on the first step means "next", not "send".
    await page.submit();
    expect(steps.map((step) => step.hidden)).toEqual([true, false]);
    expect(document.activeElement).toBe(steps[1]!.querySelector("legend"));
    expect([next.hidden, back.hidden, submit.hidden, progress.textContent]).toEqual([true, false, false, "Step 2 of 2"]);
    back.click();
    expect(page.control("name").value).toBe("Kim");
    next.click();
    page.type("question", "How does it work?");
    await page.submit();
    expect(JSON.parse(String(requests[0]!.init.body)).values).toEqual({ name: "Kim", email: "kim@example.com", question: "How does it work?" });
  });
});

describe("autofill", () => {
  it("fills from the address, UTM memory (first and last touch), cookies, the page and the referrer", () => {
    localStorage.setItem("galley:attribution", JSON.stringify({ first: { utm_source: "newsletter" }, last: { utm_source: "ads" } }));
    document.cookie = "partner=acme";
    const page = mount(
      contact({
        fields: [
          { id: "plan", type: "hidden", autofill: { from: "query", key: "plan" } },
          { id: "first", type: "hidden", autofill: { from: "utm", key: "utm_source", touch: "first" } },
          { id: "last", type: "hidden", autofill: { from: "utm", key: "utm_source" } },
          { id: "medium", type: "hidden", autofill: { from: "utm", key: "utm_medium" } },
          { id: "partner", type: "hidden", autofill: { from: "cookie", key: "partner" } },
          { id: "page", type: "hidden", autofill: { from: "page-url" } },
          { id: "title", type: "hidden", autofill: { from: "page-title" } },
          { id: "email", type: "email", label: "Email", autofill: { from: "query" } },
        ],
      }),
    );

    document.title = "Contact us";
    expect(page.control("plan").value).toBe("team");
    expect(page.control("first").value).toBe("newsletter");
    // This landing (?utm_source=search) is now the latest touch; the first stays.
    expect(page.control("last").value).toBe("search");
    expect(page.control("medium").value).toBe("");
    expect(page.control("partner").value).toBe("acme");
    expect(page.control("page").value).toBe("https://www.example.com/contact/?plan=team&utm_source=search");
    expect(page.control("email").value).toBe("");
  });

  it("remembers this landing's UTM parameters when no consent mode is on", () => {
    mount(contact());
    expect(JSON.parse(localStorage.getItem("galley:attribution")!).first).toMatchObject({ utm_source: "search", landing_page: "https://www.example.com/contact/" });
  });

  it("doesn't remember them while marketing isn't granted", () => {
    (window as any).galleyConsent = { mode: "banner", granted: () => false };
    mount(contact());
    expect(localStorage.getItem("galley:attribution")).toBeNull();
    delete (window as any).galleyConsent;
  });
});

describe("sending and after-submit actions", () => {
  const fill = (page: ReturnType<typeof mount>) => {
    page.type("name", "Kim <b>Lee</b>");
    page.type("email", "kim@example.com");
  };

  it("sends to the capture endpoint, then shows the thank-you with the answers as plain text and moves focus to it", async () => {
    const page = mount(contact());
    const events: string[] = [];

    page.root.addEventListener("galley:form:submit", () => events.push("submit"));
    page.root.addEventListener("galley:form:success", () => events.push("success"));
    fill(page);
    await page.submit();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://capture.example.test/f/site");
    const body = JSON.parse(String(requests[0]!.init.body));

    expect(body).toMatchObject({ form: "contact", values: { name: "Kim <b>Lee</b>", email: "kim@example.com", topic: "", plan: "team" }, page: { url: location.href } });
    expect(body.meta).toMatchObject({ honeypot: "", kit: KIT_VERSION });
    const success = page.root.querySelector<HTMLElement>("[data-galley-success]")!;

    expect(success.hidden).toBe(false);
    expect(page.form.hidden).toBe(true);
    expect(document.activeElement).toBe(success);
    expect(success.getAttribute("role")).toBe("status");
    expect(success.querySelector(".galley-form__success-title")!.innerHTML).toBe('Thanks, <span data-galley-value="name">Kim &lt;b&gt;Lee&lt;/b&gt;</span>');
    expect(success.textContent).toContain("We'll reply to kim@example.com.");
    expect(events).toEqual(["submit", "success"]);
  });

  it("runs events, a webhook beacon and a delayed redirect that carries the chosen fields", async () => {
    const beacon = vi.fn(() => true);
    const gtag = vi.fn();
    const assign = vi.fn();

    vi.stubGlobal("navigator", { ...navigator, sendBeacon: beacon, language: "en-GB" });
    (window as any).gtag = gtag;
    vi.spyOn(window.location, "assign").mockImplementation(assign);
    const page = mount(
      contact({
        afterSubmit: [
          { type: "event", name: "generate_lead", params: { plan: "{{plan}}" } },
          { type: "event", name: "sign_up", target: "gtag", params: { method: "form" } },
          { type: "event", name: "lead:sent", target: "dom" },
          { type: "webhook", url: "https://hooks.example.test/alert" },
          { type: "redirect", url: "/thanks/", passFields: ["plan", "email"], delaySeconds: 0.05 },
          { type: "message", text: "Taking you on." },
        ],
      }),
    );
    let dom = 0;

    page.root.addEventListener("lead:sent", () => (dom += 1));
    fill(page);
    await page.submit();
    expect((window as any).dataLayer).toEqual([{ event: "generate_lead", galley_form: "contact", plan: "team" }]);
    expect(gtag).toHaveBeenCalledWith("event", "sign_up", { method: "form" });
    expect(dom).toBe(1);
    expect(beacon).toHaveBeenCalledTimes(1);
    expect((beacon.mock.calls[0] as unknown[])[0]).toBe("https://hooks.example.test/alert");
    await sleep(120);
    expect(assign).toHaveBeenCalledWith("https://www.example.com/thanks/?plan=team&email=kim%40example.com");
    delete (window as any).gtag;
  });

  it("offers a download and starts it when asked", async () => {
    const page = mount(contact({ afterSubmit: [{ type: "download", url: "/files/guide.pdf", label: "Get the guide", auto: true }] }));
    const link = page.root.querySelector<HTMLAnchorElement>(".galley-form__download a")!;
    const clicked = vi.fn((event: Event) => event.preventDefault());

    link.addEventListener("click", clicked);
    fill(page);
    await page.submit();
    expect(link.textContent).toBe("Get the guide");
    expect(link.hasAttribute("download")).toBe(true);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("runs a script action only when the site allows form scripts", async () => {
    (window as any).ranWith = undefined;
    const withScript = contact({ afterSubmit: [{ type: "script", code: "window.ranWith = values.email;" }] });
    const off = mount(withScript);

    fill(off);
    await off.submit();
    expect((window as any).ranWith).toBeUndefined();
    const on = mount(withScript, "contact", { allowFormScripts: true });

    fill(on);
    await on.submit();
    expect((window as any).ranWith).toBe("kim@example.com");
  });

  it("puts the endpoint's field errors on the fields and keeps every answer", async () => {
    answer = () => new Response(JSON.stringify({ ok: false, errors: { email: "That address bounced last time." } }), { status: 422 });
    const page = mount(contact());
    const failed = vi.fn();

    page.root.addEventListener("galley:form:error", failed);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fill(page);
    await page.submit();
    expect(page.error("email").textContent).toBe("That address bounced last time.");
    expect(page.root.querySelector("[data-galley-status]")!.textContent).toBe("Couldn't send the form. Your answers are still here, so you can try again.");
    expect(page.form.hidden).toBe(false);
    expect(page.control("name").value).toBe("Kim <b>Lee</b>");
    expect(failed).toHaveBeenCalledTimes(1);
    expect(page.root.getAttribute("data-state")).toBe("idle");
  });

  it("says “try again in a moment” on 429", async () => {
    answer = () => new Response("", { status: 429 });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const page = mount(contact());

    fill(page);
    await page.submit();
    expect(page.root.querySelector("[data-galley-status]")!.textContent).toBe("Too many tries just now. Wait a moment, then send again.");
  });

  it("says how long to wait when the endpoint says (Retry-After)", async () => {
    answer = () => new Response(JSON.stringify({ ok: false }), { status: 429, headers: { "retry-after": "20" } });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const page = mount(contact());

    fill(page);
    await page.submit();
    expect(page.root.querySelector("[data-galley-status]")!.textContent).toBe("Too many tries just now. Try again in 20 seconds.");
  });

  it("never sends a server-side destination from the page", async () => {
    const seen: string[] = [];

    registerFormProvider("webhook-spy", async () => (seen.push("sent"), { ok: true }));
    const page = mount(contact({ destinations: [{ provider: "galley", settings: {} }, { provider: "webhook-spy", settings: { url: "https://hooks.example.test/x", serverSide: true } }] }));

    fill(page);
    await page.submit();
    expect(seen).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(document.body.innerHTML).not.toContain("hooks.example.test");
  });

  it("says the form isn't connected when the inbox has no address", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const page = mount(contact(), "contact", { endpoint: "" });

    fill(page);
    await page.submit();
    expect(requests).toEqual([]);
    expect(page.root.querySelector("[data-galley-status]")!.textContent).toBe("This form isn't connected yet, so it can't send. Your answers are still here.");
  });

  it("sends to every destination whose condition holds; the first decides success", async () => {
    const seen: string[] = [];

    registerFormProvider("crm", async (values) => {
      seen.push(`crm:${String(values.Email)}`);
      return { ok: false, detail: "down" };
    });
    registerFormProvider("sales-only", async () => {
      seen.push("sales");
      return { ok: true };
    });
    const page = mount(
      contact({
        destinations: [
          { provider: "galley", settings: {} },
          { provider: "crm", settings: {}, mapping: { email: "Email" } },
          { provider: "sales-only", settings: {}, when: { field: "topic", equals: "sales" } },
        ],
      }),
    );

    fill(page);
    await page.submit();
    expect(seen).toEqual(["crm:kim@example.com"]);
    expect(page.root.getAttribute("data-state")).toBe("sent");
  });
});

describe("spam checks", () => {
  it("a filled-in trap gets the thank-you and nothing is sent", async () => {
    const page = mount(contact());

    page.type("name", "Bot");
    page.type("email", "bot@example.com");
    page.root.querySelector<HTMLInputElement>("[data-galley-hp]")!.value = "https://spam.example";
    await page.submit();
    expect(requests).toEqual([]);
    expect(page.root.querySelector<HTMLElement>("[data-galley-success]")!.hidden).toBe(false);
  });

  it("a submission faster than minSeconds is held back with a plain explanation", async () => {
    const page = mount(contact({ spam: { minSeconds: 30 } }));

    page.type("name", "Kim");
    page.type("email", "kim@example.com");
    await page.submit();
    expect(requests).toEqual([]);
    expect(page.root.querySelector("[data-galley-status]")!.textContent).toBe("That was quick. Check your answers, then send again.");
  });
});
