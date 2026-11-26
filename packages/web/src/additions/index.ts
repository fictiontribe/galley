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
export type { Addition, AdditionPlace, BodyAdditionProps } from "./types";
export { extensionApi, extensionUrl, type ExtensionApi, type ExtensionQuery } from "./client";
export { useAccount, useRoleMay, useSiteId } from "./hooks";
export { SafeMarkdown, SafeText } from "./SafeText";
export { onReconnect, setStreamValue, subscribeExtension, STREAM_REOPEN_MS, STREAM_VALUE_MS, useConnection, useServerEvent } from "@/lib/events";
export { ApiFailure, isApiFailure } from "@/lib/api";
export { useChanges } from "@/lib/stores/changes";
export { useSite } from "@/lib/stores/site";
export { notify } from "@/lib/stores/toasts";
export { pathKey } from "@/features/content/form/paths";
export type { FormStore, FormStoreEvent } from "@/features/content/form/store";
