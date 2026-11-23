import { describe, expect, it } from "vitest";
import type { FormDestination, FormSubmission } from "../../src/kit";
import { DuplicateGuard, localSpamReason, RateLimiter, verifyTurnstile, TURNSTILE_VERIFY_URL } from "../../src/forms/spam";
import { destinationPayload, ForwarderRegistry, forwardWithRetries, serverSideDestinations, webhookForwarder, withSecrets, type ForwardContext } from "../../src/forms/forward";
import { createGuardedFetch, type ResolvedAddress, type Transport } from "../../src/forms/net";
import { createSmtpTransport, mailConfigFromEnv, notificationMessage } from "../../src/forms/mail";
import { trimPageUrl } from "../../src/forms/page";
import { contactForm, fakeSmtp, SITE_ID } from "./helpers";

describe("spam rules", () => {
  it("honeypot (on by default, can be switched off) and minimum seconds", () => {
    const form = contactForm();

    expect(localSpamReason(form, { honeypot: "buy now" })).toBe("honeypot");
    expect(localSpamReason(form, { honeypot: "" })).toBeNull();
    expect(localSpamReason(contactForm({ spam: { honeypot: false } }), { honeypot: "x" })).toBeNull();
    const timed = contactForm({ spam: { minSeconds: 3 } });

    expect(localSpamReason(timed, { elapsedMs: 800 })).toBe("too-fast");
    expect(localSpamReason(timed, {})).toBe("too-fast");
    expect(localSpamReason(timed, { elapsedMs: "5000" })).toBe("too-fast");
    expect(localSpamReason(timed, { elapsedMs: 3500 })).toBeNull();
  });

  it("rate limiter: a sliding window per key, with the wait until the next slot", () => {
    const limiter = new RateLimiter(60_000);

    for (let i = 0; i < 5; i += 1) expect(limiter.take("ip|1.2.3.4", 5, 1000 + i).ok).toBe(true);
    const sixth = limiter.take("ip|1.2.3.4", 5, 2000);

    expect(sixth).toEqual({ ok: false, retryAfterMs: 59_000 });
    expect(limiter.take("ip|5.6.7.8", 5, 2000).ok).toBe(true);
    expect(limiter.take("ip|1.2.3.4", 5, 61_001).ok).toBe(true);
  });

  it("duplicate guard: same answers within a minute, any key order", () => {
    const guard = new DuplicateGuard(60_000);

    guard.remember(SITE_ID, "contact", { a: "1", b: ["x"] }, "ID1", 0);
    expect(guard.find(SITE_ID, "contact", { b: ["x"], a: "1" }, 30_000)).toBe("ID1");
    expect(guard.find(SITE_ID, "contact", { a: "2", b: ["x"] }, 30_000)).toBeNull();
    expect(guard.find(SITE_ID, "other", { a: "1", b: ["x"] }, 30_000)).toBeNull();
    expect(guard.find(SITE_ID, "contact", { a: "1", b: ["x"] }, 60_001)).toBeNull();
  });

  it("Turnstile: posts secret + token to siteverify, never the visitor's address; failures fail closed", async () => {
    const calls: Array<{ url: string; body: Record<string, string> }> = [];
    const fake = (answer: unknown) =>
      (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, string> });
        return new Response(JSON.stringify(answer));
      }) as unknown as typeof fetch;

    expect(await verifyTurnstile("0x-secret", "tok", { fetch: fake({ success: true }) })).toEqual({ success: true, errors: [] });
    expect(calls[0]).toEqual({ url: TURNSTILE_VERIFY_URL, body: { secret: "0x-secret", response: "tok" } });
    expect(await verifyTurnstile("0x-secret", "tok", { fetch: fake({ success: false, "error-codes": ["timeout-or-duplicate"] }) })).toEqual({ success: false, errors: ["timeout-or-duplicate"] });
    expect((await verifyTurnstile("0x-secret", undefined)).success).toBe(false);
    expect((await verifyTurnstile("0x-secret", "x".repeat(2049))).success).toBe(false);
    const down = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;

    expect((await verifyTurnstile("0x-secret", "tok", { fetch: down })).success).toBe(false);
  });

  it("page addresses keep only utm_* parameters", () => {
    expect(trimPageUrl("https://example.com/contact/?email=ada%40x.com&utm_source=news&utm_medium=email&token=abc#top")).toBe("https://example.com/contact/?utm_source=news&utm_medium=email");
    expect(trimPageUrl("https://user:pw@example.com/")).toBe("https://example.com/");
    expect(trimPageUrl("javascript:alert(1)")).toBeNull();
    expect(trimPageUrl(42)).toBeNull();
  });
});

