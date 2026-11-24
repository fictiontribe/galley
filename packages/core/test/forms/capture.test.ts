import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { FormDefinition } from "../../src/kit";
import { createFormCapture, originKind, type CaptureRequest } from "../../src/forms/capture";
import type { MailMessage } from "../../src/forms/mail";
import { createGuardedFetch, type Transport } from "../../src/forms/net";
import { contactForm, fakeSite, recordingBus, SITE_ID, tempHome } from "./helpers";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const SITE_ORIGIN = "https://example.com";

function setup(options: { mode?: "local" | "hosted"; working?: Record<string, FormDefinition | string>; published?: Record<string, FormDefinition | string>; hook?: Array<number>; previewUrl?: string } = {}) {
  const { home, cleanup } = tempHome();

  cleanups.push(cleanup);
  const site = fakeSite({ working: options.working ?? { contact: contactForm() }, published: options.published ?? { contact: contactForm() }, ...(options.previewUrl ? { previewUrl: options.previewUrl } : {}) });
  const events = recordingBus();
  const mails: MailMessage[] = [];
  const hookCalls: Array<{ url: string; body?: string }> = [];
  const transport: Transport = async (url, init) => {
    hookCalls.push({ url: url.toString(), body: init.body });
    const statuses = options.hook ?? [200];

    return { status: statuses[Math.min(hookCalls.length - 1, statuses.length - 1)]!, headers: {}, body: "" };
  };
  const capture = createFormCapture({
    home,
    registry: { get: async (id: string) => (id === site.id ? site : null) },
    events,
    mode: options.mode ?? "hosted",
    appUrl: () => "https://cms.example.com",
    mailer: { from: "inbox@cms.example.com", send: async (message) => void mails.push(message) },
    fetch: createGuardedFetch({ resolve: async () => [{ address: "93.184.216.34", family: 4 }], transport }),
    retry: { attempts: 3, delays: [0] },
    sleep: async () => {},
    log: () => {},
  });

  return { home, site, events, mails, hookCalls, capture };
}

function post(values: Record<string, unknown>, extra: Partial<CaptureRequest> & { form?: string; meta?: Record<string, unknown>; page?: unknown } = {}): CaptureRequest {
  const { form = "contact", meta, page, ...rest } = extra;

  return {
    siteId: SITE_ID,
    method: "POST",
    origin: SITE_ORIGIN,
    captureKey: null,
    contentType: "application/json",
    client: "203.0.113.7",
    body: JSON.stringify({ form, values, page: page ?? { url: "https://example.com/contact/?utm_source=news&email=x@y.z", title: "Contact", referrer: "https://search.example/?q=cafe" }, meta: meta ?? { elapsedMs: 9000 } }),
    ownOrigins: ["https://cms.example.com"],
    ...rest,
  };
}

const GOOD = { name: "Ada Lovelace", email: "ada@example.com", topic: "sales", message: "Table for 4?" };

