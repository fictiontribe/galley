/**
 * The deploy feature's decisions, kept pure so they can be tested without a
 * browser: what the status line says, where the guided setup is, and what a
 * failure means for the next step. Copy follows brand/voice.md: "online",
 * "live", "address", "access key" — never deploy, token, build or artifact.
 */
import type { DeployStatus, DeployTargetInfo, GalleyErrorShape, Job } from "@galley/core/types";
import { count, relativeTime } from "@/lib/format";

// ─────────────────────────────────────────────────────────────── addresses

/** "https://lowfield.pages.dev/" → "lowfield.pages.dev". */
export function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

// ─────────────────────────────────────────────────────────────── status line

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "busy";

export interface StatusLine {
  text: string;
  tone: StatusTone;
  /** The one action that belongs beside it. */
  action: { label: string; kind: "setup" | "put-live" | "details" } | null;
  /** The live address, when there is one to link. */
  href?: string;
}

/** The newest deploy job worth talking about: running, or finished in the last 10 minutes. */
export function currentJob(status: DeployStatus | null | undefined, live: Job | null | undefined): Job | null {
  const job = live ?? status?.job ?? null;
  return job && job.kind === "deploy" ? job : null;
}

export function statusLine(status: DeployStatus | null | undefined, job: Job | null, now: number = Date.now()): StatusLine {
  if (!status) return { text: "Checking whether the site is online…", tone: "neutral", action: null };
  if (job?.state === "running") return { text: job.detail && job.detail !== "Getting ready…" ? job.detail : job.label, tone: "busy", action: null };
  // A failure is news only until something newer succeeds.
  const production = status.production;
  const failedAfter = job?.state === "error" && (!production || (job.finishedAt ?? 0) > Date.parse(production.createdAt));
  if (failedAfter) return { text: job.label.startsWith("Making") ? "Couldn’t make the preview link" : "Couldn’t put the site online", tone: "danger", action: { label: "Details", kind: "details" } };
  if (!status.config) return { text: "Not online yet", tone: "neutral", action: { label: "Put this site online", kind: "setup" } };
  if (!production) return { text: "Not live yet", tone: "neutral", action: { label: "Put live", kind: "put-live" } };
  if (status.behind !== null && status.behind > 0) {
    return { text: `${count(status.behind, "published version")} not live yet`, tone: "warning", action: { label: "Put live", kind: "put-live" }, href: production.url };
  }
  return { text: `Live at ${hostOf(production.url)} · updated ${relativeTime(production.createdAt, now)}`, tone: "success", action: null, href: production.url };
}

// ─────────────────────────────────────────────────────────────── guided setup

export type SetupStep = "host" | "key" | "account" | "name" | "working" | "done" | "failed";
export type SetupIntent = "production" | "preview";

export interface SetupState {
  step: SetupStep;
  intent: SetupIntent;
  target: string | null;
  account: string | null;
  project: string;
  /** Accounts the key can use; empty means it can't list them and the id is typed. */
  accounts: Array<{ id: string; name: string }> | null;
  jobId: string | null;
  /** Where a failure sends the person back to. */
  retryStep: SetupStep | null;
}

export type SetupAction =
  | { type: "reset"; state: SetupState }
  /** Selecting, without moving on. */
  | { type: "pick-host"; target: string }
  | { type: "pick-account"; account: string }
  /** Continue from a step. */
  | { type: "host"; target: string; keyStored: boolean }
  | { type: "key-saved" }
  | { type: "accounts"; accounts: Array<{ id: string; name: string }> }
  | { type: "account"; account: string }
  | { type: "project"; project: string }
  | { type: "started"; jobId: string }
  | { type: "finished"; job: Job }
  | { type: "failed"; back: SetupStep | null }
  | { type: "back" }
  | { type: "go"; step: SetupStep };

const ORDER: SetupStep[] = ["host", "key", "account", "name"];

/** Where setup starts: at the host, unless the site already has one (then straight to what's missing). */
export function initialSetup(status: DeployStatus | null | undefined, intent: SetupIntent = "production"): SetupState {
  const config = status?.config;
  return {
    step: config ? "name" : "host",
    intent,
    target: config?.target ?? null,
    account: config?.account ?? null,
    project: config?.project ?? status?.suggestedProject ?? "",
    accounts: null,
    jobId: null,
    retryStep: null,
  };
}

export function setupReducer(state: SetupState, action: SetupAction): SetupState {
  switch (action.type) {
    case "reset":
      return action.state;
    case "pick-host":
      return { ...state, target: action.target };
    case "pick-account":
      return { ...state, account: action.account };
    case "host":
      // A different host forgets the account picked for the last one.
      return { ...state, target: action.target, account: state.target === action.target || state.target === null ? state.account : null, accounts: null, step: "key" };
    case "key-saved":
      return { ...state, step: "account" };
    case "accounts": {
      const only = action.accounts.length === 1 ? action.accounts[0]!.id : null;
      const keep = action.accounts.some((entry) => entry.id === state.account) ? state.account : null;
      return { ...state, accounts: action.accounts, account: keep ?? only };
    }
    case "account":
      return { ...state, account: action.account.trim(), step: "name" };
    case "project":
      return { ...state, project: action.project };
    case "started":
      return { ...state, jobId: action.jobId, step: "working", retryStep: null };
    case "finished":
      if (action.job.id !== state.jobId || action.job.state === "running") return state;
      return action.job.state === "done" ? { ...state, step: "done" } : { ...state, step: "failed", retryStep: nextStepForJob(action.job) };
    case "failed":
      return { ...state, step: "failed", retryStep: action.back };
    case "back": {
      const at = ORDER.indexOf(state.step);
      if (state.step === "failed") return { ...state, step: state.retryStep ?? "name" };
      return at > 0 ? { ...state, step: ORDER[at - 1]! } : state;
    }
    case "go":
      return { ...state, step: action.step };
  }
}

