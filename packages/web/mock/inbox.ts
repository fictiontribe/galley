/**
 * The form inbox, answered from memory for `dev:mock`: one "Contact us" form
 * with a handful of submissions (one spam, one with a failed webhook), and
 * capture settings for a computer of one's own (not reachable by visitors).
 */
import type { CaptureSettings, InboxFormSummary } from "@galley/core/api";
import type { FormDefinition, FormSubmission } from "@galley/core/kit";
import type { ServerEvent } from "@galley/core/types";
import { MockError } from "./site.ts";
import type { Handlers } from "./backend.ts";

type InboxKey =
  | "GET /api/sites/:siteId/inbox"
  | "GET /api/sites/:siteId/inbox/:formId"
  | "GET /api/sites/:siteId/inbox/:formId/export"
  | "GET /api/sites/:siteId/inbox/:formId/:submissionId"
  | "PATCH /api/sites/:siteId/inbox/:formId"
  | "POST /api/sites/:siteId/inbox/:formId/delete"
  | "POST /api/sites/:siteId/inbox/:formId/restore"
  | "POST /api/sites/:siteId/inbox/:formId/:submissionId/retry"
  | "GET /api/sites/:siteId/capture"
  | "PATCH /api/sites/:siteId/capture"
  | "POST /api/sites/:siteId/capture/key";

const CONTACT: FormDefinition = {
  name: "Contact us",
  fields: [
    { id: "name", type: "text", label: "Your name", required: true },
    { id: "email", type: "email", label: "E-mail", required: true },
    { id: "topic", type: "select", label: "Topic", options: [{ value: "booking", label: "A booking" }, { value: "events", label: "Private events" }, { value: "other", label: "Something else" }] },
    { id: "message", type: "textarea", label: "Message" },
    { id: "utm_source", type: "hidden", autofill: { from: "utm", key: "utm_source" } },
  ],
  submitLabel: "Send",
  destinations: [{ provider: "galley", settings: {} }, { provider: "webhook", settings: { serverSide: true } }],
  afterSubmit: [{ type: "message", text: "Thanks — we’ll reply within a day." }],
};

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function seed(siteId: string): FormSubmission[] {
  const base = { siteId, form: "contact" };
  return [
    { ...base, id: "01JMOCK0000000000000000001", at: ago(60 * 26), values: { name: "Priya Raman", email: "priya@northwind.example", topic: "events", message: "We’d like to book the back room for 18 people on a Friday in March.\nIs there a set menu?" }, page: { url: "https://example.com/contact/?utm_source=newsletter&utm_campaign=spring", title: "Contact" }, read: true, delivery: [{ provider: "webhook", destination: 1, ok: true, attempts: 1, detail: "Accepted (200)." }] },
    { ...base, id: "01JMOCK0000000000000000002", at: ago(95), values: { name: "Tomás Ortega", email: "tomas@example.org", topic: "booking", message: "Can I move my booking from 7 to 8?" }, page: { url: "https://example.com/contact/", title: "Contact" }, read: false, delivery: [{ provider: "webhook", destination: 1, ok: false, attempts: 3, detail: "The webhook answered 503." }] },
    { ...base, id: "01JMOCK0000000000000000003", at: ago(12), values: { name: "Grace Liu", email: "grace@harbourlabs.example", topic: "other", message: "Do you do gift cards?" }, page: { url: "https://example.com/contact/?utm_source=google&utm_medium=cpc", title: "Contact" }, read: false },
    { ...base, id: "01JMOCK0000000000000000004", at: ago(5), values: { name: "Best SEO Deals", email: "deals@spam.example", message: "Rank #1 today" }, spam: true, spamReason: "honeypot", read: false },
  ];
}

