import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFormCapture, type FormCaptureService } from "@galley/core/forms";
import type { FormDefinition } from "@galley/core/kit";
import type { SiteModel, SiteService } from "@galley/core/types";
import { createBus, fake, json, SITE_ID, testApp, TOKEN } from "./helpers";

const SITE_ORIGIN = "https://example.com";
const S = `/api/sites/${SITE_ID}`;
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const contact: FormDefinition = {
  name: "Contact us",
  fields: [
    { id: "name", type: "text", label: "Your name", required: true },
    { id: "email", type: "email", label: "E-mail", required: true },
  ],
  submitLabel: "Send",
  destinations: [{ provider: "galley", settings: {} }],
  afterSubmit: [],
};

function formsSite(): SiteService {
  const path = "src/content/forms/contact.json";
  const model = { name: "Site", urls: { production: SITE_ORIGIN }, collections: [{ id: "forms", path: "src/content/forms", kind: "data", format: "json" }] } as unknown as SiteModel;

  return fake<SiteService>("site", {
    id: SITE_ID,
    root: "/tmp/site-1",
    model: async () => model,
    listEntries: async () => ({ collection: "forms", total: 1, items: [{ path, slug: "contact", collection: "forms", title: "Contact", titleSource: "filename", url: null, status: "clean", modifiedAt: 0 }] }),
    readFile: async (asked: string) => {
      if (asked !== path) throw new Error(`no file ${asked}`);
      return { path, content: JSON.stringify(contact), hash: "h", binary: false };
    },
    readBase: async (asked: string) => (asked === path ? new TextEncoder().encode(JSON.stringify(contact)) : null),
    // No preview running: what marks a submission as a test is the app itself, its preview, or the post saying so.
    preview: () => ({ status: () => ({ state: "idle", url: null, baselineUrl: null, baselineSource: null, log: [] }), start: async () => { throw new Error("not in this test"); }, stop: async () => {}, restart: async () => { throw new Error("not in this test"); } }),
  });
}

function setup(overrides: Parameters<typeof testApp>[1] = {}) {
  const home = mkdtempSync(join(tmpdir(), "galley-server-forms-"));

  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  const site = formsSite();
  const events = createBus();
  const forms: FormCaptureService = createFormCapture({ home, registry: { get: async (id: string) => (id === SITE_ID ? site : null) }, events, mode: "hosted", mailer: null, appUrl: () => "https://cms.example.com", log: () => {} });
  const t = testApp({ site, events }, overrides);

  t.services.forms = forms;
  return { ...t, forms };
}

const values = { name: "Ada", email: "ada@example.com" };
const submission = (extra: Record<string, unknown> = {}) => ({ form: "contact", values, page: { url: "https://example.com/contact/" }, meta: { elapsedMs: 5000 }, ...extra });

function capture(t: ReturnType<typeof setup>, origin: string | null, body: unknown = submission(), headers: Record<string, string> = {}) {
  return t.raw("POST", `/f/${SITE_ID}`, { body, headers: { ...(origin ? { origin } : {}), ...headers } });
}

