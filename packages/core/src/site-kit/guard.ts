/**
 * The write surface's rule for a form's custom code (Principle 6). A
 * `script` action runs on every visitor's browser with the page's
 * privileges, so adding or changing one is a build-mode change: refused in
 * content mode (the assistant or an AI tool editing content, which is also
 * what an "agent" write without a mode counts as), and refused when the site
 * doesn't allow build mode, or the person's account can't use build mode.
 * Removing one, or editing anything else in the form, is ordinary content
 * editing.
 */
import { BUILD_MODE_LEVEL } from "../install/route-access";
import { BUILD_MODE_REFUSAL, callerMay, callerRefusal } from "../install/caller";
import type { AgentMode, ChangeOrigin } from "../types";

type Json = Record<string, unknown>;

function scriptCodes(text: string | null): string[] {
  if (text === null) return [];
  let data: unknown;

  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const actions = data && typeof data === "object" && !Array.isArray(data) ? (data as Json).afterSubmit : undefined;

  return Array.isArray(actions) ? actions.filter((action): action is Json => !!action && typeof action === "object" && (action as Json).type === "script").map((action) => String(action.code ?? "")) : [];
}

/** The code a new version adds that the old one didn't have. */
export function addedFormCode(before: string | null, after: string): string[] {
  const left = [...scriptCodes(before)];

  return scriptCodes(after).filter((code) => {
    const at = left.indexOf(code);

    if (at === -1) return true;
    left.splice(at, 1);
    return false;
  });
}

/** Why this write of a form file may not add custom code, or null when it may. */
export function formCodeRefusal(before: string | null, after: string, who: { origin: ChangeOrigin; mode?: AgentMode; allowBuild: boolean }): string | null {
  if (addedFormCode(before, after).length === 0) return null;
  const mode = who.mode ?? (who.origin === "agent" ? "content" : undefined);

  if (mode === "content") return "Custom code in a form runs in every visitor's browser, so it can only be added in build mode. Nothing was changed.";
  // The person in the app counts as build mode here, so their account must allow build mode too.
  if (!callerMay(BUILD_MODE_LEVEL)) return callerRefusal(BUILD_MODE_REFUSAL);
  if (!who.allowBuild) return "Custom code in a form can only be added on sites that allow build mode. Nothing was changed.";
  return null;
}
