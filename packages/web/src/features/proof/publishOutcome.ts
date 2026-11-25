/**
 * What a publish result means, in the words voice.md gives each outcome.
 * Every claim comes from the result: "live" only when it was sent, "review"
 * only when a request exists.
 */
import type { PublishMode, PublishResult } from "@galley/core/types";
import { count } from "@/lib/format";
import { placeWords } from "@/lib/where";

export type PublishOutcomeKind =
  | "published"
  | "saved-local"
  | "not-sent"
  | "review"
  | "review-not-sent"
  | "nothing"
  | "failed"
  /**
   * Paused before anything was committed: the repository has newer versions. "Get the latest", then publish again —
   * or, when they change a file that is changed here too, discard that change first (Proof shows it).
   */
  | "behind"
  /** "Send now" outcomes: versions published here reached the host, there was nothing waiting, or they still didn't go. */
  | "sent"
  | "nothing-to-send"
  | "send-failed";

export interface PublishOutcome {
  kind: PublishOutcomeKind;
  tone: "success" | "warning" | "danger" | "neutral";
  /** No full stop (a toast or dialog title). */
  title: string;
  /** Sentences, with full stops. */
  body: string;
  /** Technical detail for the disclosure. */
  detail?: string;
  /** A link to the review request. */
  reviewUrl?: string;
  /** Whether trying the same publish again can help (the changes are still waiting). */
  canRetry: boolean;
  /** Whether "Try sending again" can help: versions are saved here but haven't reached the host. */
  canSend?: boolean;
  /** Whether "Get the latest" is the way on: the repository has newer versions, nothing was published here, and nothing here is in their way. */
  canGetLatest?: boolean;
  /** Whether Proof is the way on: a change here has to be discarded before the newer versions can come in, and Proof shows it. */
  canReview?: boolean;
}

const NOTHING = /nothing to publish|none of those files|match the last published/i;

/** `hosted`: a hosted install records versions in this editor, on its server — not on "this computer". */
export function publishOutcome(result: PublishResult, { message, mode, hosted = false }: { message: string; mode: PublishMode; hosted?: boolean }): PublishOutcome {
  const changes = count(result.files.length, "change");
  if (!result.ok) {
    if (NOTHING.test(result.error ?? "")) {
      return { kind: "nothing", tone: "neutral", title: "Nothing to publish", body: "Everything here already matches the live site.", canRetry: false };
    }
    if (result.behind) {
      // The heading says what happened to the publish; the engine's words say why, and the way on.
      const inTheWay = (result.inTheWay?.length ?? 0) > 0;
      const body = result.error ?? "The repository has newer versions than this copy, so nothing was published and nothing was overwritten. Your edits are safe. Get the latest versions, then publish again.";

      // A change here that the newer versions change too: getting the latest would be refused, so Proof is offered instead.
      return { kind: "behind", tone: "warning", title: "Publishing is paused", body, detail: result.detail, canRetry: false, ...(inTheWay ? { canReview: true } : { canGetLatest: true }) };
    }
    return {
      kind: "failed",
      tone: "danger",
      title: "Couldn’t publish",
      body: `${result.error ?? "The publish didn’t finish."} Your changes are safe here.`,
      detail: result.detail,
      canRetry: true,
    };
  }
  if (result.pullRequestUrl || (mode === "pull-request" && result.pushed)) {
    return {
      kind: "review",
      tone: "success",
      title: "Sent for review",
      body: `A developer can approve “${message}” before it goes live.`,
      ...(result.pullRequestUrl ? { reviewUrl: result.pullRequestUrl } : {}),
      canRetry: false,
    };
  }
  if (result.pushError) {
    // Review mode keeps the changes waiting here when sending fails; a direct publish has already made the version.
    const review = mode === "pull-request";
    return {
      kind: review ? "review-not-sent" : "not-sent",
      tone: "warning",
      title: review ? "Couldn’t send for review" : "Saved, not live yet",
      body: review
        ? `${result.pushError} Your changes are still here, waiting.`
        : `Your ${changes} ${result.files.length === 1 ? "is" : "are"} recorded here as a new version but didn’t reach the site’s host. ${result.pushError}`,
      detail: result.detail,
      canRetry: review,
      canSend: !review,
    };
  }
  if (result.pushed) {
    return {
      kind: "published",
      tone: "success",
      title: "Published",
      body: `${changes.charAt(0).toUpperCase()}${changes.slice(1)} ${result.files.length === 1 ? "is" : "are"} live. The site usually updates within a minute.`,
      canRetry: false,
    };
  }
  return {
    kind: "saved-local",
    tone: "success",
    title: `Published ${placeWords(hosted).recorded}`,
    body: `${changes.charAt(0).toUpperCase()}${changes.slice(1)} ${result.files.length === 1 ? "is" : "are"} saved as a new version. This site isn’t set up to send versions to a host, so they stay here.`,
    canRetry: false,
  };
}

const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * What "Send now" (POST …/send) achieved, in the same plain words. `waiting`
 * is how many versions were known to be waiting before sending, when known.
 */
export function sendOutcome(result: PublishResult, { waiting = 0 }: { waiting?: number } = {}): PublishOutcome {
  if (result.ok && result.pushed) {
    if (waiting === 0 && result.files.length === 0) {
      return { kind: "nothing-to-send", tone: "neutral", title: "Nothing to send", body: "Everything published here has already reached the site’s host.", canRetry: false };
    }
    const versions = waiting > 0 ? `${capital(count(waiting, "version"))} published here ${waiting === 1 ? "has" : "have"}` : "The versions published here have";
    return { kind: "sent", tone: "success", title: "Sent", body: `${versions} reached the site’s host. The site usually updates within a minute.`, canRetry: false };
  }
  const reason = result.pushError ?? result.error;
  if (result.pushError || (result.ok && !result.pushed)) {
    return {
      kind: "send-failed",
      tone: "warning",
      title: "Couldn’t send",
      body: `${reason ? `${reason} ` : ""}The versions stay saved here, ready to send.`,
      detail: result.detail,
      canRetry: false,
      canSend: true,
    };
  }
  return {
    kind: "send-failed",
    tone: "danger",
    title: "Couldn’t send",
    body: `${reason ?? "Sending didn’t finish."} The versions stay saved here.`,
    detail: result.detail,
    canRetry: false,
    canSend: false,
  };
}