describe("forwarding", () => {
  const webhook = (settings: FormDestination["settings"], extra: Partial<FormDestination> = {}): FormDestination => ({ provider: "webhook", settings: { serverSide: true, ...settings }, ...extra });
  const submission: FormSubmission = { id: "01JTESTTESTTESTTESTTEST", siteId: SITE_ID, form: "contact", at: "2026-11-23T10:00:00.000Z", values: { name: "Ada", email: "ada@example.com", topic: "sales" } };

  function context(destination: FormDestination, answers: Array<{ status: number } | Error>, secrets: Record<string, string> = {}) {
    const requests: Array<{ url: string; method?: string; headers?: Record<string, string>; body?: string }> = [];
    const transport: Transport = async (url, init) => {
      requests.push({ url: url.toString(), ...init });
      const answer = answers[Math.min(requests.length - 1, answers.length - 1)]!;

      if (answer instanceof Error) throw answer;
      return { status: answer.status, headers: {}, body: "" };
    };
    const fetch = createGuardedFetch({ resolve: async () => [{ address: "93.184.216.34", family: 4 } as ResolvedAddress], transport });
    const form = contactForm({ destinations: [{ provider: "galley", settings: {} }, destination] });
    const ctx: ForwardContext = { siteId: SITE_ID, formId: "contact", form, index: 1, payload: destinationPayload(form, destination, submission.values), secret: (name) => secrets[name] ?? null, fetch, guard: {} };

    return { ctx, requests };
  }
  const noWait = async () => {};

  it("picks server-side destinations only, honouring “only when…”", () => {
    const form = contactForm({
      destinations: [
        { provider: "galley", settings: {} },
        { provider: "webhook", settings: { url: "https://hooks.example.com/browser" } },
        webhook({ url: "https://hooks.example.com/a" }),
        webhook({ url: "https://hooks.example.com/sales" }, { when: { field: "topic", equals: "sales" } }),
        webhook({ url: "https://hooks.example.com/help" }, { when: { field: "topic", equals: "help" } }),
      ],
    });

    expect(serverSideDestinations(form, submission.values).map((item) => item.index)).toEqual([2, 3]);
  });

  it("maps names and adds fixed values", () => {
    const destination = webhook({ url: "https://x.example.com" }, { mapping: { email: "Email" }, constants: { lead_source: "Website" } });

    expect(destinationPayload(contactForm(), destination, submission.values)).toEqual({ name: "Ada", Email: "ada@example.com", topic: "sales", lead_source: "Website" });
  });

  it("webhook: JSON by default, secrets substituted in the address and headers, retried after a 503", async () => {
    const destination = webhook({ url: "https://hooks.example.com/{{secret:hook}}", headers: { Authorization: "Bearer {{secret:token}}", Host: "evil" } });
    const { ctx, requests } = context(destination, [{ status: 503 }, { status: 200 }], { hook: "abc123", token: "t0ken" });
    const result = await forwardWithRetries(webhookForwarder, submission, destination, ctx, { attempts: 3, delays: [1] }, noWait);

    expect(result).toMatchObject({ provider: "webhook", destination: 1, ok: true, attempts: 2, detail: "Accepted (200)." });
    expect(requests[0]!.url).toBe("https://hooks.example.com/abc123");
    expect(requests[0]!.headers).toMatchObject({ authorization: "Bearer t0ken", "content-type": "application/json" });
    expect(requests[0]!.headers!.host).toBeUndefined();
    expect(JSON.parse(requests[0]!.body!)).toEqual({ form: "contact", formName: "Contact us", id: submission.id, at: submission.at, page: null, values: { name: "Ada", email: "ada@example.com", topic: "sales" } });
  });

  it("webhook: form encoding; no retry after a 400; gives up after the last attempt", async () => {
    const formDest = webhook({ url: "https://hooks.example.com/f", format: "form" });
    const once = context(formDest, [{ status: 400 }]);
    const refused = await forwardWithRetries(webhookForwarder, submission, formDest, once.ctx, { attempts: 3, delays: [1] }, noWait);

    expect(refused).toMatchObject({ ok: false, attempts: 1, detail: "The webhook answered 400." });
    expect(once.requests[0]!.body).toBe("name=Ada&email=ada%40example.com&topic=sales");
    const down = context(formDest, [new Error("ECONNREFUSED")]);
    const failed = await forwardWithRetries(webhookForwarder, submission, formDest, down.ctx, { attempts: 3, delays: [1, 1] }, noWait);

    expect(failed).toMatchObject({ ok: false, attempts: 3 });
    expect(failed.detail).toMatch(/couldn't be reached/);
  });

  it("a missing secret or a private address is reported, not retried", async () => {
    const destination = webhook({ url: "https://hooks.example.com/{{secret:missing}}" });
    const { ctx, requests } = context(destination, [{ status: 200 }]);
    const result = await forwardWithRetries(webhookForwarder, submission, destination, ctx, { attempts: 3, delays: [1] }, noWait);

    expect(result).toMatchObject({ ok: false, attempts: 1, detail: "The forwarding secret “missing” isn't set. Add it in the inbox's capture settings." });
    expect(requests).toHaveLength(0);
    expect(() => withSecrets("{{ secret:a }}", () => "x")).not.toThrow();
  });

  it("a provider nothing can send to is recorded plainly; plugins register forwarders", async () => {
    const destination: FormDestination = { provider: "crm-x", settings: { serverSide: true } };
    const { ctx } = context(destination, [{ status: 200 }]);

    expect((await forwardWithRetries(null, submission, destination, ctx)).detail).toMatch(/Nothing on this server can send to “crm-x”/);
    const registry = new ForwarderRegistry();
    const sent: string[] = [];
    const remove = registry.register({ id: "crm-x", send: async (item) => (sent.push(item.id), { ok: true }) });

    expect((await forwardWithRetries(registry.get("crm-x"), submission, destination, ctx)).ok).toBe(true);
    expect(sent).toEqual([submission.id]);
    remove();
    expect(registry.get("crm-x")).toBeNull();
  });
});

describe("e-mail notifications", () => {
  it("needs both GALLEY_SMTP_URL and GALLEY_MAIL_FROM, and says which is missing", () => {
    expect(mailConfigFromEnv({})).toEqual({ config: null, problem: null });
    expect(mailConfigFromEnv({ GALLEY_SMTP_URL: "smtp://localhost:25" }).problem).toMatch(/GALLEY_MAIL_FROM/);
    expect(mailConfigFromEnv({ GALLEY_MAIL_FROM: "a@b.co" }).problem).toMatch(/GALLEY_SMTP_URL/);
    expect(mailConfigFromEnv({ GALLEY_SMTP_URL: "http://x", GALLEY_MAIL_FROM: "a@b.co" }).problem).toMatch(/smtp:\/\//);
  });

  it("writes a plain message: answers as a table, the page, the campaign, a link; escapes HTML; no header injection", () => {
    const message = notificationMessage({
      to: ["team@example.com"],
      form: contactForm({ name: "Contact\r\nBcc: evil@x.com" }),
      formId: "contact",
      siteName: "Harbour Café",
      inboxUrl: "https://cms.example.com/sites/abc/inbox?form=contact&id=1",
      submission: {
        id: "1",
        siteId: SITE_ID,
        form: "contact",
        at: "2026-11-23T10:00:00.000Z",
        values: { name: "<script>x</script>", email: "ada@example.com", message: "Two\nlines" },
        page: { url: "https://example.com/contact/?utm_source=news&utm_campaign=autumn" },
      },
    });

    expect(message.subject).toBe("New submission to Contact Bcc: evil@x.com");
    expect(message.replyTo).toBe("ada@example.com");
    expect(message.text).toContain("Your name  <script>x</script>");
    expect(message.text).toContain("utm_source news");
    expect(message.text).toContain("Open it in the inbox: https://cms.example.com/sites/abc/inbox?form=contact&id=1");
    expect(message.html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(message.html).not.toContain("<script>");
  });

  it("delivers through a real SMTP conversation (a local fake server)", async () => {
    const smtp = await fakeSmtp();

    try {
      const transport = createSmtpTransport({ url: `smtp://127.0.0.1:${smtp.port}?ignoreTLS=true`, from: "inbox@cms.example.com" });

      await transport.send({ to: ["team@example.com"], subject: "New submission to Contact us", text: "Hello", html: "<p>Hello</p>" });
      expect(smtp.messages).toHaveLength(1);
      expect(smtp.messages[0]!.to).toEqual(["<team@example.com>"]);
      expect(smtp.messages[0]!.data).toContain("Subject: New submission to Contact us");
    } finally {
      await smtp.close();
    }
  });
});
