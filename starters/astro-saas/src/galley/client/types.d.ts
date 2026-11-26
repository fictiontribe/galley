// Vendored from @galley/astro 0.4.8 by scripts/vendor.mjs. Don't edit: run the script again to update.
import type { FormAction, FormDestination, FormField } from "../kit";

/** What a submitter is given besides the values and the destination. */
export interface SubmitContext {
  /** The form's id (its file name). */
  formId: string;
  /** The form element on the page. */
  form: HTMLFormElement;
  /** Every field of the form, as in its file. */
  fields: FormField[];
  /** The visitor's answers by field id, hidden fields left out. */
  answers: { [fieldId: string]: string | string[] };
  /** What this destination is sent, field by field, with the field it came from. */
  items: Array<{ field: FormField; name: string; value: string | string[] }>;
  page: { url: string; title: string; referrer: string };
  meta: { elapsedMs: number; honeypot: string; turnstileToken?: string; locale: string; kit: string };
  /** The form's resolved wording. */
  messages: Record<string, string>;
}

/** What a submitter reports. `ok` is the only required part. */
export interface SubmitResult {
  ok: boolean;
  /** For the console and the `galley:form:error` event; never shown as is. */
  detail?: string;
  /** Field-level refusals, keyed by the name the destination was sent (or the field id). */
  errors?: { [name: string]: string };
  /** The destination asked to slow down (HTTP 429). */
  retry?: boolean;
  /** How long it asked to wait, in seconds (Retry-After). */
  retryAfter?: number;
  /** A message for the visitor, in the form's own words, when the destination gives one. */
  message?: string;
  /** The destination has no address to send to. */
  notConnected?: boolean;
  /** Where the provider would send the visitor next, when it says (HubSpot, Marketo). */
  redirect?: string;
}

export type Submitter = (
  values: { [name: string]: string | string[] },
  destination: FormDestination,
  context: SubmitContext,
) => Promise<SubmitResult> | SubmitResult;

/** The part of a form file the runtime receives in the page. */
export interface ClientFormConfig {
  id: string;
  uid: string;
  name: string;
  endpoint: string;
  fields: FormField[];
  steps: number;
  nextLabels?: string[];
  destinations: FormDestination[];
  afterSubmit: FormAction[];
  spam: { honeypot: boolean; minSeconds: number; turnstile: boolean };
  native: number;
  messages: Record<string, string>;
  freeEmailDomains: string[];
}

export interface GalleyConsentApi {
  mode: "none" | "banner" | "external";
  granted(category: string): boolean;
  get(): Record<string, boolean>;
  set(choice: Record<string, boolean>): void;
  open(): void;
}

declare global {
  interface Window {
    galleyConsent?: GalleyConsentApi;
    galleyForms?: { registerProvider(id: string, submitter: Submitter): void; init(root?: ParentNode): void };
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    MktoForms2?: any;
  }
}
