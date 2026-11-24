/**
 * The form capture service: the public endpoint's rules and the inbox behind
 * it. The server hands it a plain description of each capture request and
 * sends back the plain answer it returns, so every rule here is tested
 * without HTTP.
 *
 * A capture request is answered in this order, cheapest refusal first:
 *   1. the site must be open on this server (404);
 *   2. the browser's Origin must be one of the site's own (403, no detail);
 *      a request without an Origin needs the site's capture key (403);
 *   3. the rate limits — per visitor address and per form (429 + Retry-After);
 *   4. JSON body of at most 64 KB naming a form that sends to the inbox (400/404);
 *   5. the answers are checked against the form definition (422 + per-field messages);
 *   6. spam checks — flagged and stored, answered like any other;
 *      a repeat within a minute is answered with the first one's id;
 *   7. stored; then, in the background: the live event, e-mail, forwarding.
 * The visitor's address is used for step 3 only, hashed, in memory; it is
 * never stored or sent anywhere.
 */
import type { CaptureSettings, CaptureSettingsPatch, FormIntrospectResult, InboxFilter, InboxFormSummary, SubmissionList } from "../api";
import { GalleyError } from "../errors";
import type { FormDefinition, FormSubmission } from "../kit";
import type { EventBus, JsonValue, SiteRegistry, SiteService } from "../types";
import { csvFileName, submissionsCsv } from "./csv";
import { capturesHere, listFormFiles, loadForm, type DefinitionSource } from "./definitions";
import { destinationPayload, ForwarderRegistry, forwardWithRetries, serverSideDestinations, webhookForwarder, DEFAULT_RETRY, type RetryPolicy } from "./forward";
import { createIdMinter, SUBMISSION_ID } from "./ids";
import { introspectForm } from "./introspect";
import { createSmtpTransport, mailConfigFromEnv, notificationMessage, type MailTransport } from "./mail";
import { createGuardedFetch, isPublicAddress, type GuardedFetch, type GuardOptions } from "./net";
import { storedPage } from "./page";
import { CaptureSettingsStore, normaliseOrigin } from "./settings";
import { DuplicateGuard, localSpamReason, RateLimiter, verifyTurnstile, type SpamReason } from "./spam";
import { checkFormId, FORM_ID_PATTERN, SubmissionStore } from "./store";
import { validateSubmission } from "./validate";

export const CAPTURE_BODY_LIMIT = 64 * 1024;
export const CAPTURE_KEY_HEADER = "x-capture-key";
export const INBOX_PAGE_MAX = 200;

/** What the server knows about one request to `/f/:siteId`. */
export interface CaptureRequest {
  siteId: string;
  method: string;
  /** The Origin header, when sent. */
  origin: string | null;
  /** The X-Capture-Key header, when sent. */
  captureKey: string | null;
  contentType: string | null;
  /** The visitor's address — used for rate limits only, never stored. */
  client: string;
  /** The raw body (already cut at the body limit by the server). */
  body: string;
  /** The app's own origins (the app may post a test submission). */
  ownOrigins: string[];
}

/** The answer to send. `allowOrigin` set means: send CORS headers for it. */
export interface CaptureResponse {
  status: number;
  body: { ok: true; id: string } | { ok: false; message?: string; errors?: { [fieldId: string]: string } } | null;
  allowOrigin: string | null;
  retryAfterSeconds?: number;
  /** A no-JavaScript form post: send the visitor back to the page (303) … */
  redirect?: string;
  /** … or show them this small page. */
  html?: string;
}

/** What a capture needs to remember to answer a no-JavaScript form post. */
interface PostContext {
  formPost: boolean;
  origin: string | null;
  returnUrl: string | null;
  form: FormDefinition | null;
}

