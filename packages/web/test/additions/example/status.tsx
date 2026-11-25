/**
 * The browser half of the "status" example: how many changes wait, in the
 * top bar, kept current by the extension's own event; and the team's note
 * after a page's title, in someone else's words.
 */
import { useEffect, useState } from "react";
import { extensionApi, onReconnect, SafeText, setStreamValue, subscribeExtension, useRoleMay, useSiteId, type Addition } from "@galley/web/additions";
import { Badge } from "@galley/web/ui";

const status = extensionApi("status");

interface Status {
  waiting: number;
  note: string | null;
}

function useStatus(siteId: string | null): Status | null {
  const [answer, setAnswer] = useState<Status | null>(null);

  useEffect(() => {
    if (!siteId) return;
    let here = true;
    const load = () =>
      void status
        .get<Status>(["sites", siteId])
        .then((next) => here && setAnswer(next))
        .catch(() => undefined);
    // Asked again whenever the note changed, the stream came back, or the server says this window missed some events.
    const stops = [subscribeExtension("status", "changed", load), subscribeExtension("status", "stream.missed", load), onReconnect(load)];

    load();
    return () => {
      here = false;
      for (const stop of stops) stop();
    };
  }, [siteId]);
  return siteId ? answer : null;
}

function Waiting() {
  const answer = useStatus(useSiteId());
  const mayPublish = useRoleMay("publish");

  if (!answer || answer.waiting === 0) return null;
  return <Badge tone="change">{mayPublish ? `${answer.waiting} waiting to publish` : `${answer.waiting} waiting`}</Badge>;
}

function Note({ siteId }: { siteId: string; path: string }) {
  const answer = useStatus(siteId);

  return answer?.note ? <SafeText text={answer.note} /> : null;
}

/** Says on the window's stream that this window is here, under a name made up for it. Not a secret: it is in the address. */
function Here() {
  useEffect(() => setStreamValue("status", () => `window-${crypto.randomUUID()}`), []);
  return null;
}

export const statusAddition: Addition = { id: "status", root: Here, topBar: Waiting, listRow: Note };