describe("who may post", () => {
  it("accepts the site's production origin and its www. twin; refuses others with no detail", async () => {
    const { capture } = setup();

    expect((await capture.capture(post(GOOD))).status).toBe(200);
    expect((await capture.capture(post({ ...GOOD, name: "B" }, { origin: "https://www.example.com" }))).allowOrigin).toBe("https://www.example.com");
    const foreign = await capture.capture(post(GOOD, { origin: "https://evil.example" }));

    expect(foreign).toEqual({ status: 403, body: { ok: false }, allowOrigin: null });
    expect((await capture.capture(post(GOOD, { origin: "null" }))).status).toBe(403);
  });

  it("allows extra origins from the settings", async () => {
    const { capture } = setup();

    expect((await capture.capture(post(GOOD, { origin: "https://landing.example.net" }))).status).toBe(403);
    await capture.patchCaptureSettings(SITE_ID, { extraOrigins: ["https://landing.example.net/some/page"] });
    expect((await capture.capture(post(GOOD, { origin: "https://landing.example.net" }))).status).toBe(200);
  });

  it("loopback previews may post in local mode only", async () => {
    const local = setup({ mode: "local" });

    expect((await local.capture.capture(post(GOOD, { origin: "http://127.0.0.1:4321" }))).status).toBe(200);
    const hosted = setup({ mode: "hosted" });

    expect((await hosted.capture.capture(post(GOOD, { origin: "http://127.0.0.1:4321" }))).status).toBe(403);
    // Hosted previews are served on the app's own host name.
    expect((await hosted.capture.capture(post(GOOD, { origin: "https://cms.example.com:4410" }))).status).toBe(200);
  });

  it("a submission from the site's preview or the app is kept as a test; a visitor's is not, nor one from another page on this computer", async () => {
    const { capture } = setup({ mode: "local", previewUrl: "http://127.0.0.1:4321" });
    const testOf = async (response: { body: unknown }) => (await capture.get(SITE_ID, "contact", (response.body as { id: string }).id))?.test;
    const fromPreview = await capture.capture(post(GOOD, { origin: "http://127.0.0.1:4321" }));
    const fromApp = await capture.capture(post({ ...GOOD, name: "App" }, { origin: "https://cms.example.com" }));
    const fromVisitor = await capture.capture(post({ ...GOOD, name: "Visitor" }));
    // The site served on this computer some other way (a local server of its own): allowed, and an ordinary submission.
    const fromElsewhere = await capture.capture(post({ ...GOOD, name: "Local" }, { origin: "http://localhost:3000" }));
    // "Send a test" says so itself.
    const said = await capture.capture(post({ ...GOOD, name: "Said" }, { origin: "http://localhost:3000", meta: { elapsedMs: 9000, test: true } }));

    expect(await testOf(fromPreview)).toBe(true);
    expect(await testOf(fromApp)).toBe(true);
    expect(await testOf(fromVisitor)).toBeUndefined();
    expect(fromElsewhere.status).toBe(200);
    expect(await testOf(fromElsewhere)).toBeUndefined();
    expect(await testOf(said)).toBe(true);
  });

  it("names where a post comes from by one rule", () => {
    const known = { app: ["http://127.0.0.1:4860"], previews: ["http://127.0.0.1:50320"], mode: "local" as const, appHost: "127.0.0.1" };

    expect(originKind("http://127.0.0.1:4860", known)).toBe("app");
    expect(originKind("http://127.0.0.1:50320/", known)).toBe("preview");
    expect(originKind("http://127.0.0.1:8080", known)).toBe("loopback");
    expect(originKind("https://example.com", known)).toBe("other");
    expect(originKind("null", known)).toBe("invalid");
    // Hosted: every preview is on the app's host name; nothing is "this computer".
    expect(originKind("https://cms.example.com:4410", { ...known, app: ["https://cms.example.com"], previews: [], mode: "hosted", appHost: "cms.example.com" })).toBe("preview");
    expect(originKind("http://127.0.0.1:8080", { ...known, mode: "hosted", appHost: "cms.example.com" })).toBe("other");
  });

  it("no Origin: only with the site's capture key", async () => {
    const { capture } = setup();

    expect((await capture.capture(post(GOOD, { origin: null }))).status).toBe(403);
    const { key } = await capture.captureKey(SITE_ID, "rotate");

    expect(key).toMatch(/^ck_/);
    expect((await capture.capture(post(GOOD, { origin: null, captureKey: "ck_wrong" }))).status).toBe(403);
    const ok = await capture.capture(post(GOOD, { origin: null, captureKey: key }));

    expect(ok.status).toBe(200);
    expect(ok.allowOrigin).toBeNull();
    const settings = await capture.captureSettings(SITE_ID);

    expect(settings.captureKey).toMatchObject({ enabled: true, hint: key!.slice(-4) });
    expect(JSON.stringify(settings)).not.toContain(key);
    await capture.captureKey(SITE_ID, "remove");
    expect((await capture.capture(post({ ...GOOD, name: "C" }, { origin: null, captureKey: key }))).status).toBe(403);
  });

  it("preflight: allowed origins get CORS, others a bare 403, unknown sites 404", async () => {
    const { capture } = setup();

    expect(await capture.preflight({ siteId: SITE_ID, origin: SITE_ORIGIN, ownOrigins: [] })).toMatchObject({ status: 204, allowOrigin: SITE_ORIGIN });
    expect(await capture.preflight({ siteId: SITE_ID, origin: "https://evil.example", ownOrigins: [] })).toMatchObject({ status: 403, allowOrigin: null });
    expect((await capture.preflight({ siteId: "ffffffffffff", origin: SITE_ORIGIN, ownOrigins: [] })).status).toBe(404);
  });
});

