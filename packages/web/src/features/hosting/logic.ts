/**
 * "Host the editor online": the decisions behind the screens, kept pure so
 * they can be tested without a browser — which steps the guided flow has for
 * a host, what the request says, the cost and health in plain words, which
 * keys may be offered, and when a plan is too old to use. Copy follows
 * brand/voice.md: "access key", "the three names", "address" — never token,
 * container, volume or DNS record without the plain words first.
 */
import type {
  CostEstimate,
  EditorHostAccount,
  EditorHostInfo,
  HandoverChoice,
  HostedEditorHealth,
  HostedEditorRemoval,
  HostedEditorRequest,
  HostedEditorStatus,
  HostedResource,
} from "@galley/core/hosting/types";
import { addressProblem, deriveAddresses, editorNameProblem, normalizeAddress } from "@galley/core/hosting/addresses";
import type { Job, SecretName, SecretStatus } from "@galley/core/types";
import { count, joinWords } from "@/lib/format";

// ─────────────────────────────────────────────────────────────── steps

export type FlowStep = "where" | "connect" | "choices" | "handover" | "review" | "creating" | "pending" | "done" | "failed";

/** The steps a person answers, in order, for a host. A host that needs no key has no "connect". */
export function questionSteps(host: Pick<EditorHostInfo, "credentials"> | null | undefined): FlowStep[] {
  return ["where", ...(host && host.credentials.length > 0 ? (["connect"] as const) : []), "choices", "handover", "review"];
}

export function nextStep(step: FlowStep, host: Pick<EditorHostInfo, "credentials"> | null | undefined): FlowStep {
  const steps = questionSteps(host);
  const at = steps.indexOf(step);
  return at >= 0 && at < steps.length - 1 ? steps[at + 1]! : step;
}

export function previousStep(step: FlowStep, host: Pick<EditorHostInfo, "credentials"> | null | undefined): FlowStep {
  const steps = questionSteps(host);
  const at = steps.indexOf(step);
  return at > 0 ? steps[at - 1]! : step;
}

/** "Step 2 of 5", or null once the questions are over. */
export function stepLabel(step: FlowStep, host: Pick<EditorHostInfo, "credentials"> | null | undefined): string | null {
  const steps = questionSteps(host);
  const at = steps.indexOf(step);
  return at >= 0 ? `Step ${at + 1} of ${steps.length}` : null;
}

// ─────────────────────────────────────────────────────────────── the answers

export interface FlowDraft {
  host: string | null;
  account: string;
  name: string;
  address: string;
  /** Empty: derived from the address. */
  previewAddress: string;
  liveAddress: string;
  options: Record<string, string>;
  handover: HandoverChoice;
}

export function emptyDraft(suggestedName = ""): FlowDraft {
  // Keys are never handed over unless each one is ticked on purpose.
  return { host: null, account: "", name: suggestedName, address: "", previewAddress: "", liveAddress: "", options: {}, handover: { repository: true, identity: true, liveAddress: true, keys: [] } };
}

/** Each of the host's choices at its default, keeping what was already chosen for it. */
export function withDefaultOptions(options: Record<string, string>, host: Pick<EditorHostInfo, "options">, account: EditorHostAccount | null): Record<string, string> {
  const next: Record<string, string> = {};
  for (const option of host.options) next[option.key] = option.choices.some((choice) => choice.value === options[option.key]) ? options[option.key]! : option.default;
  const regions = account?.regions ?? [];
  // The contract names no default place; the host lists its first choice first.
  if (regions.length > 0) next.region = regions.some((region) => region.id === options.region) ? options.region! : regions[0]!.id;
  return next;
}

/** The account to use: the one chosen, else the only one there is. */
export function chosenAccount(draft: Pick<FlowDraft, "account">, account: EditorHostAccount | null): string {
  if (!account || account.accounts.length === 0) return draft.account;
  if (account.accounts.some((entry) => entry.id === draft.account)) return draft.account;
  return account.accounts.length === 1 ? account.accounts[0]!.id : "";
}