describe("the capture endpoint: CORS", () => {
  it("preflight: the site's origin gets exactly its own origin back, never * or credentials", async () => {
    const t = setup();
    const ok = await t.raw("OPTIONS", `/f/${SITE_ID}`, { headers: { origin: SITE_ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });

    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(SITE_ORIGIN);
    expect(ok.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(ok.headers.get("access-control-allow-headers")).toBe("content-type");
    expect(ok.headers.get("access-control-allow-credentials")).toBeNull();
    expect(ok.headers.get("vary")).toContain("Origin");
    const denied = await t.raw("OPTIONS", `/f/${SITE_ID}`, { headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });

    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it.each([
    [SITE_ORIGIN, 200, SITE_ORIGIN],
    ["https://www.example.com", 200, "https://www.example.com"],
    ["https://cms.example.com", 200, "https://cms.example.com"],
    ["https://evil.example", 403, null],
    ["https://example.com.evil.example", 403, null],
    ["http://example.com", 403, null],
    ["null", 403, null],
    ["http://127.0.0.1:4321", 403, null],
  ])("POST from %s → %i", async (origin, status, allow) => {
    const t = setup();
    const response = await capture(t, origin, submission({ values: { ...values, name: `From ${origin}` } }));

    expect(response.status).toBe(status);
    expect(response.headers.get("access-control-allow-origin")).toBe(allow);
    if (status === 403) expect(await json(response)).toEqual({ ok: false });
  });

  it("local mode lets previews on this computer post", async () => {
    const t = setup({ mode: "local" });
    const home = mkdtempSync(join(tmpdir(), "galley-server-forms-"));

    cleanups.push(() => rmSync(home, { recursive: true, force: true }));
    t.services.forms = createFormCapture({ home, registry: t.services.registry, events: t.services.events, mode: "local", mailer: null, log: () => {} });
    expect((await capture(t, "http://localhost:4321")).status).toBe(200);
  });

  it("no Origin: refused without the capture key, accepted with it (X-Capture-Key)", async () => {
    const t = setup();

    expect((await capture(t, null)).status).toBe(403);
    const key = (await json(await t.call("POST", `${S}/capture/key`, { action: "rotate" }))).key as string;

    expect((await capture(t, null, submission(), { "x-capture-key": "ck_nope" })).status).toBe(403);
    const ok = await capture(t, null, submission(), { "x-capture-key": key });

    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("X-Capture-Key supports idempotent X-Capture-Id and X-Captured-At over HTTP and rejects invalid headers or bad keys", async () => {
    const t = setup();
    const key = (await json(await t.call("POST", `${S}/capture/key`, { action: "rotate" }))).key as string;
    const captureId = "01JABCDEFGHJKMNPQRSTVW";
    const capturedAt = "2026-10-15T12:00:00.000Z";

    const first = await capture(t, null, submission(), { "x-capture-key": key, "x-capture-id": captureId, "x-captured-at": capturedAt });

    expect(first.status).toBe(200);
    expect(await json(first)).toEqual({ ok: true, id: captureId });
    expect((await json(await t.call("GET", `${S}/inbox/contact/${captureId}`))).at).toBe(capturedAt);

    const replay = await capture(t, null, submission(), { "x-capture-key": key, "x-capture-id": captureId, "x-captured-at": capturedAt });

    expect(replay.status).toBe(200);
    expect(await json(replay)).toEqual({ ok: true, id: captureId, duplicate: true });
    expect((await json(await t.call("GET", `${S}/inbox/contact`))).total).toBe(1);

    expect((await capture(t, null, submission(), { "x-capture-key": key, "x-capture-id": "bad-id" })).status).toBe(400);
    expect((await capture(t, null, submission(), { "x-capture-key": key, "x-captured-at": "not-a-timestamp" })).status).toBe(400);
    expect((await capture(t, SITE_ORIGIN, submission(), { "x-capture-key": "ck_wrong", "x-capture-id": captureId })).status).toBe(403);
  });
});

describe("the capture endpoint sits outside the session guard — and nothing else does", () => {
  it("accepts a cross-origin POST with no session, while the same request to the API is refused", async () => {
    const t = setup();
    const accepted = await capture(t, SITE_ORIGIN);

    expect(accepted.status).toBe(200);
    expect(accepted.headers.getSetCookie()).toEqual([]);
    const id = (await json(accepted)).id as string;
    // Same Origin, same lack of credentials, aimed at the inbox: CSRF guard, then session guard.
    const del = await t.raw("POST", `${S}/inbox/contact/delete`, { body: { ids: [id] }, headers: { origin: SITE_ORIGIN } });

    expect(del.status).toBe(403);
    expect(await json(del)).toEqual({ error: { code: "forbidden", message: "This request came from outside the app, so it was blocked." } });
    const read = await t.raw("GET", `${S}/inbox/contact`, { headers: { origin: SITE_ORIGIN } });

    expect(read.status).toBe(401);
    expect((await t.raw("GET", `${S}/capture`, {})).status).toBe(401);
    const patched = await t.raw("PATCH", `${S}/capture`, { body: { extraOrigins: ["https://evil.example"] }, headers: { origin: SITE_ORIGIN } });

    expect(patched.status).toBe(403);
    // The submission is still there.
    expect((await json(await t.call("GET", `${S}/inbox/contact`))).total).toBe(1);
  });

  it("ignores a session cookie or token entirely (it never reads one)", async () => {
    const t = setup();
    const response = await capture(t, "https://evil.example", submission(), { authorization: `Bearer ${TOKEN}` });

    expect(response.status).toBe(403);
  });

  it("still sits behind the Host check (DNS rebinding)", async () => {
    const t = setup({ allowedHosts: ["cms.example.com"] });
    const wrongHost = await t.app.request(`http://attacker.example/f/${SITE_ID}`, { method: "POST", headers: { origin: SITE_ORIGIN, "content-type": "application/json" }, body: JSON.stringify(submission()) });

    expect(wrongHost.status).toBe(403);
    const rightHost = await t.app.request(`http://cms.example.com/f/${SITE_ID}`, { method: "POST", headers: { origin: SITE_ORIGIN, "content-type": "application/json" }, body: JSON.stringify(submission()) });

    expect(rightHost.status).toBe(200);
  });

  it("GET on the capture address isn't the app's page", async () => {
    const t = setup();
    const response = await t.raw("GET", `/f/${SITE_ID}`);

    expect(response.status).toBe(405);
  });
});

describe("the capture endpoint's own rules over HTTP", () => {
  it("answers 422 with per-field messages, CORS included so the page can show them", async () => {
    const t = setup();
    const response = await capture(t, SITE_ORIGIN, submission({ values: { name: "", email: "nope" } }));

    expect(response.status).toBe(422);
    expect(response.headers.get("access-control-allow-origin")).toBe(SITE_ORIGIN);
    expect(await json(response)).toEqual({ ok: false, errors: { name: "Fill this in.", email: "Enter an e-mail address, like name@example.com." } });
  });

  it("rate limits with 429 and Retry-After", async () => {
    const t = setup();
    const statuses: number[] = [];
    let last: Response | null = null;

    for (let i = 0; i < 6; i += 1) {
      last = await capture(t, SITE_ORIGIN, submission({ values: { ...values, name: `V${i}` } }));
      statuses.push(last.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(last!.headers.get("access-control-expose-headers")).toBe("Retry-After");
    expect((await json(last!)).ok).toBe(false);
  });

  it("refuses a body over 64 KB with 413", async () => {
    const t = setup();
    const response = await capture(t, SITE_ORIGIN, submission({ values: { ...values, name: "x".repeat(70 * 1024) } }));

    expect(response.status).toBe(413);
  });

  it("unknown site and unknown form", async () => {
    const t = setup();

    expect((await t.raw("POST", "/f/ffffffffffff", { body: submission(), headers: { origin: SITE_ORIGIN } })).status).toBe(404);
    expect((await capture(t, SITE_ORIGIN, submission({ form: "nope" }))).status).toBe(404);
  });

  it("without a capture service the address answers 404 and the inbox says it isn't available", async () => {
    const t = testApp({ site: formsSite() });

    expect((await t.raw("POST", `/f/${SITE_ID}`, { body: submission(), headers: { origin: SITE_ORIGIN } })).status).toBe(404);
    const inbox = await t.call("GET", `${S}/inbox`);

    expect(inbox.status).toBe(400);
    expect((await json(inbox)).error.code).toBe("unconfigured");
  });
});

describe("a form posted without JavaScript", () => {
  const post = (t: ReturnType<typeof setup>, origin: string, fields: Record<string, string>) =>
    t.raw("POST", `/f/${SITE_ID}`, { body: new URLSearchParams(fields).toString(), headers: { origin, "content-type": "application/x-www-form-urlencoded" } });

  it("is stored and sends the visitor back to the page that posted it", async () => {
    const t = setup();
    const response = await post(t, SITE_ORIGIN, { _galley_form: "contact", _galley_return: "https://example.com/contact/#galley-sent-contact", _galley_hp: "", name: "Ada", email: "ada@example.com" });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://example.com/contact/#galley-sent-contact");
    expect((await json(await t.call("GET", `${S}/inbox/contact`))).items[0].values).toEqual({ name: "Ada", email: "ada@example.com" });
  });

  it("never redirects to another site; shows a small page instead", async () => {
    const t = setup();
    const response = await post(t, SITE_ORIGIN, { _galley_form: "contact", _galley_return: "https://evil.example/phish", name: "Ada", email: "ada@example.com" });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await response.text()).toContain("Thanks — your answers were sent.");
  });

  it("lists field problems by label, escaped, with a way back", async () => {
    const t = setup();
    const response = await post(t, SITE_ORIGIN, { _galley_form: "contact", _galley_return: "https://example.com/contact/", name: "<b>x</b>", email: "nope" });
    const html = await response.text();

    expect(response.status).toBe(422);
    expect(html).toContain("<strong>E-mail</strong>: Enter an e-mail address, like name@example.com.");
    expect(html).toContain('href="https://example.com/contact/"');
    expect(html).not.toContain("<b>x</b>");
  });

  it("a foreign origin is still refused, bare", async () => {
    const t = setup();
    const response = await post(t, "https://evil.example", { _galley_form: "contact", name: "M", email: "m@example.com" });

    expect(response.status).toBe(403);
  });
});

describe("the inbox routes", () => {
  it("lists, reads, marks, deletes, restores, exports, and keeps the settings", async () => {
    const t = setup();
    const id = (await json(await capture(t, SITE_ORIGIN))).id as string;
    const forms = await json(await t.call("GET", `${S}/inbox`));

    expect(forms.unread).toBe(1);
    expect(forms.forms[0]).toMatchObject({ id: "contact", name: "Contact us", total: 1, unread: 1, capturing: true });
    const list = await json(await t.call("GET", `${S}/inbox/contact?filter=inbox&q=ada&limit=10&offset=0`));

    expect(list.items.map((item: { id: string }) => item.id)).toEqual([id]);
    expect((await json(await t.call("GET", `${S}/inbox/contact/${id}`))).values).toEqual(values);
    expect((await t.call("GET", `${S}/inbox/contact/01NOTANIDNOTANIDNOTANI`)).status).toBe(404);
    const marked = await json(await t.call("PATCH", `${S}/inbox/contact`, { ids: [id], read: true }));

    expect(marked.items[0].read).toBe(true);
    expect((await t.call("PATCH", `${S}/inbox/contact`, { ids: [id] })).status).toBe(400);
    const deleted = await json(await t.call("POST", `${S}/inbox/contact/delete`, { ids: [id] }));

    expect(deleted.deleted).toHaveLength(1);
    expect((await json(await t.call("POST", `${S}/inbox/contact/restore`, { submissions: deleted.deleted }))).restored).toBe(1);
    const csv = await t.call("GET", `${S}/inbox/contact/export?filter=all`);

    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(csv.headers.get("content-disposition")).toMatch(/^attachment; filename="contact-submissions-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(csv.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await csv.arrayBuffer());

    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toContain("Received,Your name,E-mail,Page,Referrer,Spam");
    const settings = await json(await t.call("GET", `${S}/capture`));

    expect(settings).toMatchObject({ captureAddress: `https://cms.example.com/f/${SITE_ID}`, captureReachable: true, mail: { configured: false } });
    const patched = await json(await t.call("PATCH", `${S}/capture`, { notify: { contact: ["team@example.com"] }, turnstileSecret: "0x4AAAsecretvalue" }));

    expect(patched.notify).toEqual({ contact: ["team@example.com"] });
    expect(patched.turnstile).toEqual({ configured: true, hint: "alue" });
    expect(JSON.stringify(patched)).not.toContain("0x4AAAsecretvalue");
    expect((await t.call("PATCH", `${S}/capture`, { notify: { contact: ["nope"] } })).status).toBe(400);
    expect((await t.call("POST", `${S}/inbox/contact/${id}/retry`, { destination: "email" })).status).toBe(200);
  });

  it("introspection refuses a provider it can't read, and an unknown site", async () => {
    const t = setup();
    const refused = await t.call("POST", `${S}/forms/introspect`, { provider: "salesforce", settings: {} });

    expect(refused.status).toBe(400);
    expect((await json(refused)).error.message).toBe("Fields can't be read from this kind of form. Add them here by hand.");
    expect((await t.call("POST", "/api/sites/nope/forms/introspect", { provider: "hubspot", settings: {} })).status).toBe(404);
  });
});
