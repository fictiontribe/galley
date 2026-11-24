/**
 * The walkthrough's steps and how each one ends, as plain data and pure
 * functions (tested in test/demo/tour.test.ts). A step ends when the
 * visitor does the real thing it asks for — the facts below are read from
 * the demo's own server and the app's address, never from clicks on the
 * card — or when they choose to skip it.
 */

export type StepId = "welcome" | "form" | "page" | "assistant" | "proof" | "putBack" | "publish" | "history" | "done";

/** What has happened, as the demo's server and the app's address tell it. */
export interface Facts {
  /** The app's route, e.g. "/sites/caddow/edit". */
  route: string;
  /** The `path` of the entry open in the editor, if any. */
  entryPath: string | null;
  /** Unpublished field changes (a changed file with no field detail counts as one). */
  pending: number;
  /** A heading or a title differs from the published version. */
  headingChanged: boolean;
  /** A text was retyped on the page itself and saved. */
  pageEdited: boolean;
  /** The assistant's recorded change landed. */
  assistantChanged: boolean;
  /** Versions published during this visit. */
  published: number;
}

export interface TourState {
  step: StepId;
  /** Pending changes when the current step began: "put one back" ends when there are fewer. */
  pendingAtStart: number;
  publishedAtStart: number;
}

export interface StepCopy {
  id: StepId;
  /** Shown as "2 of 7": one number to a step. The welcome and the closing card are not steps and have none. */
  number: number | null;
  title: string;
  body: string;
  /** What finishes the step without the card: shown as a hint line. */
  doing?: string;
}

export const HOME_PAGE = "src/content/pages/index.md";
export const TOTAL_STEPS = 7;

export const STEPS: StepCopy[] = [
  {
    id: "welcome",
    number: null,
    title: "This is the real editor.",
    body: "It’s running in your browser on a sample site, a small clothing label called Caddow. Change anything you like: nothing is saved, and nothing leaves this page. The tour takes about two minutes.",
  },
  {
    id: "form",
    number: 1,
    title: "Change the heading in the form.",
    body: "This is the home page. The form on the left holds its words; the page beside it is the site itself. Edit the campaign heading and watch the page follow.",
    doing: "Type in the Heading field",
  },
  {
    id: "page",
    number: 2,
    title: "Or click the page and type.",
    body: "Click any text on the page, retype it in place, then click outside it or press Enter. It becomes a change like the one you made in the form.",
    doing: "Click a piece of text on the page",
  },
  {
    id: "assistant",
    number: 3,
    title: "Ask the assistant.",
    body: "On your own site the assistant uses your own AI key. The demo has none, so it replays one answer recorded in advance for the request below.",
    doing: "Send the request",
  },
  {
    id: "proof",
    number: 4,
    title: "Open Proof.",
    body: "Every change waits here before anything goes live: the old words struck out, the new ones written in, and the page beside the live site.",
    doing: "Open Proof",
  },
  {
    id: "putBack",
    number: 5,
    title: "Put one back.",
    body: "Changed your mind about one of them? Put it back, and the rest stay as they are.",
    doing: "Press Put back on one change",
  },
  {
    id: "publish",
    number: 6,
    title: "Publish.",
    body: "This is the real Publish dialog. On your own site, publishing is a commit to your own repository, and your host takes it live from there. Here nothing leaves the browser.",
    doing: "Press Publish",
  },
  {
    id: "history",
    number: 7,
    title: "It’s a version now.",
    body: "Nothing went live, because this is the demo. On your own site this is when your host updates the pages. Every publish is kept in Version history with who and when, and you can undo it.",
    doing: "Open Version history",
  },
  {
    id: "done",
    number: null,
    title: "That’s the idea.",
    body: "Prompt it, proof it, publish it. Everything else is here too, on sample data: forms and the inbox, scripts, brand, Search & AI, redirects and Online. Where a screen would need a real account, it says what the demo stands in for. The moon at the foot of the sidebar turns the app dark.",
  },
];

