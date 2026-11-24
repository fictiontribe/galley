/**
 * Who may see a hosted install's preview: the GatewayAuth behind the preview
 * gateway (gateway.ts), and the tickets the editor trades for it.
 *
 * A ticket is made only for a signed-in browser session (the entry route,
 * preview-entry.ts): 32 random bytes, kept in memory with the session's id and
 * issue time, good once and for TICKET_LIFETIME_MS. The gateway trades it for
 * the viewer cookie, whose value is derived from that same session — its id,
 * issue time and whose it is, and an HMAC made with the cookie key under a
 * purpose label of its own. So the value can never be read as (or turned
 * into) a session cookie, and it stops working the moment the session does:
 * signing out, "sign out everywhere" (the person's or everyone's), a changed
 * password, the person switched off or removed, the session's age, or a
 * restore. A session that names no person (from before accounts) never
 * gets one.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { InstallStore, SessionStamp } from "@galley/core/install";
import { SESSION_MAX_AGE_S, type RevocationList } from "./auth";
import type { GatewayAuth } from "./gateway";

/** How long a ticket can be traded. The editor uses it at once, in a frame it is loading. */
export const TICKET_LIFETIME_MS = 60_000;
/** Tickets alive at once. The editor asks for two at a time; anything beyond this is someone hammering the route. */
export const MAX_TICKETS = 200;
/** The HMAC's purpose label: a viewer value's MAC is never a session cookie's MAC, whatever the payload. */
const PURPOSE = "preview-viewer/v2";
const VERSION = "v2";
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TICKET_BYTES = 32;

export interface GatewayTickets extends GatewayAuth {
  /** A fresh one-use ticket for this signed-in session. Throws nothing; the oldest ticket gives way when there are too many. */
  issue(session: SessionStamp): string;
  /** Tickets alive now (tests). */
  readonly size: number;
  dispose(): void;
}

export interface GatewayTicketsOptions {
  /** The cookie key. Read on every use, so a key replaced in place (a restore) applies at once. */
  key: Uint8Array;
  store: Pick<InstallStore, "sessionValid" | "isRevoked" | "onSessionsChanged">;
  /** The app's own list of signed-out sessions: a sign-out is in it at once, before it reaches the state file. */
  revoked?: RevocationList;
  now?: () => number;
}

function mac(key: Uint8Array, payload: string): Buffer {
  return createHmac("sha256", key).update(`${PURPOSE}\n${payload}`).digest();
}

export function createGatewayTickets(options: GatewayTicketsOptions): GatewayTickets {
  const now = options.now ?? Date.now;
  /** In issue order, so the oldest is dropped first when the list is full. */
  const tickets: Array<{ value: Buffer; session: SessionStamp; expires: number }> = [];

  function live(session: SessionStamp): boolean {
    const at = now();

    if (!Number.isSafeInteger(session.issuedAt) || session.issuedAt > at + 60_000 || at - session.issuedAt > SESSION_MAX_AGE_S * 1000) return false;
    if (session.accountId === undefined || !ACCOUNT_ID.test(session.accountId)) return false;
    if (options.revoked?.has(session.id) || options.store.isRevoked(session.id, at)) return false;
    return options.store.sessionValid(session, at);
  }

  function prune(): void {
    const at = now();

    for (let i = tickets.length - 1; i >= 0; i -= 1) {
      const ticket = tickets[i]!;

      if (ticket.expires <= at || !live(ticket.session)) tickets.splice(i, 1);
    }
  }

  function viewerValue(session: SessionStamp): string {
    const payload = `${session.issuedAt}.${session.id}.${session.accountId}`;

    return `${VERSION}.${payload}.${mac(options.key, payload).toString("base64url")}`;
  }

  // A sign-out anywhere drops the tickets it ended straight away, not only when they are next looked at.
  const unsubscribe = options.store.onSessionsChanged(prune);

  return {
    issue(session) {
      prune();
      while (tickets.length >= MAX_TICKETS) tickets.shift();
      const value = randomBytes(TICKET_BYTES);

      tickets.push({ value, session: { id: session.id, issuedAt: session.issuedAt, ...(session.accountId !== undefined ? { accountId: session.accountId } : {}) }, expires: now() + TICKET_LIFETIME_MS });
      return value.toString("base64url");
    },

    redeem(ticket) {
      if (typeof ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) return null;
      const given = Buffer.from(ticket, "base64url");

      if (given.length !== TICKET_BYTES) return null;
      let found = -1;

      // Every ticket is compared, in constant time, so how long this takes says nothing about which one nearly matched.
      for (let i = 0; i < tickets.length; i += 1) if (timingSafeEqual(tickets[i]!.value, given) && found < 0) found = i;
      if (found < 0) return null;
      const [entry] = tickets.splice(found, 1);

      if (!entry || entry.expires <= now() || !live(entry.session)) return null;
      return viewerValue(entry.session);
    },

    check(value) {
      try {
        if (typeof value !== "string" || value.length > 300) return false;
        const parts = value.split(".");

        if (parts.length !== 5 || parts[0] !== VERSION) return false;
        const [, issued, id, accountId, signature] = parts as [string, string, string, string, string];

        if (!/^\d{1,16}$/.test(issued) || !/^[A-Za-z0-9_-]{1,200}$/.test(id) || !ACCOUNT_ID.test(accountId) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
        const expected = mac(options.key, `${issued}.${id}.${accountId}`);
        const given = Buffer.from(signature, "base64url");

        if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
        return live({ id, issuedAt: Number(issued), accountId });
      } catch {
        return false;
      }
    },

    get size() {
      return tickets.length;
    },

    dispose() {
      unsubscribe();
      tickets.length = 0;
    },
  };
}