export function inboxHandlers(emit: (event: ServerEvent) => void): Pick<Handlers, InboxKey> {
  const stores = new Map<string, FormSubmission[]>();
  const settings = new Map<string, CaptureSettings>();
  const items = (siteId: string) => {
    if (!stores.has(siteId)) stores.set(siteId, seed(siteId));
    return stores.get(siteId)!;
  };
  const captureOf = (siteId: string): CaptureSettings => {
    if (!settings.has(siteId)) {
      settings.set(siteId, {
        captureAddress: `http://127.0.0.1:4400/f/${siteId}`,
        captureReachable: false,
        captureReach: { kind: "this-computer", host: "127.0.0.1" },
        reachability: "Submissions can only arrive when this app runs on a server visitors can reach. On this computer it works for testing.",
        origins: { site: ["https://example.com", "https://www.example.com"], extra: [], loopback: true },
        captureKey: { enabled: false },
        notify: {},
        mail: { configured: false },
        turnstile: { configured: false },
        rateLimits: { perIpPerMinute: 5, perFormPerMinute: 60 },
        forwardSecrets: [],
      });
    }
    return settings.get(siteId)!;
  };
  const summary = (siteId: string): InboxFormSummary => {
    const all = items(siteId);
    const kept = all.filter((item) => !item.spam);
    return {
      id: "contact",
      name: CONTACT.name,
      path: "src/content/forms/contact.json",
      definition: CONTACT,
      capturing: true,
      total: kept.length,
      unread: kept.filter((item) => !item.read).length,
      spam: all.length - kept.length,
      latestAt: kept.at(-1)?.at ?? null,
    };
  };
  const checkForm = (formId: string) => {
    if (formId !== "contact") throw new MockError("not-found", "There's no such form on this site.");
  };
  const changed = (siteId: string, change: "updated" | "deleted", ids: string[]) => emit({ type: "forms.submission", siteId, form: "contact", change, ids });

  return {
    "GET /api/sites/:siteId/inbox": ({ params }) => {
      const form = summary(params.siteId);
      return { forms: [form], unread: form.unread };
    },
    "GET /api/sites/:siteId/inbox/:formId": ({ params, query }) => {
      checkForm(params.formId);
      const filter = query.filter ?? "inbox";
      const q = (query.q ?? "").toLowerCase();
      const limit = Number(query.limit ?? 50);
      const offset = Number(query.offset ?? 0);
      const matching = items(params.siteId)
        .filter((item) => (filter === "all" ? true : filter === "spam" ? item.spam : filter === "unread" ? !item.spam && !item.read : !item.spam))
        .filter((item) => !q || Object.values(item.values).some((value) => String(value).toLowerCase().includes(q)))
        .slice()
        .reverse();
      return { items: matching.slice(offset, offset + limit), total: matching.length, offset, limit };
    },
    "GET /api/sites/:siteId/inbox/:formId/export": ({ params }) => {
      checkForm(params.formId);
      const rows = [["Received", "Your name", "E-mail"], ...items(params.siteId).map((item) => [item.at, String(item.values.name ?? ""), String(item.values.email ?? "")])];
      return { kind: "bytes", type: "text/csv; charset=utf-8", body: Buffer.from(`﻿${rows.map((row) => row.join(",")).join("\r\n")}\r\n`) };
    },
    "GET /api/sites/:siteId/inbox/:formId/:submissionId": ({ params }) => {
      const found = items(params.siteId).find((item) => item.id === params.submissionId);
      if (!found) throw new MockError("not-found", "That submission isn't here any more. It may have been deleted.");
      return found;
    },
    "PATCH /api/sites/:siteId/inbox/:formId": ({ params, body }) => {
      checkForm(params.formId);
      const list = items(params.siteId);
      const out: FormSubmission[] = [];
      for (const item of list) {
        if (!body.ids.includes(item.id)) continue;
        if (body.read !== undefined) item.read = body.read;
        if (body.spam !== undefined) item.spam = body.spam;
        out.push(item);
      }
      changed(params.siteId, "updated", out.map((item) => item.id));
      return { items: out };
    },
    "POST /api/sites/:siteId/inbox/:formId/delete": ({ params, body }) => {
      checkForm(params.formId);
      const list = items(params.siteId);
      const deleted = list.filter((item) => body.ids.includes(item.id));
      stores.set(params.siteId, list.filter((item) => !body.ids.includes(item.id)));
      changed(params.siteId, "deleted", deleted.map((item) => item.id));
      return { deleted };
    },
    "POST /api/sites/:siteId/inbox/:formId/restore": ({ params, body }) => {
      checkForm(params.formId);
      const list = items(params.siteId);
      const fresh = body.submissions.filter((item) => !list.some((existing) => existing.id === item.id));
      stores.set(params.siteId, [...list, ...fresh].sort((a, b) => a.id.localeCompare(b.id)));
      changed(params.siteId, "updated", fresh.map((item) => item.id));
      return { restored: fresh.length };
    },
    "POST /api/sites/:siteId/inbox/:formId/:submissionId/retry": ({ params, body }) => {
      const found = items(params.siteId).find((item) => item.id === params.submissionId);
      if (!found) throw new MockError("not-found", "That submission isn't here any more.");
      const entry = { provider: body.destination === "email" ? "email" : "webhook", ...(body.destination === "email" ? {} : { destination: body.destination }), ok: true, attempts: 1, at: new Date().toISOString(), detail: "Accepted (200)." };
      found.delivery = [...(found.delivery ?? []).filter((item) => item.provider !== entry.provider), entry];
      changed(params.siteId, "updated", [found.id]);
      return found;
    },
    "GET /api/sites/:siteId/capture": ({ params }) => captureOf(params.siteId),
    "PATCH /api/sites/:siteId/capture": ({ params, body }) => {
      const current = captureOf(params.siteId);
      const next: CaptureSettings = {
        ...current,
        origins: { ...current.origins, extra: body.extraOrigins ?? current.origins.extra },
        notify: body.notify ? Object.fromEntries(Object.entries({ ...current.notify, ...body.notify }).filter(([, list]) => list.length)) : current.notify,
        rateLimits: { ...current.rateLimits, ...(body.rateLimits ?? {}) } as CaptureSettings["rateLimits"],
        turnstile: body.turnstileSecret === undefined ? current.turnstile : body.turnstileSecret ? { configured: true, hint: body.turnstileSecret.slice(-4) } : { configured: false },
        forwardSecrets: body.forwardSecrets
          ? [...new Set([...current.forwardSecrets, ...Object.keys(body.forwardSecrets)])].filter((name) => body.forwardSecrets![name] !== null).sort()
          : current.forwardSecrets,
      };
      settings.set(params.siteId, next);
      return next;
    },
    "POST /api/sites/:siteId/capture/key": ({ params, body }) => {
      const current = captureOf(params.siteId);
      const key = body.action === "rotate" ? `ck_mock${Math.random().toString(36).slice(2, 14)}` : null;
      const next: CaptureSettings = { ...current, captureKey: key ? { enabled: true, hint: key.slice(-4), createdAt: new Date().toISOString() } : { enabled: false } };
      settings.set(params.siteId, next);
      return { settings: next, key };
    },
  };
}