export const ORDER: StepId[] = STEPS.map((step) => step.id);

export function copyOf(id: StepId): StepCopy {
  return STEPS.find((step) => step.id === id) ?? (STEPS[0] as StepCopy);
}

export function start(facts: Pick<Facts, "pending" | "published">): TourState {
  return { step: "welcome", pendingAtStart: facts.pending, publishedAtStart: facts.published };
}

const isRoute = (route: string, screen: string) => new RegExp(`^/sites/[^/]+/${screen}(?:[/?#]|$)`).test(route);

/** Whether the visitor has done what the step asks. Welcome and Done end only from the card. */
export function isDone(state: TourState, facts: Facts): boolean {
  switch (state.step) {
    case "welcome":
    case "done":
      return false;
    case "form":
      return facts.headingChanged;
    case "page":
      return facts.pageEdited;
    case "assistant":
      return facts.assistantChanged;
    case "proof":
      return isRoute(facts.route, "proof");
    case "putBack":
      return facts.pending < state.pendingAtStart;
    case "publish":
      return facts.published > state.publishedAtStart;
    case "history":
      return isRoute(facts.route, "history");
  }
}

/** The step after this one; it starts from the facts as they are now. */
export function next(state: TourState, facts: Pick<Facts, "pending" | "published">): TourState {
  const at = ORDER.indexOf(state.step);
  const step = ORDER[Math.min(at + 1, ORDER.length - 1)] as StepId;
  return { step, pendingAtStart: facts.pending, publishedAtStart: facts.published };
}

/**
 * Move on while the facts say the current step is done — several at once
 * when the visitor ran ahead (published before opening Proof, say) — but
 * never past a step that ends only from the card.
 */
export function settle(state: TourState, facts: Facts): TourState {
  let current = state;
  for (let guard = 0; guard < ORDER.length && isDone(current, facts); guard++) current = next(current, facts);
  return current;
}

/** Proof without changes has nothing to put back: skip that half and go to Publish's. */
export function skipEmpty(state: TourState, facts: Facts): TourState {
  if ((state.step === "putBack" || state.step === "publish") && facts.pending === 0) {
    return state.step === "putBack" ? next(state, facts) : state;
  }
  return state;
}

/**
 * At Publish with nothing waiting and nothing published since the step
 * began: the visitor discarded every change (the bar's Discard, where the
 * step before asked for one change to be put back), so there is nothing to
 * publish and the step can't be done as it stands. The card then says so
 * and points back at the page; the step carries on once there is a change.
 */
export function nothingToPublish(state: TourState, facts: Pick<Facts, "pending" | "published">): boolean {
  return state.step === "publish" && facts.pending === 0 && facts.published <= state.publishedAtStart;
}

export const NOTHING_TO_PUBLISH =
  "Nothing is waiting to be published now: no changes are left. Change a word on the home page, and this step carries on from there.";

/** Where a step happens, for its "Take me there" button: an app route, or null when it happens where the visitor already is. */
export function placeFor(step: StepId, siteId: string): string | null {
  switch (step) {
    case "form":
    case "page":
    case "assistant":
      return `/sites/${siteId}/edit?path=${encodeURIComponent(HOME_PAGE)}`;
    case "proof":
    case "putBack":
    case "publish":
      return `/sites/${siteId}/proof`;
    case "history":
      return `/sites/${siteId}/history`;
    default:
      return null;
  }
}

/** True when the visitor is where the step happens (the card then points at the control instead of offering to go there). */
export function isThere(step: StepId, facts: Pick<Facts, "route" | "entryPath">): boolean {
  switch (step) {
    case "form":
    case "page":
    case "assistant":
      return isRoute(facts.route, "edit") && facts.entryPath === HOME_PAGE;
    case "proof":
      return true;
    case "putBack":
    case "publish":
      return isRoute(facts.route, "proof");
    case "history":
      return true;
    default:
      return true;
  }
}
