/**
 * @galley/server — the engine behind an HTTP API, live events, and the web UI.
 *
 *   createApp     the Hono app (pure, testable with app.request())
 *   startServer   resolve options, bind, compose the engine, serve
 */
export { createApp, uiContentSecurityPolicy, BODY_LIMIT_BYTES } from "./app";
export { startServer, resolveConfig, StartupError, DEFAULT_PORT, MIN_PASSWORD_LENGTH, type ResolvedConfig } from "./server";
export { loadBrand } from "./brand";
export { openSingleSite } from "./single-site";
export { createPluginSystem, firstPartyPlugins, type PluginSystemOptions } from "./plugins";
export type { SingleSiteEngine, SingleSiteOptions } from "./compose";
export { createMcpMount, type McpMount, type McpMountOptions } from "./mcp";
export { looksLikeSite, SITE_MARKERS } from "./fs-list";
export { createStreamRegistry } from "./events";
export { stamped } from "./log";
export { defaultHome, defaultStartersDir, defaultWebDir, BUNDLED } from "./paths";
export type { AppOptions, RunningServer, ServerMode, ServerOptions, Services, StreamRegistry } from "./types";
