/**
 * The browser half of the "status" example: how many changes wait, in the
 * top bar, kept current by the extension's own event; and the team's note
 * after a page's title, in someone else's words. The docs page shows the top
 * bar's part of it.
 *
 * One request for a site, however many places show its answer: a list draws
 * its rows' additions once for every row on screen, and again as it scrolls.
 */
import { useEffect, useSyncExternalStore } from "react";
import { extensionApi, onReconnect, SafeText, setStreamValue, subscribeExtension, useRoleMay, useSiteId, type Addition } from "@galley/web/additions";
import { Badge } from "@galley/web/ui";

const status = extensionApi("status");

interface Status {
  waiting: number;
  note: string | null;
}

/** What is known about each site, who is showing it, and how to stop keeping it current once nobody is. */
const sites = new Map<string, { answer: Status | null; showing: Set<() => void>; stop: (() => void) | null }>();

function entryFor(siteId: string) {
  let entry = sites.get(siteId);

  if (!entry) sites.set(siteId, (entry = { answer: null, showing: new Set(), stop: null }));
  return entry;
}

function load(siteId: string): void {
  void status
    .get<Status>(["sites", siteId])
    .then((answer) => {
      const entry = entryFor(siteId);

      entry.answer = answer;
      for (const show of entry.showing) show();
    })
    .catch(() => undefined);
}

/** Starts keeping a site's answer current when the first place shows it, and stops when the last one has gone. */
function watch(siteId: string, show: () => void): () => void {
  const entry = entryFor(siteId);

  entry.showing.add(show);
  if (!entry.stop) {
    const again = () => load(siteId);
    // Asked again whenever the note changed, the stream came back, or the server says this window missed some events.
    const stops = [subscribeExtension("status", "changed", again), subscribeExtension("status", "stream.missed", again), onReconnect(again)];

    entry.stop = () => stops.forEach((stop) => stop());
    again();
  }
  return () => {
    entry.showing.delete(show);
    if (entry.showing.size > 0) return;
    entry.stop?.();
    entry.stop = null;
  };
}

function useStatus(siteId: string | null): Status | null {
  return useSyncExternalStore(
    (show) => (siteId ? watch(siteId, show) : () => undefined),
    () => (siteId ? (sites.get(siteId)?.answer ?? null) : null),
  );
}

function Waiting() {
  const answer = useStatus(useSiteId());
  const mayPublish = useRoleMay("publish");

  if (!answer || answer.waiting === 0) return null;
  return <Badge tone="change">{mayPublish ? `${answer.waiting} waiting to publish` : `${answer.waiting} waiting`}</Badge>;
}

/** The team's note after a page's title: one line of it, however long it is. */
function Note({ siteId }: { siteId: string; path: string }) {
  const answer = useStatus(siteId);

  return answer?.note ? (
    <span style={{ display: "inline-block", maxInlineSize: "24ch", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>
      <SafeText text={answer.note} />
    </span>
  ) : null;
}

/** Says on the window's stream that this window is here, under a name made up for it once. Not a secret: it is in the address. */
const windowName = `window-${crypto.randomUUID()}`;

function Here() {
  useEffect(() => setStreamValue("status", () => windowName), []);
  return null;
}

export const statusAddition: Addition = { id: "status", root: Here, topBar: Waiting, listRow: Note };