/** Whether the person may press the step's main button. */
export function canContinue(state: SetupState, check: { available: boolean } | null): boolean {
  if (state.step === "host") return state.target !== null;
  if (state.step === "account") return Boolean(state.account?.trim());
  if (state.step === "name") return Boolean(state.target && state.account && state.project && check?.available);
  return true;
}

// ─────────────────────────────────────────────────────────────── failures

export interface Failure {
  title: string;
  body: string;
  /** Where to send the person to fix it; null when trying again is the fix. */
  back: SetupStep | null;
}

/**
 * An error from the deploy routes, in plain words, with where it sends the
 * person. The engine already writes the sentence; this decides the next step
 * and covers what only the browser can know (the app itself out of reach).
 */
export function failureFor(error: { offline?: boolean; shape?: GalleyErrorShape } | GalleyErrorShape, host = "the host"): Failure {
  const offline = "offline" in error && error.offline;
  const shape: GalleyErrorShape = "shape" in error && error.shape ? error.shape : (error as GalleyErrorShape);
  if (offline) return { title: "Can’t reach this app", body: "The app isn’t answering. Check that it’s still running, then try again. Nothing was changed.", back: null };
  const message = shape.message ?? "";
  if (/access key/i.test(message) && /(didn.t accept|first|can.t see)/i.test(message)) return { title: "Check the access key", body: message, back: "key" };
  if (shape.code === "forbidden" || /Permissions|scope/i.test(message)) return { title: "The access key is missing a permission", body: message, back: "key" };
  if (shape.code === "conflict" || /name/i.test(message) && shape.code === "invalid") return { title: "That name can’t be used", body: message, back: "name" };
  if (/workers\.dev address|account ID|team/i.test(message) && shape.code === "unconfigured") return { title: "The account needs one more step", body: message, back: "account" };
  if (shape.code === "busy") return { title: "Already working on it", body: message, back: null };
  return { title: "Couldn’t put the site online", body: message || "Nothing on the live site changed. Try again.", back: null };
}

/** A failed deploy job sends the person back to the step that can fix it, or nowhere (try again). */
export function nextStepForJob(job: Job): SetupStep | null {
  const detail = job.detail ?? "";
  if (/access key/i.test(detail)) return "key";
  if (/can.t be used|Choose a different name/i.test(detail)) return "name";
  if (/workers\.dev address|account/i.test(detail) && !/build/i.test(detail)) return "account";
  return null;
}

/** A failed job's headline, by what kind of trouble it was. */
export function jobFailureTitle(job: Job): string {
  const detail = job.detail ?? "";
  if (/build stopped/i.test(detail)) return "The site couldn’t be built";
  if (/files|takes at most|takes files up to|takes up to/i.test(detail) && /Nothing was uploaded/.test(detail)) return "The site is too big for this host";
  if (/can.t reach|took too long/i.test(detail)) return "Couldn’t reach the host";
  if (/Nothing has been published/i.test(detail)) return "Nothing to put live yet";
  if (/access key/i.test(detail)) return "The access key needs attention";
  return job.label.startsWith("Making") ? "Couldn’t make the preview link" : "Couldn’t put the site online";
}

// ─────────────────────────────────────────────────────────────── progress

export interface ProgressStep {
  label: string;
  state: "done" | "current" | "todo";
}

/** The three plain steps the person sees: building, uploading, live. */
export function progressSteps(job: Job | null, intent: SetupIntent): ProgressStep[] {
  const last = intent === "preview" ? "Preview ready" : "Live";
  const labels = ["Building the site", "Uploading the files", last];
  const progress = job?.state === "done" ? 1 : (job?.progress ?? 0);
  const at = job?.state === "done" ? 3 : progress >= 0.95 ? 2 : progress >= 0.4 ? 1 : 0;
  return labels.map((label, index) => ({ label, state: index < at ? "done" : index === at ? "current" : "todo" }));
}

/** The host named in a target id, for copy that has to name it before targets load. */
export function targetName(targets: DeployTargetInfo[] | undefined, id: string | null | undefined): string {
  return targets?.find((target) => target.id === id)?.name ?? (id === "vercel" ? "Vercel" : "Cloudflare");
}

/**
 * A site that is online through a host doesn't need a git remote to be live:
 * "saved here, they stay here" would contradict the deploy note under the
 * Publish dialog's result. Only that sentence changes; every other outcome is
 * shown as it is.
 */
export function onlineOutcome<T extends { kind: string; title: string; body: string }>(outcome: T, online: boolean): T {
  if (!online || outcome.kind !== "saved-local") return outcome;
  return { ...outcome, title: "Published", body: outcome.body.replace(/ This site isn’t set up to send versions to a host, so they stay here\.$/, "") };
}