describe("is it a real form", () => {
  it("unknown site and unknown form are refused; a form that doesn't send here is refused", async () => {
    const { capture } = setup({ working: { contact: contactForm(), hubonly: contactForm({ destinations: [{ provider: "hubspot", settings: { portalId: "1" } }] }) } });

    expect((await capture.capture(post(GOOD, { siteId: "ffffffffffff" }))).status).toBe(404);
    expect((await capture.capture(post(GOOD, { form: "nope" }))).status).toBe(404);
    expect((await capture.capture(post(GOOD, { form: "../../x" }))).status).toBe(404);
    expect((await capture.capture(post(GOOD, { form: "hubonly" }))).status).toBe(404);
  });

  it("field errors come back as 422 with plain messages", async () => {
    const { capture } = setup();
    const response = await capture.capture(post({ name: "", email: "not-an-email", topic: "other" }));

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ ok: false, errors: { name: "Fill this in.", email: "Enter an e-mail address, like name@example.com.", topic: "Choose one of the options given." } });
  });

  it("checks a visitor's submission against the PUBLISHED form, a preview's against the one being edited", async () => {
    const edited = contactForm({ fields: [...contactForm().fields, { id: "company", type: "text", label: "Company", required: true }] });
    const { capture } = setup({ mode: "local", working: { contact: edited }, published: { contact: contactForm() } });

    expect((await capture.capture(post(GOOD))).status).toBe(200);
    const preview = await capture.capture(post({ ...GOOD, name: "Preview" }, { origin: "http://127.0.0.1:4321" }));

    expect(preview.status).toBe(422);
    expect(preview.body).toEqual({ ok: false, errors: { company: "Fill this in." } });
  });

  it("refuses wrong content types, bad JSON and bodies over 64 KB", async () => {
    const { capture } = setup();

    expect((await capture.capture(post(GOOD, { contentType: "text/plain" }))).status).toBe(415);
    expect((await capture.capture(post(GOOD, { body: "{nope" }))).status).toBe(400);
    expect((await capture.capture(post({ ...GOOD, message: "x".repeat(70_000) }))).status).toBe(413);
  });
});

describe("spam", () => {
  it("a filled honeypot or a too-fast form is stored flagged and answered like any other; nothing is sent on", async () => {
    const { capture, mails } = setup({ working: { contact: contactForm({ spam: { minSeconds: 3 } }) }, published: { contact: contactForm({ spam: { minSeconds: 3 } }) } });

    await capture.patchCaptureSettings(SITE_ID, { notify: { contact: ["team@example.com"] } });
    const bot = await capture.capture(post(GOOD, { meta: { honeypot: "http://spam", elapsedMs: 9000 } }));
    const fast = await capture.capture(post({ ...GOOD, name: "Fast" }, { meta: { elapsedMs: 200 } }));

    expect(bot.status).toBe(200);
    expect(bot.body).toMatchObject({ ok: true });
    expect(fast.status).toBe(200);
    await capture.idle();
    const spam = await capture.list(SITE_ID, "contact", { filter: "spam" });

    expect(spam.items.map((item) => item.spamReason).sort()).toEqual(["honeypot", "too-fast"]);
    expect((await capture.list(SITE_ID, "contact")).total).toBe(0);
    expect(mails).toHaveLength(0);
  });

  it("Turnstile: verified when the form uses it and a secret is set; a failure is flagged", async () => {
    const { home, cleanup } = tempHome();

    cleanups.push(cleanup);
    const form = contactForm({ spam: { turnstileSiteKey: "0x4AAAAAAA" } });
    const site = fakeSite({ working: { contact: form }, published: { contact: form } });
    const tokens: string[] = [];
    const capture = createFormCapture({
      home,
      registry: { get: async () => site },
      events: recordingBus(),
      mode: "hosted",
      mailer: null,
      turnstileFetch: (async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { response: string };

        tokens.push(body.response);
        return new Response(JSON.stringify({ success: body.response === "good" }));
      }) as unknown as typeof fetch,
      log: () => {},
    });

    // No secret yet: nothing to verify with, so it isn't held against the visitor.
    expect((await capture.capture(post(GOOD, { meta: { elapsedMs: 9000 } }))).status).toBe(200);
    await capture.patchCaptureSettings(SITE_ID, { turnstileSecret: "0x4AAAAAAAsecret" });
    await capture.capture(post({ ...GOOD, name: "Good" }, { meta: { elapsedMs: 9000, turnstileToken: "good" } }));
    await capture.capture(post({ ...GOOD, name: "Bad" }, { meta: { elapsedMs: 9000, turnstileToken: "forged" } }));
    expect(tokens).toEqual(["good", "forged"]);
    const spam = await capture.list(SITE_ID, "contact", { filter: "spam" });

    expect(spam.items.map((item) => [item.values.name, item.spamReason])).toEqual([["Bad", "turnstile"]]);
    expect((await capture.captureSettings(SITE_ID)).turnstile).toEqual({ configured: true, hint: "cret" });
  });

  it("the 6th submission from one address in a minute gets 429 with Retry-After", async () => {
    const { capture } = setup();
    const statuses: number[] = [];

    for (let i = 0; i < 6; i += 1) statuses.push((await capture.capture(post({ ...GOOD, name: `V${i}` }))).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    const limited = await capture.capture(post({ ...GOOD, name: "V7" }));

    expect(limited.retryAfterSeconds).toBeGreaterThan(0);
    expect(limited.allowOrigin).toBe(SITE_ORIGIN);
    // Another visitor isn't held up.
    expect((await capture.capture(post({ ...GOOD, name: "Other" }, { client: "198.51.100.9" }))).status).toBe(200);
  });

  it("a per-form limit applies across visitors, and the limits are settings", async () => {
    const { capture } = setup();

    await capture.patchCaptureSettings(SITE_ID, { rateLimits: { perFormPerMinute: 2 } });
    const statuses: number[] = [];

    for (let i = 0; i < 3; i += 1) statuses.push((await capture.capture(post({ ...GOOD, name: `V${i}` }, { client: `198.51.100.${i}` }))).status);
    expect(statuses).toEqual([200, 200, 429]);
    await expect(capture.patchCaptureSettings(SITE_ID, { rateLimits: { perIpPerMinute: 0 } })).rejects.toThrow(/whole numbers/);
  });

  it("a repeat within a minute (a double click) gets the first id and is stored once", async () => {
    const { capture } = setup();
    const first = await capture.capture(post(GOOD));
    const again = await capture.capture(post(GOOD));

    expect(again.body).toEqual(first.body);
    expect((await capture.list(SITE_ID, "contact")).total).toBe(1);
  });
});

