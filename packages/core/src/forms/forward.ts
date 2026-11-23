/**
 * Forwarding: the destinations of a form that only a server can serve.
 *
 * A destination is server-side when its settings say `serverSide: true`. The
 * site's script leaves those out (their settings never reach the browser) and
 * the capture endpoint sends them after storing the submission, in the
 * background, with retries, recording one `delivery` result per destination.
 *
 * Built in: `webhook` (settings: { url, format?: "json" | "form", headers?,
 * serverSide: true }). Any `{{secret:name}}` in the address or a header value
 * is replaced with a forwarding secret stored in the app (never in the site's
 * files). Other server-side destinations — a CRM API that needs a key — are
 * added by registering a `FormForwarder` for their provider id; the plugin
 * system hooks in through `ForwarderRegistry`.
 */
import type { FormDefinition, FormDestination, FormField, FormSubmission } from "../kit";
import { OutboundRefused, type GuardedFetch, type GuardOptions } from "./net";
import { isLayoutField, ruleHolds } from "./validate";

export interface ForwardContext {
  siteId: string;
  formId: string;
  form: FormDefinition;
  /** Index of the destination in `form.destinations`. */
  index: number;
  /** The answers under the destination's own field names (mapping applied), then its fixed values. */
  payload: { [name: string]: string | string[] };
  /** A forwarding secret by name, or null when it isn't set. */
  secret(name: string): string | null;
  /** Outbound requests with the SSRF guards; `guard` is the policy for this server's mode. */
  fetch: GuardedFetch;
  guard: GuardOptions;
}

export interface ForwardResult {
  ok: boolean;
  /** Plain words for the inbox: what the other side said, or why it wasn't sent. */
  detail?: string;
  /** False when trying again can't help (a refused address, a 400). Default: retry on failure. */
  retry?: boolean;
}

export interface FormForwarder {
  /** The provider id it serves (`FormDestination.provider`). */
  id: string;
  send(submission: FormSubmission, destination: FormDestination, ctx: ForwardContext): Promise<ForwardResult>;
}

export class ForwarderRegistry {
  private readonly forwarders = new Map<string, FormForwarder>();

  /** Adds (or replaces) the forwarder for a provider. Returns a function that removes it again. */
  register(forwarder: FormForwarder): () => void {
    this.forwarders.set(forwarder.id, forwarder);
    return () => {
      if (this.forwarders.get(forwarder.id) === forwarder) this.forwarders.delete(forwarder.id);
    };
  }

  get(id: string): FormForwarder | null {
    return this.forwarders.get(id) ?? null;
  }

  ids(): string[] {
    return [...this.forwarders.keys()].sort();
  }
}

/** Destinations the server sends, with their index: marked server-side, not the inbox itself, and whose "only when…" holds. */
export function serverSideDestinations(form: FormDefinition, values: FormSubmission["values"]): Array<{ index: number; destination: FormDestination }> {
  return form.destinations
    .map((destination, index) => ({ index, destination }))
    .filter(({ destination }) => destination.provider !== "galley" && destination.settings?.serverSide === true)
    .filter(({ destination }) => !destination.when || ruleHolds({ field: destination.when.field, equals: destination.when.equals }, values));
}

function mappedName(destination: FormDestination, field: FormField): string {
  return destination.mapping?.[field.id] || field.name || field.id;
}

export function destinationPayload(form: FormDefinition, destination: FormDestination, values: FormSubmission["values"]): ForwardContext["payload"] {
  const payload: ForwardContext["payload"] = {};

  for (const field of form.fields) {
    if (isLayoutField(field) || values[field.id] === undefined) continue;
    payload[mappedName(destination, field)] = values[field.id]!;
  }
  for (const [name, value] of Object.entries(destination.constants ?? {})) payload[name] = value;
  return payload;
}

const SECRET_REF = /\{\{\s*secret:([a-z0-9][a-z0-9_-]{0,39})\s*\}\}/g;

