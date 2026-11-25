/**
 * Embedding the editor: a program that starts this server can add API
 * routes of its own when it is built. Experimental (types.ts).
 *
 *   import { startServer } from "@galley/server";
 *   import { defineExtension, invalid } from "@galley/server/extensions";
 *
 *   const status = defineExtension({ id: "status", setup: () => ({ routes: { … } }) });
 *   await startServer({ mode: "hosted", extensions: [status] });
 */
export { defineExtension, ExtensionError, EXTENSION_BODY_LIMIT, EXTENSION_EVENT_BYTES, EXTENSION_EVENT_BYTES_A_SECOND, EXTENSION_EVENTS_A_SECOND, EXTENSION_PREFIX, STREAM_REFUSED } from "./declare";
export { forbidden, invalid, notFound } from "../errors";
export type { ExtensionAccess, ExtensionCaller, ExtensionEventRule, ExtensionEvents, ExtensionHost, ExtensionStream, ExtensionParts, ExtensionPeople, ExtensionRequest, ExtensionRoute, GuardedSite, JsonValue, ServerExtension, SessionRef } from "./types";