export interface FormCaptureOptions {
  home: string;
  registry: Pick<SiteRegistry, "get">;
  events: EventBus;
  /** Local: previews on this computer may post, and webhooks may go to this computer. */
  mode: "local" | "hosted";
  env?: NodeJS.ProcessEnv;
  /** The app's address as people reach it, for the capture address and inbox links. */
  appUrl?: () => string | null;
  /** Overrides the SMTP transport from GALLEY_SMTP_URL (tests); null: no mail. */
  mailer?: MailTransport | null;
  /** Outbound requests (forwarding, introspection) with the SSRF guards. */
  fetch?: GuardedFetch;
  /** For Turnstile's siteverify. */
  turnstileFetch?: typeof fetch;
  forwarders?: ForwarderRegistry;
  retry?: RetryPolicy;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export interface InboxQuery {
  filter?: InboxFilter;
  q?: string;
  offset?: number;
  limit?: number;
}

const LOOPBACK_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/**
 * Where a post comes from, for the inbox's "Test" mark. A test is what only
 * the app sends: its own pages ("app": the inbox's "Send a test", the form
 * builder) and the pages of this site's running preview ("preview"; hosted,
 * every preview is on the app's host name, on a port of its own). Being on
 * the same computer isn't enough: a page served there some other way
 * ("loopback", local mode only) makes the same request a visitor would.
 * Anything else ("other") is judged by the site's allowed addresses.
 * A post can still say it is a test itself (`meta.test`).
 */
export function originKind(origin: string, known: { app: readonly string[]; previews: readonly string[]; mode: "local" | "hosted"; appHost: string | null }): "app" | "preview" | "loopback" | "other" | "invalid" {
  const normal = normaliseOrigin(origin);

  if (!normal) return "invalid";
  const host = new URL(normal).hostname;
  const listed = (list: readonly string[]) => list.some((item) => normaliseOrigin(item) === normal);

  if (listed(known.app)) return "app";
  if (listed(known.previews)) return "preview";
  if (known.mode === "hosted" && known.appHost && host === known.appHost) return "preview";
  if (known.mode === "local" && LOOPBACK_HOST.test(host)) return "loopback";
  return "other";
}

function json(status: number, body: CaptureResponse["body"], allowOrigin: string | null, extra: Partial<CaptureResponse> = {}): CaptureResponse {
  return { status, body, allowOrigin, ...extra };
}

/** The host name of an address, without IPv6 brackets; null when it can't be read. */
function hostOf(address: string): string | null {
  try {
    return new URL(address).hostname.replace(/^\[|\]$/g, "") || null;
  } catch {
    return null;
  }
}

/** "https://example.com" → also "https://www.example.com" (and back): one site, both addresses. */
function withTwin(origin: string): string[] {
  const url = new URL(origin);
  const twin = url.hostname.startsWith("www.") ? url.hostname.slice(4) : `www.${url.hostname}`;

  if (!twin.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return [origin];
  return [origin, `${url.protocol}//${twin}${url.port ? `:${url.port}` : ""}`];
}

function redacted(definition: FormDefinition): FormDefinition {
  return {
    ...definition,
    destinations: definition.destinations.map((destination) =>
      destination.settings?.serverSide === true ? { ...destination, settings: { serverSide: true, ...(typeof destination.settings.format === "string" ? { format: destination.settings.format } : {}) } } : destination
    ),
  };
}

function matches(submission: FormSubmission, q: string): boolean {
  const needle = q.toLowerCase();

  for (const value of Object.values(submission.values)) {
    for (const item of Array.isArray(value) ? value : [value]) if (item.toLowerCase().includes(needle)) return true;
  }
  return Boolean(submission.page?.url?.toLowerCase().includes(needle));
}

function filtered(items: FormSubmission[], filter: InboxFilter = "inbox"): FormSubmission[] {
  if (filter === "all") return items;
  if (filter === "spam") return items.filter((item) => item.spam);
  if (filter === "unread") return items.filter((item) => !item.spam && !item.read);
  return items.filter((item) => !item.spam);
}

export class FormCaptureService {
  readonly store: SubmissionStore;
  readonly settings: CaptureSettingsStore;
  readonly forwarders: ForwarderRegistry;
  private readonly mint = createIdMinter();
  private readonly limiter = new RateLimiter();
  private readonly duplicates = new DuplicateGuard();
  private readonly fetch: GuardedFetch;
  private readonly mail: { transport: MailTransport | null; problem: string | null };
  private readonly pending = new Set<Promise<unknown>>();
  private readonly log: (line: string) => void;

  constructor(private readonly options: FormCaptureOptions) {
    this.store = new SubmissionStore(options.home);
    this.settings = new CaptureSettingsStore(options.home);
    this.forwarders = options.forwarders ?? new ForwarderRegistry();
    if (!this.forwarders.get("webhook")) this.forwarders.register(webhookForwarder);
    this.fetch = options.fetch ?? createGuardedFetch();
    this.log = options.log ?? ((line) => process.stderr.write(`${line}\n`));
    if (options.mailer !== undefined) {
      this.mail = { transport: options.mailer, problem: null };
    } else {
      const { config, problem } = mailConfigFromEnv(options.env ?? process.env);

      this.mail = { transport: config ? createSmtpTransport(config) : null, problem };
    }
  }

  /** Waits for every background task (notifications, forwarding) started so far. */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private background(task: () => Promise<unknown>): void {
    const run = task().catch((error: unknown) => this.log(`[forms] background task failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`));

    this.pending.add(run);
    void run.finally(() => this.pending.delete(run));
  }

  private forwardGuard(): GuardOptions {
    // On a computer of one's own a catcher on this machine is the point of a test;
    // a hosted server must never be steered at its own network.
    return this.options.mode === "local" ? { allowHttp: true, allowPrivate: true } : {};
  }

  private appUrl(): string | null {
    return this.options.appUrl?.()?.replace(/\/+$/, "") ?? null;
  }

  // ─────────────────────────────────────────────────────────── who may post

  /** The origins allowed to post to a site, and whether loopback previews are too. */
  async allowedOrigins(site: SiteService): Promise<{ site: string[]; extra: string[]; loopback: boolean }> {
    const model = await site.model();
    const own = [model.urls.production, model.urls.staging]
      .map((url) => (url ? normaliseOrigin(url) : null))
      .filter((origin): origin is string => origin !== null)
      .flatMap(withTwin);
    const stored = await this.settings.read(site.id);

    return { site: [...new Set(own)], extra: stored.extraOrigins, loopback: this.options.mode === "local" };
  }

  /**
   * Whether `origin` may post; whether it is checked against the version of
   * the form being edited (`preview`: the app, its previews, and in local
   * mode any page on this computer, which is most likely the working copy);
   * and whether what it sends is a test (`test`: only the app and its
   * previews — see originKind).
   */
  async originVerdict(site: SiteService, origin: string, ownOrigins: string[]): Promise<{ allowed: boolean; preview: boolean; test: boolean }> {
    const appHost = (() => {
      const url = this.appUrl();

      try {
        return url ? new URL(url).hostname : null;
      } catch {
        return null;
      }
    })();
    const status = site.preview().status();
    const kind = originKind(origin, { app: ownOrigins, previews: [status.url, status.baselineUrl].filter((url): url is string => Boolean(url)), mode: this.options.mode, appHost });

    if (kind === "invalid") return { allowed: false, preview: false, test: false };
    if (kind === "app" || kind === "preview") return { allowed: true, preview: true, test: true };
    // Another page on this computer (the site served some other way) may post and sees the edited form, but what it sends is an ordinary submission.
    if (kind === "loopback") return { allowed: true, preview: true, test: false };
    const normal = normaliseOrigin(origin)!;
    const allowed = await this.allowedOrigins(site);

    return { allowed: allowed.site.includes(normal) || allowed.extra.includes(normal), preview: false, test: false };
  }

  /** The CORS preflight: allowed origins get the headers, anyone else a bare 403. */
  async preflight(request: Pick<CaptureRequest, "siteId" | "origin" | "ownOrigins">): Promise<CaptureResponse> {
    const site = await this.options.registry.get(request.siteId);

    if (!site || !request.origin) return json(site ? 403 : 404, null, null);
    const verdict = await this.originVerdict(site, request.origin, request.ownOrigins);

    return verdict.allowed ? json(204, null, request.origin) : json(403, null, null);
  }

  // ─────────────────────────────────────────────────────────── the endpoint

  /**
   * One request to the capture address. JSON from the site's script is the
   * contract; a urlencoded post is the same form without JavaScript (the
   * runtime's native fallback: `_galley_form`, `_galley_return`, `_galley_hp`
   * and the inputs under their own names) and is answered with a redirect
   * back to the page, or a small page of its own.
   */
  async capture(request: CaptureRequest): Promise<CaptureResponse> {
    const context: PostContext = { formPost: /^application\/x-www-form-urlencoded\b/i.test(request.contentType ?? ""), origin: request.origin, returnUrl: null, form: null };
    const response = await this.captureOnce(request, context);

    return context.formPost ? formPostAnswer(response, context) : response;
  }

  private async captureOnce(request: CaptureRequest, context: PostContext): Promise<CaptureResponse> {
    const site = await this.options.registry.get(request.siteId).catch(() => null);

    if (!site) return json(404, { ok: false, message: "No form here is taking submissions." }, null);
    let allowOrigin: string | null = null;
    let preview = false;
    let fromApp = false;

    if (request.origin !== null) {
      const verdict = await this.originVerdict(site, request.origin, request.ownOrigins);

      if (!verdict.allowed) return json(403, { ok: false }, null);
      allowOrigin = request.origin;
      preview = verdict.preview;
      fromApp = verdict.test;
    } else if (!request.captureKey || !(await this.settings.keyMatches(site.id, request.captureKey))) {
      return json(403, { ok: false }, null);
    }
    const limits = (await this.settings.read(site.id)).rateLimits;
    const perIp = this.limiter.take(`ip|${site.id}|${request.client}`, limits.perIpPerMinute);

    if (!perIp.ok) return this.tooMany(perIp.retryAfterMs, allowOrigin);
    if (!context.formPost && !/^application\/json\b/i.test(request.contentType ?? "")) {
      return json(415, { ok: false, message: "Send the form as JSON (Content-Type: application/json)." }, allowOrigin);
    }
    if (Buffer.byteLength(request.body, "utf8") > CAPTURE_BODY_LIMIT) return json(413, { ok: false, message: "That's more than a form can send. Shorten the answers and try again." }, allowOrigin);
    let payload: { form?: unknown; values?: unknown; page?: unknown; meta?: Record<string, unknown> };
    let posted: URLSearchParams | null = null;

    if (context.formPost) {
      posted = new URLSearchParams(request.body);
      context.returnUrl = posted.get("_galley_return");
      // Without JavaScript nothing measures the time on the page: a form with a minimum time flags these as spam (kept, recoverable).
      payload = { form: posted.get("_galley_form") ?? undefined, page: { url: context.returnUrl ?? undefined }, meta: { honeypot: posted.get("_galley_hp") ?? "" } };
    } else {
      try {
        payload = JSON.parse(request.body) as typeof payload;
      } catch {
        return json(400, { ok: false, message: "The form's answers couldn't be read." }, allowOrigin);
      }
    }
    if (!payload || typeof payload !== "object" || typeof payload.form !== "string" || !FORM_ID_PATTERN.test(payload.form)) {
      return json(404, { ok: false, message: "No form here is taking submissions." }, allowOrigin);
    }
    const formId = payload.form;
    const perForm = this.limiter.take(`form|${site.id}|${formId}`, limits.perFormPerMinute);

    if (!perForm.ok) return this.tooMany(perForm.retryAfterMs, allowOrigin);
    const source: DefinitionSource = preview ? "working" : "published";
    const loaded = await loadForm(site, formId, source).catch(() => null);

    if (!loaded || !capturesHere(loaded.definition)) return json(404, { ok: false, message: "This form isn't taking submissions here." }, allowOrigin);
    const form = loaded.definition;

    context.form = form;
    const outcome = validateSubmission(form, posted ? valuesFromFormPost(form, posted) : payload.values);

    if (Object.keys(outcome.errors).length) {
      return json(422, { ok: false, errors: outcome.errors, ...(form.errorMessage ? { message: form.errorMessage } : {}) }, allowOrigin);
    }
    const meta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
    let spamReason: SpamReason | null = localSpamReason(form, meta);

    if (!spamReason && form.spam?.turnstileSiteKey) {
      const secret = (await this.settings.secrets(site.id)).turnstile;

      if (secret) {
        const result = await verifyTurnstile(secret, meta.turnstileToken, this.options.turnstileFetch ? { fetch: this.options.turnstileFetch } : {});

        if (!result.success) spamReason = "turnstile";
      }
    }
    const repeat = this.duplicates.find(site.id, formId, outcome.values);

    if (repeat) return json(200, { ok: true, id: repeat }, allowOrigin);
    const submission: FormSubmission = {
      id: this.mint(),
      siteId: site.id,
      form: formId,
      at: new Date().toISOString(),
      values: outcome.values,
      read: false,
    };
    const page = storedPage(payload.page);

    if (page) submission.page = page;
    if (spamReason) {
      submission.spam = true;
      submission.spamReason = spamReason;
    }
    // The live site never posts from the app or its preview, so what arrives from one is a test, said or not.
    if (meta.test === true || fromApp) submission.test = true;
    await this.store.append(submission);
    this.duplicates.remember(site.id, formId, outcome.values, submission.id);
    this.options.events.emit({ type: "forms.submission", siteId: site.id, form: formId, change: "added", ids: [submission.id], submission });
    if (!submission.spam) this.background(() => this.afterStore(site, form, submission));
    return json(200, { ok: true, id: submission.id }, allowOrigin);
  }

  private tooMany(retryAfterMs: number, allowOrigin: string | null): CaptureResponse {
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

    return json(429, { ok: false, message: `Too many submissions in a short time. Wait ${seconds === 1 ? "a second" : `${seconds} seconds`} and send it again.` }, allowOrigin, { retryAfterSeconds: seconds });
  }

  /** E-mail and forwarding, in parallel, each result recorded on the submission. */
  private async afterStore(site: SiteService, form: FormDefinition, submission: FormSubmission): Promise<void> {
    const tasks: Array<Promise<NonNullable<FormSubmission["delivery"]>[number] | null>> = [this.sendNotification(site, form, submission)];

    for (const { index } of serverSideDestinations(form, submission.values)) tasks.push(this.forwardOne(site.id, form, submission, index));
    const results = (await Promise.all(tasks)).filter((item): item is NonNullable<typeof item> => item !== null);

    if (results.length) await this.recordDelivery(site.id, submission, results);
  }

  private async recordDelivery(siteId: string, submission: FormSubmission, results: NonNullable<FormSubmission["delivery"]>): Promise<FormSubmission | null> {
    const key = (item: { provider: string; destination?: number }) => `${item.provider}#${item.destination ?? "-"}`;
    const [updated] = await this.store.update(siteId, submission.form, [submission.id], (item) => {
      const kept = (item.delivery ?? []).filter((entry) => !results.some((result) => key(result) === key(entry)));

      return { ...item, delivery: [...kept, ...results] };
    });

    if (updated) this.options.events.emit({ type: "forms.submission", siteId, form: submission.form, change: "updated", ids: [submission.id], submission: updated });
    return updated ?? null;
  }

  private async sendNotification(site: SiteService, form: FormDefinition, submission: FormSubmission): Promise<NonNullable<FormSubmission["delivery"]>[number] | null> {
    const to = (await this.settings.read(site.id)).notify[submission.form] ?? [];

    if (!to.length) return null;
    const base = { provider: "email", at: new Date().toISOString(), attempts: 1 };

    if (!this.mail.transport) return { ...base, attempts: 0, ok: false, detail: "No e-mail was sent: this server has no mail settings (GALLEY_SMTP_URL and GALLEY_MAIL_FROM)." };
    const app = this.appUrl();
    const inboxUrl = app ? `${app}/sites/${encodeURIComponent(site.id)}/inbox?form=${encodeURIComponent(submission.form)}&id=${submission.id}` : null;
    const siteName = (await site.model().catch(() => null))?.name ?? "your site";

    try {
      await this.mail.transport.send(notificationMessage({ to, form, formId: submission.form, siteName, submission, inboxUrl }));
      return { ...base, ok: true, detail: `Sent to ${to.join(", ")}.` };
    } catch (error) {
      this.log(`[forms] notification for ${site.id}/${submission.form}/${submission.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      return { ...base, ok: false, detail: `The e-mail couldn't be sent: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}` };
    }
  }

  private async forwardOne(siteId: string, form: FormDefinition, submission: FormSubmission, index: number): Promise<NonNullable<FormSubmission["delivery"]>[number]> {
    const destination = form.destinations[index]!;
    const secrets = (await this.settings.secrets(siteId)).forward;

    return forwardWithRetries(
      this.forwarders.get(destination.provider),
      submission,
      destination,
      {
        siteId,
        formId: submission.form,
        form,
        index,
        payload: destinationPayload(form, destination, submission.values),
        secret: (name) => secrets[name] ?? null,
        fetch: this.fetch,
        guard: this.forwardGuard(),
      },
      this.options.retry ?? DEFAULT_RETRY,
      this.options.sleep
    );
  }

  // ─────────────────────────────────────────────────────────── the inbox

  private async site(siteId: string): Promise<SiteService> {
    const site = await this.options.registry.get(siteId);

    if (!site) throw new GalleyError("not-found", "That site isn't open here. Open it again from the Sites screen.");
    return site;
  }

  async forms(siteId: string): Promise<{ forms: InboxFormSummary[]; unread: number }> {
    const site = await this.site(siteId);
    const files = await listFormFiles(site);
    const stored = await this.store.formIds(site.id);
    const ids = [...new Set([...files.map((file) => file.id), ...stored])];
    const forms: InboxFormSummary[] = [];

    for (const id of ids) {
      const file = files.find((item) => item.id === id);
      const items = stored.includes(id) ? await this.store.list(site.id, id) : [];
      const kept = items.filter((item) => !item.spam);
      const summary: InboxFormSummary = {
        id,
        name: file?.definition?.name ?? id,
        path: file?.path ?? null,
        definition: file?.definition ? redacted(file.definition) : null,
        capturing: Boolean(file?.definition && capturesHere(file.definition)),
        total: kept.length,
        unread: kept.filter((item) => !item.read).length,
        spam: items.length - kept.length,
        latestAt: kept.length ? kept[kept.length - 1]!.at : null,
      };

      if (!file) summary.problem = "This form's file is gone. Its submissions are kept here until you delete them.";
      else if (!file.definition) summary.problem = file.problem ?? "This form's file can't be read.";
      forms.push(summary);
    }
    // Forms that send here first, then by name.
    forms.sort((a, b) => Number(b.capturing) - Number(a.capturing) || a.name.localeCompare(b.name));
    return { forms, unread: forms.reduce((sum, form) => sum + form.unread, 0) };
  }

  async list(siteId: string, formId: string, query: InboxQuery = {}): Promise<SubmissionList> {
    const site = await this.site(siteId);
    const all = await this.store.list(site.id, checkFormId(formId));
    const q = query.q?.trim() ?? "";
    const matching = filtered(all, query.filter).filter((item) => !q || matches(item, q)).reverse();
    const limit = Math.min(Math.max(1, query.limit ?? 50), INBOX_PAGE_MAX);
    const offset = Math.max(0, query.offset ?? 0);

    return { items: matching.slice(offset, offset + limit), total: matching.length, offset, limit };
  }

  async get(siteId: string, formId: string, id: string): Promise<FormSubmission> {
    const site = await this.site(siteId);
    const found = SUBMISSION_ID.test(id) ? await this.store.get(site.id, checkFormId(formId), id) : null;

    if (!found) throw new GalleyError("not-found", "That submission isn't here any more. It may have been deleted.");
    return found;
  }

  async mark(siteId: string, formId: string, ids: string[], flags: { read?: boolean; spam?: boolean }): Promise<FormSubmission[]> {
    const site = await this.site(siteId);
    const items = await this.store.update(site.id, checkFormId(formId), ids, (item) => {
      const next = { ...item };

      if (flags.read !== undefined) next.read = flags.read;
      if (flags.spam !== undefined) {
        next.spam = flags.spam;
        if (!flags.spam) delete next.spamReason;
        else next.spamReason ??= "marked";
      }
      return next;
    });

    if (items.length) this.options.events.emit({ type: "forms.submission", siteId: site.id, form: formId, change: "updated", ids: items.map((item) => item.id) });
    return items;
  }

  async remove(siteId: string, formId: string, ids: string[]): Promise<FormSubmission[]> {
    const site = await this.site(siteId);
    const removed = await this.store.remove(site.id, checkFormId(formId), ids);

    if (removed.length) this.options.events.emit({ type: "forms.submission", siteId: site.id, form: formId, change: "deleted", ids: removed.map((item) => item.id) });
    return removed;
  }

  async restore(siteId: string, formId: string, items: FormSubmission[]): Promise<number> {
    const site = await this.site(siteId);
    const clean = items.filter((item) => SUBMISSION_ID.test(item.id)).map((item) => ({ ...item, siteId: site.id, form: checkFormId(formId) }));
    const restored = await this.store.restore(site.id, formId, clean);

    if (restored) this.options.events.emit({ type: "forms.submission", siteId: site.id, form: formId, change: "updated", ids: clean.map((item) => item.id) });
    return restored;
  }

  async retry(siteId: string, formId: string, id: string, destination: number | "email"): Promise<FormSubmission> {
    const site = await this.site(siteId);
    const submission = await this.get(site.id, formId, id);
    const loaded = await loadForm(site, formId, "published");

    if (!loaded) throw new GalleyError("not-found", "This form's file is gone, so there's nothing to send to.");
    let result: NonNullable<FormSubmission["delivery"]>[number] | null;

    if (destination === "email") {
      result = await this.sendNotification(site, loaded.definition, submission);
      if (!result) throw new GalleyError("invalid", "No one is set to be told about this form. Add an address in the capture settings.");
    } else {
      const target = loaded.definition.destinations[destination];

      if (!target || target.provider === "galley" || target.settings?.serverSide !== true) {
        throw new GalleyError("invalid", "That destination isn't sent from this server, so it can't be retried here.");
      }
      result = await this.forwardOne(site.id, loaded.definition, submission, destination);
    }
    return (await this.recordDelivery(site.id, submission, [result])) ?? submission;
  }

  async exportCsv(siteId: string, formId: string, filter: InboxFilter = "inbox"): Promise<{ fileName: string; text: string }> {
    const site = await this.site(siteId);
    const items = filtered(await this.store.list(site.id, checkFormId(formId)), filter);
    const loaded = await loadForm(site, formId, "working").catch(() => null);

    return { fileName: csvFileName(formId), text: submissionsCsv(loaded?.definition ?? null, items) };
  }

  // ─────────────────────────────────────────────────────────── settings

  async captureSettings(siteId: string): Promise<CaptureSettings> {
    const site = await this.site(siteId);
    const [stored, secrets, origins] = await Promise.all([this.settings.read(site.id), this.settings.secrets(site.id), this.allowedOrigins(site)]);
    const app = this.appUrl() ?? "http://127.0.0.1";
    const captureAddress = `${app}/f/${encodeURIComponent(site.id)}`;
    const reachable = this.reachable(app);
    const host = hostOf(app);
    const kind = this.options.mode !== "hosted" ? "this-computer" : reachable ? "public" : "private-address";

    return {
      captureAddress,
      captureReachable: reachable,
      reachability:
        kind === "public"
          ? "Visitors' browsers send submissions to this server's public address."
          : kind === "private-address"
            ? `Browsers on the internet can't reach this editor's address${host ? ` (${host})` : ""}: it's a local or private name, not one on the internet. Test submissions arrive; for real ones, give the editor a public address.`
            : "Submissions can only arrive when this app runs on a server visitors can reach. On this computer it works for testing.",
      captureReach: { kind, host },
      origins,
      captureKey: stored.captureKey ? { enabled: true, hint: stored.captureKey.hint, createdAt: stored.captureKey.createdAt } : { enabled: false },
      notify: stored.notify,
      mail: this.mail.transport ? { configured: true, from: this.mail.transport.from } : { configured: false, ...(this.mail.problem ? { problem: this.mail.problem } : {}) },
      turnstile: secrets.turnstile ? { configured: true, hint: secrets.turnstile.slice(-4) } : { configured: false },
      rateLimits: stored.rateLimits,
      forwardSecrets: Object.keys(secrets.forward).sort(),
    };
  }

  private reachable(app: string): boolean {
    if (this.options.mode !== "hosted") return false;
    try {
      const host = new URL(app).hostname.replace(/^\[|\]$/g, "");

      if (LOOPBACK_HOST.test(host) || host === "::1" || /\.(local|localhost|internal|lan|home\.arpa)$/i.test(host) || (!host.includes(".") && !host.includes(":"))) return false;
      if (/^[\d.]+$/.test(host) || host.includes(":")) return isPublicAddress(host);
      return true;
    } catch {
      return false;
    }
  }

  async patchCaptureSettings(siteId: string, patch: CaptureSettingsPatch): Promise<CaptureSettings> {
    const site = await this.site(siteId);

    await this.settings.patch(site.id, patch);
    return this.captureSettings(site.id);
  }

  async captureKey(siteId: string, action: "rotate" | "remove"): Promise<{ settings: CaptureSettings; key: string | null }> {
    const site = await this.site(siteId);
    let key: string | null = null;

    if (action === "rotate") key = await this.settings.rotateKey(site.id);
    else await this.settings.removeKey(site.id);
    return { settings: await this.captureSettings(site.id), key };
  }

  async introspect(siteId: string, provider: string, settings: { [key: string]: JsonValue }): Promise<FormIntrospectResult> {
    await this.site(siteId);
    return introspectForm(provider, settings, { fetch: this.fetch });
  }
}

/** The answers of a native form post, keyed by field id: inputs carry `mapping ?? name ?? id` (the runtime's `nameFor`). */
export function valuesFromFormPost(form: FormDefinition, posted: URLSearchParams): { [fieldId: string]: string | string[] } {
  const galley = form.destinations.find((destination) => destination.provider === "galley");
  const values: { [fieldId: string]: string | string[] } = {};

  for (const field of form.fields) {
    const name = galley?.mapping?.[field.id] ?? field.name ?? field.id;

    if (!posted.has(name)) continue;
    values[field.id] = field.type === "checkboxes" ? posted.getAll(name) : (posted.get(name) ?? "");
  }
  return values;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);

function smallPage(title: string, body: string, back: string | null): string {
  return [
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>`,
    `<style>body{font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1.5rem;color:#1a1a1a}h1{font-size:1.5rem;font-weight:600}a{color:inherit}</style></head><body>`,
    `<h1>${escapeHtml(title)}</h1>${body}`,
    back ? `<p><a href="${escapeHtml(back)}">Go back to the form</a></p>` : "",
    `</body></html>`,
  ].join("");
}

/** Turns a JSON answer into what a browser posting a plain form should see. */
function formPostAnswer(response: CaptureResponse, context: PostContext): CaptureResponse {
  if (response.status === 403) return response;
  let back: string | null = null;

  try {
    const url = context.returnUrl ? new URL(context.returnUrl) : null;
    // Only back to the page that posted: never an open redirect to anywhere else.
    if (url && (url.protocol === "https:" || url.protocol === "http:") && context.origin && url.origin === new URL(context.origin).origin) back = url.toString();
  } catch {
    back = null;
  }
  const page = (status: number, html: string): CaptureResponse => ({ status, body: null, allowOrigin: null, html, ...(response.retryAfterSeconds ? { retryAfterSeconds: response.retryAfterSeconds } : {}) });
  const formBack = back ? back.split("#")[0]! : null;

  if (response.status === 200) {
    if (back) return { status: 303, body: null, allowOrigin: null, redirect: back };
    return page(200, smallPage("Sent", "<p>Thanks — your answers were sent.</p>", null));
  }
  const body = response.body && !response.body.ok ? response.body : { ok: false as const };

  if (response.status === 422 && body.errors) {
    const labels = new Map((context.form?.fields ?? []).map((field) => [field.id, field.label?.trim() || field.id]));
    const items = Object.entries(body.errors).map(([id, message]) => `<li><strong>${escapeHtml(labels.get(id) ?? id)}</strong>: ${escapeHtml(message)}</li>`).join("");

    return page(422, smallPage("Some answers need another look", `${body.message ? `<p>${escapeHtml(body.message)}</p>` : ""}<ul>${items}</ul>`, formBack));
  }
  return page(response.status, smallPage("Not sent", `<p>${escapeHtml(body.message ?? "The form couldn't be sent.")}</p>`, formBack));
}

export function createFormCapture(options: FormCaptureOptions): FormCaptureService {
  return new FormCaptureService(options);
}
