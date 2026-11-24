/**
 * Why a page can't be arranged, told truthfully. The overlay says what it
 * found (`arrange-status` with a cause) and whether the page was drawn at all
 * (`page-state`); this turns both into one of four plain cases, and only says
 * "this site hasn't marked its sections" when a page that drew really carries
 * no marks. A page that failed to draw is the site's error, not the site's
 * markup, and it usually follows a change made a moment ago — so the note
 * names that change and offers its Undo.
 */
import type { ArrangeDeclineCause, PageDrawState } from "@galley/core/types";
import type { LastListAction } from "@/features/content/fields/items/listActions";

/** The four cases a person is told apart. */
export type DeclineKind = "unmarked" | "failed" | "unavailable" | "other";

/** What the page is known to be: the overlay's word, with when it was heard. */
export interface PageReport extends PageDrawState {
  /** When the app heard it (Date.now()). */
  at: number;
}

/**
 * The case, from the overlay's cause and the page's drawn state. A failed or
 * unavailable page wins over any cause (an error page has no marks to find);
 * an unknown or absent cause is "other", never "unmarked".
 */
export function declineKind(cause: ArrangeDeclineCause | null | undefined, page: PageDrawState | null): DeclineKind {
  if (page?.state === "failed" || cause === "page-failed") return "failed";
  if (page?.state === "unavailable" || cause === "preview-unavailable") return "unavailable";
  if (cause === "unmarked" && (page === null || page.state === "drawn")) return "unmarked";
  return "other";
}

/**
 * The change the failure began with: the last undoable change, when the page
 * was last seen drawn before it was made (so the page drew until then). Null
 * when the page was already failing, or nothing was changed here.
 */
export function failureCause(last: LastListAction | null, drawnAt: number | null): LastListAction | null {
  if (!last || drawnAt === null) return null;
  return drawnAt <= last.at ? last : null;
}

export interface DeclineWords {
  title: string;
  body: string;
}

/** The sentences for each case. `after` is the change a failed page began with, when known. */
export function declineWords(kind: DeclineKind, options: { cause?: ArrangeDeclineCause | null; after?: LastListAction | null } = {}): DeclineWords {
  switch (kind) {
    case "unmarked":
      return {
        title: "Sections can’t be arranged on this page.",
        body: "This site hasn’t marked its sections for arranging on the page, and they can’t be told apart for certain here. The form’s section list still works: add, move and remove them there.",
      };
    case "failed":
      return options.after
        ? {
            title: "This page couldn’t be drawn.",
            body:
              options.after.index !== null
                ? `It stopped drawing after ${options.after.what}. Undo takes the section away again, or fill it in using the form. Your other changes are safe.`
                : `It stopped drawing after ${options.after.what}. Undo puts the page back as it was. Your other changes are safe.`,
          }
        : {
            title: "This page couldn’t be drawn.",
            body: "The site ran into a problem drawing this page, so its sections can’t be arranged here. Your changes are safe, and the form still works.",
          };
    case "unavailable":
      return {
        title: "The preview isn’t answering.",
        body: "It may be starting or restarting. The page reloads by itself when it answers.",
      };
    case "other":
      return options.cause === "page-missing"
        ? {
            title: "This page isn’t in the preview.",
            body: "The preview has no page at this address yet, so there are no sections to arrange. The form’s section list still works.",
          }
        : {
            title: "Sections can’t be arranged on this page.",
            body: "The sections on the page don’t match this page’s content, so they can’t be told apart for certain. The form’s section list still works: add, move and remove them there.",
          };
  }
}
