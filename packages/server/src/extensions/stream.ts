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
 * - A stream that carries a value passes the same check as an added route:
 *   with a cookie, the browser must say the request is the editor's own
 *   page's. A page on another origin could otherwise open one as the person
 *   signed in, and pass for them being there.
 * - An extension can refuse its value, never the stream. There is one
 *   stream for the whole app, and a browser can't read why one failed: it
 *   would be asked for again for ever. The window is sent `stream.refused`.
 */
import type { Context } from "hono";
import { roleMay, type Account } from "@galley/core/install";
import type { ServerEvent } from "@galley/core/types";
import { bearerToken, type SessionInfo } from "../auth";
import { forbidden } from "../errors";
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
}

export function extensionStream(c: Context, runtime: StartedExtensions, deps: StreamDeps, base: StreamAccess | undefined): { access: StreamAccess; hooks: StreamHooks } {
  const who = deps.callerOf(c);
  const query = c.req.query();
  // By the ids the server was started with: the rule is the same whether or not one of them is running at this moment.
  const carried = runtime.ids.map((id) => ({ id, value: query[`x-${id}`] })).filter((entry): entry is { id: string; value: string } => typeof entry.value === "string");

  // Only a stream that carries a value says "this window is here" to an extension: that one must come from the editor's own page.
  if (carried.length > 0 && bearerToken(c) === null) {
    const from = c.req.header("sec-fetch-site");

    if (from !== "same-origin" && from !== "none") throw forbidden(NOT_FROM_THE_EDITOR);
  }
  /** The reader as they are now: a role taken away since the stream opened is taken away here too. */
  const readerNow = (): ExtensionCaller | null => {
    if (!who) return null;
    if (who.kind !== "person") return { kind: who.kind };
    const account = deps.accountNow(who.account.id);

    return account ? { kind: "person", account: account.id, role: account.role, name: account.name, session: deps.refOf(who.session) } : null;
  };
  const refusals: ServerEvent[] = [];

  return {
    access: {
      live: () => base?.live() ?? true,
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

        return shaped ? { ...event, payload: shaped.payload } : null;
      },
    },
    hooks: {
      opened(close) {
        const ends: Array<() => void> = [];
        const reader = readerNow();

        for (const { id, value } of carried) {
          if (!reader) continue;
          // A value that isn't one is never shown to an extension.
          const outcome = VALUE.test(value) ? runtime.streamOpened(id, { caller: reader, value }, close) : { refused: { code: "invalid", message: NOT_A_VALUE }, ended: () => undefined };

          if (outcome.refused) refusals.push({ type: "extension", source: id, name: STREAM_REFUSED, siteId: "", payload: outcome.refused });
          ends.push(outcome.ended);
        }
        return () => {
          for (const end of ends.splice(0)) end();
        };
      },
      first: () => refusals.splice(0),
    },
  };
}