/** The three names as they will be, or null while the address isn't a usable name yet. */
export function threeNames(draft: Pick<FlowDraft, "address" | "previewAddress" | "liveAddress">): { editor: string; preview: string; live: string } | null {
  if (addressProblem(draft.address)) return null;
  const derived = deriveAddresses(draft.address);
  const preview = draft.previewAddress.trim() ? normalizeAddress(draft.previewAddress) : derived?.preview;
  const live = draft.liveAddress.trim() ? normalizeAddress(draft.liveAddress) : derived?.live;
  return preview && live ? { editor: normalizeAddress(draft.address), preview, live } : null;
}

/** Names on the person's own domains, to pick instead of typing. */
export function suggestedAddresses(account: EditorHostAccount | null): string[] {
  return (account?.domains ?? []).slice(0, 4).map((domain) => `cms.${domain.name}`);
}

export interface ChoiceProblems {
  address?: string;
  preview?: string;
  live?: string;
  name?: string;
  account?: string;
}

/** What stops the address-and-choices step, field by field. Empty when it can go on. */
export function choiceProblems(draft: FlowDraft, account: EditorHostAccount | null): ChoiceProblems {
  const problems: ChoiceProblems = {};
  const address = addressProblem(draft.address);
  if (address) problems.address = address;
  if (draft.previewAddress.trim()) {
    const preview = addressProblem(draft.previewAddress, "The preview's address");
    if (preview) problems.preview = preview;
  }
  if (draft.liveAddress.trim()) {
    const live = addressProblem(draft.liveAddress, "The live comparison's address");
    if (live) problems.live = live;
  }
  if (!address && !problems.preview && !problems.live) {
    const names = threeNames(draft);
    if (!names) problems.preview = "No preview or live comparison name can be made from this address. Open “Change these names” and type them.";
    else if (new Set([names.editor, names.preview, names.live]).size < 3) problems.preview = "The editor, the preview and the live comparison each need a name of their own.";
  }
  const name = editorNameProblem(draft.name.trim());
  if (name) problems.name = name;
  if (account && account.accounts.length > 1 && !chosenAccount(draft, account)) problems.account = "Choose the account the editor goes in.";
  return problems;
}

/** What `POST …/editor/plan` is sent: exactly the answers, keys only as ticked. */
export function planRequest(draft: FlowDraft, account: EditorHostAccount | null): HostedEditorRequest {
  return {
    host: draft.host ?? "",
    account: chosenAccount(draft, account),
    name: draft.name.trim(),
    address: normalizeAddress(draft.address),
    ...(draft.previewAddress.trim() ? { previewAddress: normalizeAddress(draft.previewAddress) } : {}),
    ...(draft.liveAddress.trim() ? { liveAddress: normalizeAddress(draft.liveAddress) } : {}),
    ...(Object.keys(draft.options).length > 0 ? { options: { ...draft.options } } : {}),
    handover: { repository: draft.handover.repository, identity: draft.handover.identity, liveAddress: draft.handover.liveAddress, keys: [...draft.handover.keys] },
  };
}

/** A plan is good for fifteen minutes; a little earlier it is asked again, so it can't run out between reading and saying yes. */
export const PLAN_FRESH_MS = 14 * 60_000;

export function planIsStale(plannedAt: number, now: number = Date.now()): boolean {
  return now - plannedAt > PLAN_FRESH_MS;
}

// ─────────────────────────────────────────────────────────────── access keys

/** Every required key is stored. */
export function keysReady(host: Pick<EditorHostInfo, "credentials" | "secrets">): boolean {
  return host.credentials.every((credential) => !credential.required || secretOf(host, credential.secret)?.configured);
}

export function secretOf(host: Pick<EditorHostInfo, "secrets">, name: SecretName): SecretStatus | undefined {
  return host.secrets.find((secret) => secret.name === name);
}

export function blockingGaps(account: EditorHostAccount | null): EditorHostAccount["gaps"] {
  return (account?.gaps ?? []).filter((gap) => gap.blocking);
}