describe("store, announce, notify, forward", () => {
  it("stores the submission without the visitor's address; the page keeps only utm_*", async () => {
    const { capture, home, events } = setup();
    const response = await capture.capture(post(GOOD));
    const id = (response.body as { id: string }).id;
    const raw = readFileSync(`${home}/state/${SITE_ID}/submissions/contact.jsonl`, "utf8");

    expect(raw).not.toContain("203.0.113.7");
    const stored = await capture.get(SITE_ID, "contact", id);

    expect(stored).toMatchObject({ id, form: "contact", siteId: SITE_ID, values: GOOD, read: false, page: { url: "https://example.com/contact/?utm_source=news", title: "Contact", referrer: "https://search.example/" } });
    expect(events.events[0]).toMatchObject({ type: "forms.submission", change: "added", ids: [id], form: "contact" });
  });

  it("e-mails the form's addresses in the background and records the result", async () => {
    const { capture, mails, events } = setup();

    await capture.patchCaptureSettings(SITE_ID, { notify: { contact: ["Team@Example.com", "team@example.com"] } });
    const id = ((await capture.capture(post(GOOD))).body as { id: string }).id;

    await capture.idle();
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toEqual(["team@example.com"]);
    expect(mails[0]!.text).toContain(`https://cms.example.com/sites/${SITE_ID}/inbox?form=contact&id=${id}`);
    expect((await capture.get(SITE_ID, "contact", id)).delivery).toEqual([expect.objectContaining({ provider: "email", ok: true })]);
    expect(events.events.some((event) => event.type === "forms.submission" && event.change === "updated")).toBe(true);
  });

  it("without mail settings, says so instead of failing quietly", async () => {
    const { home, cleanup } = tempHome();

    cleanups.push(cleanup);
    const site = fakeSite({ working: { contact: contactForm() }, published: { contact: contactForm() } });
    const capture = createFormCapture({ home, registry: { get: async () => site }, events: recordingBus(), mode: "local", env: {}, log: () => {} });

    expect((await capture.captureSettings(SITE_ID)).mail).toEqual({ configured: false });
    await capture.patchCaptureSettings(SITE_ID, { notify: { contact: ["team@example.com"] } });
    const id = ((await capture.capture(post(GOOD))).body as { id: string }).id;

    await capture.idle();
    expect((await capture.get(SITE_ID, "contact", id)).delivery?.[0]).toMatchObject({ provider: "email", ok: false, attempts: 0 });
  });

  it("forwards server-side webhooks with retries and lets the inbox retry one", async () => {
    const form = contactForm({ destinations: [{ provider: "galley", settings: {} }, { provider: "webhook", settings: { url: "https://hooks.example.com/in", serverSide: true } }] });
    const { capture, hookCalls } = setup({ working: { contact: form }, published: { contact: form }, hook: [500, 500, 500, 200] });
    const id = ((await capture.capture(post(GOOD))).body as { id: string }).id;

    await capture.idle();
    expect(hookCalls).toHaveLength(3);
    expect((await capture.get(SITE_ID, "contact", id)).delivery).toEqual([expect.objectContaining({ provider: "webhook", destination: 1, ok: false, attempts: 3 })]);
    const retried = await capture.retry(SITE_ID, "contact", id, 1);

    expect(retried.delivery).toEqual([expect.objectContaining({ provider: "webhook", destination: 1, ok: true, attempts: 1 })]);
    await expect(capture.retry(SITE_ID, "contact", id, 0)).rejects.toThrow(/isn't sent from this server/);
  });

  it("forwarding in hosted mode refuses this server's own network", async () => {
    const { home, cleanup } = tempHome();

    cleanups.push(cleanup);
    const form = contactForm({ destinations: [{ provider: "galley", settings: {} }, { provider: "webhook", settings: { url: "http://127.0.0.1:9/hook", serverSide: true } }] });
    const site = fakeSite({ working: { contact: form }, published: { contact: form } });
    const capture = createFormCapture({ home, registry: { get: async () => site }, events: recordingBus(), mode: "hosted", mailer: null, retry: { attempts: 1, delays: [] }, log: () => {} });
    const id = ((await capture.capture(post(GOOD))).body as { id: string }).id;

    await capture.idle();
    expect((await capture.get(SITE_ID, "contact", id)).delivery?.[0]).toMatchObject({ ok: false, detail: "Only secure (https://) addresses can be used here." });
  });
});

describe("the inbox", () => {
  it("counts per form, lists newest first, filters, searches, pages", async () => {
    const { capture } = setup({ working: { contact: contactForm(), newsletter: contactForm({ name: "Newsletter" }) } });

    for (const name of ["Ada", "Grace", "Katherine"]) await capture.capture(post({ ...GOOD, name }, { client: name }));
    await capture.capture(post({ ...GOOD, name: "Bot" }, { client: "bot", meta: { honeypot: "x", elapsedMs: 9000 } }));
    const { forms, unread } = await capture.forms(SITE_ID);

    expect(forms.map((form) => [form.id, form.name, form.total, form.unread, form.spam, form.capturing])).toEqual([
      ["contact", "Contact us", 3, 3, 1, true],
      ["newsletter", "Newsletter", 0, 0, 0, true],
    ]);
    expect(unread).toBe(3);
    const list = await capture.list(SITE_ID, "contact");

    expect(list.items.map((item) => item.values.name)).toEqual(["Katherine", "Grace", "Ada"]);
    expect((await capture.list(SITE_ID, "contact", { q: "grace" })).items.map((item) => item.values.name)).toEqual(["Grace"]);
    expect((await capture.list(SITE_ID, "contact", { limit: 2, offset: 2 })).items.map((item) => item.values.name)).toEqual(["Ada"]);
    expect((await capture.list(SITE_ID, "contact", { filter: "all" })).total).toBe(4);
  });

  it("marks read and spam, deletes for good, restores for Undo", async () => {
    const { capture, events } = setup();
    const ids: string[] = [];

    for (const name of ["Ada", "Grace"]) ids.push(((await capture.capture(post({ ...GOOD, name }, { client: name }))).body as { id: string }).id);
    await capture.mark(SITE_ID, "contact", [ids[0]!], { read: true });
    expect((await capture.list(SITE_ID, "contact", { filter: "unread" })).items.map((item) => item.id)).toEqual([ids[1]]);
    await capture.mark(SITE_ID, "contact", [ids[1]!], { spam: true });
    expect((await capture.list(SITE_ID, "contact", { filter: "spam" })).items[0]).toMatchObject({ id: ids[1], spam: true, spamReason: "marked" });
    await capture.mark(SITE_ID, "contact", [ids[1]!], { spam: false });
    const deleted = await capture.remove(SITE_ID, "contact", ids);

    expect(deleted).toHaveLength(2);
    expect((await capture.list(SITE_ID, "contact", { filter: "all" })).total).toBe(0);
    expect(events.events.at(-1)).toMatchObject({ change: "deleted", ids });
    expect(await capture.restore(SITE_ID, "contact", deleted)).toBe(2);
    expect((await capture.list(SITE_ID, "contact")).total).toBe(2);
  });

  it("exports CSV in the form's field order", async () => {
    const { capture } = setup();

    await capture.capture(post(GOOD));
    const csv = await capture.exportCsv(SITE_ID, "contact");

    expect(csv.fileName).toMatch(/^contact-submissions-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.text.split("\r\n")[0]).toBe("﻿Received,Your name,E-mail,Topic,Message,Page,Referrer,Spam");
  });

  it("capture settings: address, reachability, origins, and validation of what's entered", async () => {
    const hosted = setup();
    const settings = await hosted.capture.captureSettings(SITE_ID);

    expect(settings).toMatchObject({
      captureAddress: `https://cms.example.com/f/${SITE_ID}`,
      captureReachable: true,
      origins: { site: ["https://example.com", "https://www.example.com"], extra: [], loopback: false },
      captureKey: { enabled: false },
      mail: { configured: true, from: "inbox@cms.example.com" },
      rateLimits: { perIpPerMinute: 5, perFormPerMinute: 60 },
    });
    const local = setup({ mode: "local" });
    const localSettings = await local.capture.captureSettings(SITE_ID);

    expect(localSettings.captureReachable).toBe(false);
    expect(localSettings.reachability).toBe("Submissions can only arrive when this app runs on a server visitors can reach. On this computer it works for testing.");
    await expect(hosted.capture.patchCaptureSettings(SITE_ID, { extraOrigins: ["not a url"] })).rejects.toThrow(/isn't a web address/);
    await expect(hosted.capture.patchCaptureSettings(SITE_ID, { notify: { contact: ["nope"] } })).rejects.toThrow(/isn't an e-mail address/);
    const withSecret = await hosted.capture.patchCaptureSettings(SITE_ID, { forwardSecrets: { "crm-token": "s3cret-value" } });

    expect(withSecret.forwardSecrets).toEqual(["crm-token"]);
    expect(JSON.stringify(withSecret)).not.toContain("s3cret-value");
  });

  it("lists a form whose file is gone but whose submissions remain, with a plain note", async () => {
    const { capture, site } = setup();

    await capture.capture(post(GOOD));
    site.working.clear();
    const { forms } = await capture.forms(SITE_ID);

    expect(forms[0]).toMatchObject({ id: "contact", path: null, capturing: false, total: 1, problem: "This form's file is gone. Its submissions are kept here until you delete them." });
  });

  it("leaves server-side destination settings out of the definition it hands the app", async () => {
    const form = contactForm({ destinations: [{ provider: "galley", settings: {} }, { provider: "webhook", settings: { url: "https://hooks.example.com/{{secret:x}}", serverSide: true, format: "form" } }] });
    const { capture } = setup({ working: { contact: form }, published: { contact: form } });
    const { forms } = await capture.forms(SITE_ID);

    expect(forms[0]!.definition!.destinations[1]).toEqual({ provider: "webhook", settings: { serverSide: true, format: "form" } });
  });
});

describe("a form posted without JavaScript", () => {
  it("maps inputs back to fields by mapping, name or id; a minimum time can't be measured, so it lands in Spam", async () => {
    const form = contactForm({
      fields: [...contactForm().fields, { id: "areas", type: "checkboxes", label: "Areas", name: "areas[]", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }],
      destinations: [{ provider: "galley", settings: {}, mapping: { email: "your-email" } }],
      spam: { minSeconds: 3 },
    });
    const { capture } = setup({ working: { contact: form }, published: { contact: form } });
    const body = new URLSearchParams([["_galley_form", "contact"], ["_galley_return", "https://example.com/contact/#galley-sent-contact"], ["_galley_hp", ""], ["name", "Ada"], ["your-email", "ada@example.com"], ["areas[]", "a"], ["areas[]", "b"]]).toString();
    const response = await capture.capture(post({}, { contentType: "application/x-www-form-urlencoded", body }));

    expect(response).toMatchObject({ status: 303, redirect: "https://example.com/contact/#galley-sent-contact" });
    const [stored] = (await capture.list(SITE_ID, "contact", { filter: "spam" })).items;

    expect(stored).toMatchObject({ values: { name: "Ada", email: "ada@example.com", areas: ["a", "b"] }, spamReason: "too-fast", page: { url: "https://example.com/contact/" } });
  });
});