/** Replaces `{{secret:name}}`; throws a plain message naming the first missing secret. */
export function withSecrets(text: string, secret: (name: string) => string | null): string {
  return text.replace(SECRET_REF, (_, name: string) => {
    const value = secret(name);

    if (value === null) throw new OutboundRefused(`The forwarding secret “${name}” isn't set. Add it in the inbox's capture settings.`);
    return value;
  });
}

const FORBIDDEN_HEADERS = new Set(["host", "content-length", "connection", "transfer-encoding", "cookie"]);

export const webhookForwarder: FormForwarder = {
  id: "webhook",
  async send(submission, destination, ctx) {
    const settings = destination.settings ?? {};

    if (typeof settings.url !== "string" || settings.url.trim() === "") return { ok: false, detail: "This webhook has no address.", retry: false };
    const format = settings.format === "form" ? "form" : "json";
    const headers: Record<string, string> = {
      "content-type": format === "form" ? "application/x-www-form-urlencoded" : "application/json",
      "user-agent": "form-capture-webhook",
    };

    try {
      const url = withSecrets(settings.url.trim(), ctx.secret);

      if (settings.headers && typeof settings.headers === "object" && !Array.isArray(settings.headers)) {
        for (const [name, value] of Object.entries(settings.headers)) {
          if (typeof value !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(name) || FORBIDDEN_HEADERS.has(name.toLowerCase())) continue;
          headers[name.toLowerCase()] = withSecrets(value, ctx.secret).replace(/[\r\n]/g, "");
        }
      }
      let body: string;

      if (format === "form") {
        const params = new URLSearchParams();

        for (const [name, value] of Object.entries(ctx.payload)) for (const item of Array.isArray(value) ? value : [value]) params.append(name, item);
        body = params.toString();
      } else {
        body = JSON.stringify({ form: ctx.formId, formName: ctx.form.name, id: submission.id, at: submission.at, page: submission.page ?? null, values: ctx.payload });
      }
      const response = await ctx.fetch(url, { method: "POST", headers, body }, { ...ctx.guard, maxBytes: 64 * 1024, timeoutMs: 10_000, maxRedirects: 0 });

      if (response.status >= 200 && response.status < 300) return { ok: true, detail: `Accepted (${response.status}).` };
      const retry = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;

      return { ok: false, detail: `The webhook answered ${response.status}.`, retry };
    } catch (error) {
      if (error instanceof OutboundRefused) return { ok: false, detail: error.message, retry: false };
      return { ok: false, detail: `The webhook couldn't be reached: ${error instanceof Error ? error.message : String(error)}`, retry: true };
    }
  },
};

export interface RetryPolicy {
  attempts: number;
  /** Wait before try n+1 (ms). */
  delays: number[];
}

export const DEFAULT_RETRY: RetryPolicy = { attempts: 3, delays: [2_000, 10_000] };

/** Sends to one destination, retrying as the forwarder allows. Never throws. */
export async function forwardWithRetries(
  forwarder: FormForwarder | null,
  submission: FormSubmission,
  destination: FormDestination,
  ctx: ForwardContext,
  policy: RetryPolicy = DEFAULT_RETRY,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms))
): Promise<NonNullable<FormSubmission["delivery"]>[number]> {
  const base = { provider: destination.provider, destination: ctx.index };

  if (!forwarder) {
    return { ...base, ok: false, attempts: 0, at: new Date().toISOString(), detail: `Nothing on this server can send to “${destination.provider}”. Install the plugin that adds it, or send from the page instead.` };
  }
  let result: ForwardResult = { ok: false };
  let attempts = 0;

  while (attempts < Math.max(1, policy.attempts)) {
    if (attempts > 0) await sleep(policy.delays[Math.min(attempts - 1, policy.delays.length - 1)] ?? 0);
    attempts += 1;
    try {
      result = await forwarder.send(submission, destination, ctx);
    } catch (error) {
      result = { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
    if (result.ok || result.retry === false) break;
  }
  return { ...base, ok: result.ok, attempts, at: new Date().toISOString(), ...(result.detail ? { detail: result.detail.slice(0, 500) } : {}) };
}
