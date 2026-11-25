/**
 * What an addition leans on: `@galley/web/additions`. Experimental
 * (types.ts). Everything in the web app that is not exported from `./app`,
 * `./additions` and `./ui` may change at any time.
 *
 *   import { App } from "@galley/web/app";
 *   import { extensionApi, type Addition } from "@galley/web/additions";
 *
 *   const status: Addition = { id: "status", topBar: Waiting };
 *   createRoot(root).render(<App additions={[status]} />);
 *
 * The page it is rendered into starts from the app's own `index.html`.
 */
export type { Addition, AdditionPlace } from "./types";
export { extensionApi, extensionUrl, type ExtensionApi, type ExtensionQuery } from "./client";
export { useAccount, useRoleMay, useSiteId } from "./hooks";
export { SafeMarkdown, SafeText } from "./SafeText";
export { onReconnect, setStreamValue, subscribeExtension, STREAM_REOPEN_MS, STREAM_VALUE_MS } from "@/lib/events";
export { ApiFailure, isApiFailure } from "@/lib/api";
