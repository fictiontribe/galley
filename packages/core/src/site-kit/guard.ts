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
import { BUILD_MODE_REFUSAL, callerMay, callerRefusal, callerViaPreview } from "../install/caller";
import { normalizePath } from "../content/entries/paths";
import { PAGE_SAVE_REFUSAL } from "../site/content-code";
import type { AgentMode, ChangeOrigin, Collection } from "../types";
import { SCRIPTS_FILE } from "./detect";

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
  // A save the previewed page asked for is the page's, not the person's: held to the lowest level whoever is signed in.
  if (callerViaPreview()) return callerRefusal(PAGE_SAVE_REFUSAL);
  const mode = who.mode ?? (who.origin === "agent" ? "content" : undefined);

  if (mode === "content") return "Custom code in a form runs in every visitor's browser, so it can only be added in build mode. Nothing was changed.";
  // The person in the app counts as build mode here, so their account must allow build mode too.
  if (!callerMay(BUILD_MODE_LEVEL)) return callerRefusal(BUILD_MODE_REFUSAL);
  if (!who.allowBuild) return "Custom code in a form can only be added on sites that allow build mode. Nothing was changed.";
  return null;
}

// ── The site kit's scripts file: the scripts that run on every page

/** A value as JSON with its object keys in order, so the same settings compare equal however they were written. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Json)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Json)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * What runs from a scripts file: each script that is on, by what makes its code
 * (its kind and settings — a custom one is written from them as it is — and
 * whether it also runs in the preview). Null when the text isn't JSON.
 */
function runningScripts(text: string | null): string[] | null {
  if (text === null) return [];
  let data: unknown;

  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const scripts = data && typeof data === "object" && !Array.isArray(data) ? (data as Json).scripts : undefined;

  if (!Array.isArray(scripts)) return [];
  return scripts
    .filter((entry): entry is Json => !!entry && typeof entry === "object" && (entry as Json).enabled === true)
    .map((entry) => stableJson({ kind: entry.kind, settings: entry.settings, inPreview: entry.inPreview }));
}

/** The scripts a new version of the scripts file turns on or changes that the old one didn't run. A file that isn't JSON counts as a change. */
export function addedScripts(before: string | null, after: string): string[] {
  const now = runningScripts(after);

  if (now === null) return ["(a scripts file that can't be read)"];
  const left = [...(runningScripts(before) ?? [])];

  return now.filter((code) => {
    const at = left.indexOf(code);

    if (at === -1) return true;
    left.splice(at, 1);
    return false;
  });
}

/** Whether `path` is the site kit's scripts file: tagged so, at its usual place, or a data file named scripts.json. */
export function isScriptsFile(path: string, collection: Collection | null): boolean {
  const normal = normalizePath(path);

  return collection?.kit === "scripts" || normal === SCRIPTS_FILE || (collection?.kind === "data" && /(^|\/)scripts\.json$/i.test(normal));
}

/**
 * Why this write of the scripts file may not turn on or change a script, or
 * null when it may. Every script on runs in every visitor's browser, so adding
 * or changing one is a build-mode change, gated as a form's custom code is:
 * refused for a save the previewed page asked for, in content mode, below the
 * build-mode level, and where the site doesn't allow build mode. Turning one
 * off, removing it, or editing its label, placement or consent is content.
 */
export function scriptCodeRefusal(before: string | null, after: string, who: { origin: ChangeOrigin; mode?: AgentMode; allowBuild: boolean }): string | null {
  if (addedScripts(before, after).length === 0) return null;
  if (callerViaPreview()) return callerRefusal(PAGE_SAVE_REFUSAL);
  const mode = who.mode ?? (who.origin === "agent" ? "content" : undefined);

  if (mode === "content") return "A script on the site's pages runs in every visitor's browser, so it can only be turned on or changed in build mode. Nothing was changed.";
  if (!callerMay(BUILD_MODE_LEVEL)) return callerRefusal(BUILD_MODE_REFUSAL);
  if (!who.allowBuild) return "A script on the site's pages can only be turned on or changed on sites that allow build mode. Nothing was changed.";
  return null;
}
