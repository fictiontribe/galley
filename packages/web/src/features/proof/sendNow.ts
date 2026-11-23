/**
 * "Send now": versions published on this computer that haven't reached the
 * site's host yet go out (POST …/send). Used by the publish dialog, the
 * status bar and Version history, so the outcome reads the same everywhere.
 */
import { api, errorShape } from "@/lib/api";
import { invalidate } from "@/lib/query";
import { useSite } from "@/lib/stores/site";
import { notify } from "@/lib/stores/toasts";
import { keys } from "@/lib/sync";
import { sendOutcome, type PublishOutcome } from "./publishOutcome";

export async function sendNow(siteId: string, waiting = 0): Promise<PublishOutcome> {
  let outcome: PublishOutcome;
  try {
    const result = await api("POST /api/sites/:siteId/send", { params: { siteId } });
    outcome = sendOutcome(result, { waiting });
  } catch (error) {
    const shape = errorShape(error);
    outcome = { kind: "send-failed", tone: "danger", title: "Couldn’t send", body: `${shape.message} The versions stay saved here.`, detail: shape.detail, canRetry: false, canSend: true };
  }
  invalidate(keys.git(siteId));
  invalidate(["site", siteId, "history"]);
  if (useSite.getState().siteId === siteId) void useSite.getState().refresh();
  return outcome;
}

/** Send, then say how it went in a toast — with "Try again" while it can still help. */
export async function sendNowWithToast(siteId: string, waiting = 0): Promise<PublishOutcome> {
  const outcome = await sendNow(siteId, waiting);
  notify({
    tone: outcome.tone,
    title: outcome.title,
    body: outcome.body,
    detail: outcome.detail,
    ...(outcome.canSend ? { action: { label: "Try again", onClick: () => void sendNowWithToast(siteId, waiting) } } : {}),
  });
  return outcome;
}