export function byHandGaps(account: EditorHostAccount | null): EditorHostAccount["gaps"] {
  return (account?.gaps ?? []).filter((gap) => !gap.blocking);
}

/**
 * Keys a hosted editor could use, the assistant's first, each with what it
 * lets the editor there do. The host's own keys (Fly.io) are never offered:
 * a hosted editor doesn't create other editors.
 */
export const HANDOVER_KEYS: Array<{ name: SecretName; label: string; does: string }> = [
  { name: "anthropic", label: "The assistant’s key", does: "Lets the assistant answer on the hosted editor." },
  { name: "openai", label: "The OpenAI key", does: "Lets the hosted editor make images with OpenAI." },
  { name: "google", label: "The Google AI key", does: "Lets the hosted editor make images with Google." },
  { name: "cloudflare", label: "The Cloudflare key", does: "Lets the hosted editor put the site online with Cloudflare." },
  { name: "vercel", label: "The Vercel key", does: "Lets the hosted editor put the site online with Vercel." },
];

/** The stored keys that may be handed over, in the order above. */
export function offeredKeys(secrets: SecretStatus[] | undefined): Array<(typeof HANDOVER_KEYS)[number] & { hint: string }> {
  return HANDOVER_KEYS.flatMap((key) => {
    const secret = secrets?.find((entry) => entry.name === key.name);
    return secret?.configured ? [{ ...key, hint: secret.hint ?? "····" }] : [];
  });
}

/** Tick or untick one key. Only names that are offered can end up in the list. */
export function toggleKey(keys: SecretName[], name: SecretName, on: boolean): SecretName[] {
  const rest = keys.filter((key) => key !== name);
  return on ? [...rest, name] : rest;
}

/** A repository address without anything that would let someone in (https://user:secret@host/… → https://host/…). */
export function displayRepository(remote: string | undefined | null): string | null {
  const text = remote?.trim();
  if (!text) return null;
  return text.replace(/^(https?:\/\/)[^@/]+@/i, "$1");
}

// ─────────────────────────────────────────────────────────────── words

/** "about $13 a month", "about $4.50 a month", "no monthly cost". */
export function costPhrase(cost: Pick<CostEstimate, "monthly" | "currency">): string {
  if (cost.monthly <= 0) return "no monthly cost";
  const symbol = cost.currency === "EUR" ? "€" : "$";
  const amount = cost.monthly >= 10 ? String(Math.round(cost.monthly)) : cost.monthly.toFixed(2);
  return `about ${symbol}${amount} a month`;
}

/** "$12.69", "€0.00": one line of a cost. */
export function amount(value: number, currency: CostEstimate["currency"]): string {
  return `${currency === "EUR" ? "€" : "$"}${value.toFixed(2)}`;
}

