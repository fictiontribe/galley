/**
 * Extensions on the live stream.
 *
 * Every window has one stream. For each window this decides what it is sent
 * of an extension's events, and tells an extension that the window is there
 * when the stream carries a value for it (`/api/events?x-<id>=<value>`).
 *
 * - An event reaches a reader only if their role, as it is at that event,
 *   has the level the event's rule names. The rule may then narrow or
 *   reshape it for them; it is never asked below the level.
 * - A reader is a sign-in that still counts, by the test a request is held
 *   to. One that doesn't is sent nothing of an extension's, and its stream
 *   ends.
 * - A value is taken only from the editor's own page: without the operator's
 *   token, the browser must say the request is that page's, as it must for
 *   an added route. A page on another origin could otherwise open a stream
 *   as the person signed in, and pass for them being there. A value from
 *   anywhere else is refused, and its extension is never told.
 * - Refusing a value never refuses the stream, whoever refuses it (this
 *   check, the value's shape, the extension). There is one stream for the
 *   whole app, and a browser can't read why one failed: it would be asked
 *   for again for ever. The stream opens and is sent `stream.refused`.
 * - With half of what a reader may have waiting already there, an
 *   extension's event is left out for that reader and counted. So an
 *   extension's events never fill more than about half of what a reader
 *   may have waiting (half, and one event), and the editor's own events
 *   always have at least half of it. Not all of it: a reader an extension
 *   keeps half full is let go by a smaller burst of the editor's own
 *   events than one with nothing waiting.
 */
import type { Context } from "hono";
import { roleMay, type Account } from "@galley/core/install";
import type { ServerEvent } from "@galley/core/types";
import { bearerToken, type SessionInfo } from "../auth";
import type { StreamAccess, StreamHooks } from "../events";
import { STREAM_REFUSED } from "./declare";
import { NOT_FROM_THE_EDITOR, type MountCaller } from "./mount";
import type { StartedExtensions } from "./run";
import type { ExtensionCaller, SessionRef } from "./types";

/** What a value a stream carries for an extension may be. */
const VALUE = /^[A-Za-z0-9._~-]{1,128}$/;
export const NOT_A_VALUE = "A stream's value for an extension is 1 to 128 letters, digits, dots, dashes, underscores or tildes.";

export interface StreamDeps {
  callerOf(c: Context): MountCaller | null;
  /** The account as it is now; null once it is gone or switched off. */
  accountNow(accountId: string): Account | null;
  refOf(session: SessionInfo): SessionRef;
  /** Whether a sign-in counts now, by the test a request is held to. */
  stillCounts(session: SessionInfo): boolean;
}

export function extensionStream(c: Context, runtime: StartedExtensions, deps: StreamDeps, base: StreamAccess | undefined): { access: StreamAccess; hooks: StreamHooks } {
  const who = deps.callerOf(c);
  const query = c.req.query();
  // By the ids the server was started with: the rule is the same whether or not one of them is running at this moment.
  const carried = runtime.ids.map((id) => ({ id, value: query[`x-${id}`] })).filter((entry): entry is { id: string; value: string } => typeof entry.value === "string");

  // A value says "this window is here" to an extension: it is taken only from the editor's own page, or with the operator's token.
  const from = c.req.header("sec-fetch-site");
  const fromTheEditor = bearerToken(c) !== null || from === "same-origin" || from === "none";
  /** Whether the sign-in this stream was opened with still counts. The operator's token and the one person of an install without accounts are not sign-ins. */
  const counts = () => who?.kind !== "person" || deps.stillCounts(who.session);
  /** The reader as they are now: a role taken away since the stream opened is taken away here too. */
  const readerNow = (): ExtensionCaller | null => {
    if (!who) return null;
    if (who.kind !== "person") return { kind: who.kind };
    if (!deps.stillCounts(who.session)) return null;
    const account = deps.accountNow(who.account.id);

    return account ? { kind: "person", account: account.id, role: account.role, name: account.name, session: deps.refOf(who.session) } : null;
  };
  const refusals: ServerEvent[] = [];

  return {
    access: {
      live: () => (base?.live() ?? true) && counts(),
      ...(base?.onChange ? { onChange: (listener: () => void) => base.onChange!(listener) } : {}),
      filter(event) {
        if (event.type !== "extension") return base ? base.filter(event) : event;
        // The reader may no longer listen at all.
        if (base && base.filter(event) === null) return null;
        const extension = runtime.find(event.source);
        const rule = extension?.rule(event.name);
        const reader = rule ? readerNow() : null;

        if (!extension || !rule || !reader) return null;
        if (reader.kind === "person" && !roleMay(reader.role, rule.level)) return null;
        const shaped = extension.shape(event.name, event.payload, reader);

        // An event with no rule of its own is the same for every reader: the one object, so it is written out once.
        return shaped ? (shaped.asIs ? event : { ...event, payload: shaped.payload }) : null;
      },
    },
    hooks: {
      opened(close) {
        const ends: Array<() => void> = [];
        const reader = readerNow();

        for (const { id, value } of carried) {
          if (!reader) continue;
          // A value from somewhere else, or one that isn't a value, is never shown to an extension. Each extension is told
          // with an object of its own that can't be changed: what one does with it is not what the next is told.
          const outcome = !fromTheEditor
            ? { refused: { code: "forbidden", message: NOT_FROM_THE_EDITOR }, ended: () => undefined }
            : !VALUE.test(value)
              ? { refused: { code: "invalid", message: NOT_A_VALUE }, ended: () => undefined }
              : runtime.streamOpened(id, Object.freeze({ caller: Object.freeze({ ...reader }), value }), close);

          if (outcome.refused) refusals.push({ type: "extension", source: id, name: STREAM_REFUSED, siteId: "", payload: outcome.refused });
          ends.push(outcome.ended);
        }
        return () => {
          for (const end of ends.splice(0)) end();
        };
      },
      first: () => refusals.splice(0),
      low(event) {
        if (event.type !== "extension") return false;
        runtime.find(event.source)?.skipped();
        return true;
      },
    },
  };
}