/** "23 Nov 2026" from "2026-11-23", in the viewer's locale; the day as written, whatever the time zone. */
export function priceDate(checked: string, locale?: string): string {
  const date = new Date(`${checked}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return checked;
  return date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * The plan's headline cost, true for the choice made. `monthly` is a month
 * awake all day; a computer that sleeps while unused usually costs less, so
 * its headline is a range — from `low` when the estimate gives one, else an
 * upper bound (the lower figure is never read out of the note's prose).
 */
export function costHeadline(cost: Pick<CostEstimate, "monthly" | "currency">, { sleeps = false, low = null }: { sleeps?: boolean; low?: number | null } = {}): string {
  const phrase = costPhrase(cost);
  const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  if (!sleeps || cost.monthly <= 0) return capital(phrase);
  const top = phrase.replace(/^about /, "").replace(/ a month$/, "");
  if (low !== null && low > 0 && low < cost.monthly) {
    const symbol = cost.currency === "EUR" ? "€" : "$";
    return `About ${symbol}${Math.max(1, Math.round(low))} to ${top} a month — it sleeps while nobody is using it`;
  }
  return `Up to about ${top} a month — it sleeps while nobody is using it, so it usually costs much less`;
}

/** Whether the choices made let the editor sleep while nobody uses it (a host's `sleep` choice, on unless turned off). */
export function sleepsWhileUnused(host: Pick<EditorHostInfo, "options">, options: Record<string, string> | undefined): boolean {
  const choice = host.options.find((option) => option.key === "sleep");
  if (!choice) return false;
  return (options?.sleep ?? choice.default) !== "off";
}

/** A key's name without the "(optional)" some hosts put in it: the Optional badge says that once. */
export function credentialName(label: string): string {
  return label.replace(/\s*\(optional\)\s*$/i, "");
}

/**
 * What a checked key can reach, one line each, by name: the accounts on the
 * host it can create the editor in, and the domains it can add the editor's
 * names to (domains are always on Cloudflare). The gaps follow these.
 */
export function reachLines(host: Pick<EditorHostInfo, "name">, account: Pick<EditorHostAccount, "accounts" | "domains">): string[] {
  const lines: string[] = [];
  const quoted = account.accounts.map((entry) => `“${entry.name || entry.id}”`);
  if (quoted.length > 0) lines.push(`On ${host.name} it can create the editor in ${joinWords(quoted, "or")}.`);
  const domains = account.domains.map((domain) => domain.name);
  if (domains.length > 0) lines.push(`On Cloudflare it can add the editor’s names to ${joinWords(domains)}.`);
  return lines;
}

// ─────────────────────────────────────────────────────────────── what is created and removed

const RESOURCE_WORDS: Record<string, string> = {
  app: "The app",
  ip: "An address",
  volume: "The disk",
  machine: "The computer",
  certificate: "A certificate",
  "dns-record": "A name at your domain’s provider",
  tunnel: "The tunnel",
};

/** The built-in hosts make their DNS names on Cloudflare (Fly.io through the Cloudflare key, Cloudflare on itself). */
const DNS_ON_CLOUDFLARE = new Set(["fly", "cloudflare"]);

/** Where a resource lives: the host, or Cloudflare for a built-in host's DNS names. Null when nothing says (a plugin host's DNS name). */
export function resourcePlace(resource: Pick<HostedResource, "kind">, host: { id: string; name: string }): string | null {
  if (resource.kind === "dns-record") return DNS_ON_CLOUDFLARE.has(host.id) ? "Cloudflare" : null;
  return host.name;
}

/** Resources grouped by where they live, in the order they are made; `start` numbers each group on from the last. */
export function resourceGroups(resources: HostedResource[], host: { id: string; name: string }): Array<{ place: string | null; resources: HostedResource[]; start: number }> {
  const groups: Array<{ place: string | null; resources: HostedResource[]; start: number }> = [];
  for (const resource of resources) {
    const place = resourcePlace(resource, host);
    let group = groups.find((entry) => entry.place === place);
    if (!group) {
      group = { place, resources: [], start: 0 };
      groups.push(group);
    }
    group.resources.push(resource);
  }
  let next = 1;
  for (const group of groups) {
    group.start = next;
    next += group.resources.length;
  }
  return groups;
}

/** Names the person knows for the ids a record keeps: accounts and places (regions). */
export interface KnownNames {
  accounts?: Array<{ id: string; name: string }>;
  regions?: Array<{ id: string; name: string }>;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One resource as a row: what it is in plain words, then its name (left out
 * when the detail already says it), then the detail — with a place shown by
 * its name rather than its code ("in iad" → "in Ashburn, Virginia (US)") and
 * the app's account by its name, when those are known.
 */
export function resourceWords(resource: HostedResource, known: KnownNames = {}): { what: string | null; name: string | null; detail: string | null } {
  let detail = resource.detail?.trim() || null;
  if (detail) {
    for (const region of known.regions ?? []) {
      if (region.id && region.name && region.id !== region.name) detail = detail.replace(new RegExp(`\\bin ${escape(region.id)}\\b`, "g"), `in ${region.name}`);
    }
    if (resource.kind === "app") {
      for (const account of known.accounts ?? []) {
        if (account.id && account.name && account.id !== account.name) detail = detail.replace(new RegExp(`(^|\\s)${escape(account.id)}(?=$|[\\s,.;])`), `$1“${account.name}”`);
      }
    }
  }
  const name = resource.name.trim() || null;
  if (detail && name && detail === name) detail = null;
  const tokens = detail ? detail.split(/\s+/).map((token) => token.replace(/^[(“"]+/, "").replace(/[,.;:)”"]+$/, "")) : [];
  return { what: RESOURCE_WORDS[resource.kind] ?? null, name: name && tokens.includes(name) ? null : name, detail };
}

/** "Deleted 8 things from Fly.io and 3 from Cloudflare." — what a finished removal took, by where it was. */
export function removedLine(removal: Pick<HostedEditorRemoval, "resources">, host: { id: string; name: string }): string {
  const groups = resourceGroups(removal.resources, host);
  if (groups.length === 0) return "Nothing was on an account. Stop the editor on your own computer too.";
  const parts = groups.map((group, index) => {
    const things = index === 0 ? count(group.resources.length, "thing") : String(group.resources.length);
    return group.place ? `${things} from ${group.place}` : things;
  });
  return `Deleted ${joinWords(parts)}.`;
}

export function kindWords(kind: EditorHostInfo["kind"]): string {
  return kind === "managed" ? "Created for you on your account" : "You start it on a computer of your own";
}

export type Tone = "neutral" | "success" | "warning" | "danger" | "busy";

export function healthWords(health: HostedEditorHealth): { text: string; tone: Tone } {
  switch (health) {
    case "healthy":
      return { text: "Running", tone: "success" };
    case "setup":
      return { text: "Waiting for first run", tone: "warning" };
    case "starting":
      return { text: "Starting", tone: "busy" };
    case "unreachable":
      return { text: "Can’t be reached", tone: "danger" };
    default:
      return { text: "Not known", tone: "neutral" };
  }
}

// ─────────────────────────────────────────────────────────────── the card

/** The editor's hostname, from what this computer made or from the site's settings. */
export function editorAddress(status: Pick<HostedEditorStatus, "config" | "record"> | null | undefined): string | null {
  if (status?.record) return status.record.addresses.editor;
  const url = status?.config?.url;
  if (!url) return null;
  return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "") || null;
}

/**
 * none: offer to host it. online: the site has an editor (perhaps still
 * waiting for steps to be run: `pending`). unfinished: this computer made
 * part of one — a create that stopped — with nothing left to run and the
 * site's settings not naming it: it can only be removed.
 */
export function cardState(status: Pick<HostedEditorStatus, "config" | "record" | "pending"> | null | undefined): "none" | "online" | "unfinished" {
  if (!status || (!status.config && !status.record)) return "none";
  if (!status.config && status.record && !status.record.handedOver && !status.pending) return "unfinished";
  return "online";
}

/** "Version 0.0.9 → 0.1.0". */
export function upgradeLine(status: Pick<HostedEditorStatus, "runningVersion" | "record" | "currentVersion">): string {
  const from = status.runningVersion ?? status.record?.version ?? null;
  return from ? `Version ${from} → ${status.currentVersion}` : `To version ${status.currentVersion}`;
}

/** Typed to confirm a removal: the address as shown, forgiving a scheme, a trailing slash or dot, and case. */
export function removalConfirmed(typed: string, address: string): boolean {
  const clean = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/\.$/, "");
  return clean(typed) !== "" && clean(typed) === clean(address);
}

/** Which of the three plain stages a running create is in. */
export function creationStages(job: Job | null, managed: boolean): Array<{ label: string; state: "done" | "current" | "todo" }> {
  const labels = managed ? ["Creating it on your account", "Waiting for it to answer", "Handing the site over"] : ["Getting it ready", "Writing the files"];
  const progress = job?.state === "done" ? 1 : (job?.progress ?? 0);
  const at = job?.state === "done" ? labels.length : managed ? (progress >= 0.9 ? 2 : progress >= 0.6 ? 1 : 0) : progress >= 0.6 ? 1 : 0;
  return labels.map((label, index) => ({ label, state: index < at ? "done" : index === at ? "current" : "todo" }));
}
