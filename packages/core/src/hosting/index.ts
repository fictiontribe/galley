/**
 * hosting — "Host the editor online": creating a hosted install for one site
 * on the person's own account with a host (Fly.io, Google Cloud, Cloudflare in
 * front of a computer of yours, any server with Docker, or one a plugin registers).
 * See docs/cloud-install.md.
 */
export * from "./types";
export { addressProblem, defaultEditorName, deriveAddresses, depthBelow, EDITOR_NAME, editorNameProblem, MAX_EDITOR_NAME, normalizeAddress, resolveAddresses } from "./addresses";
export { CADDY_IMAGE, CLOUDFLARED_IMAGE, defaultImage, IMAGE_REFERENCE, INSTALL_PORT, installEnvironment, RECIPE_PROXIES, recipeFiles, SHARED_PROXY_NETWORK } from "./recipe";
export type { RecipeInput, RecipeProxy } from "./recipe";
export { HostingError, scrubHostingError, scrubText, secretParts, shapeForHttp } from "./errors";
export type { HostingReason } from "./errors";
export { createHostingService, PLAN_TTL_MS, repositoryAddress } from "./service";
export type { HostingService, HostingServiceOptions } from "./service";
export { BUILT_IN_EDITOR_HOSTS, builtInEditorHosts, EDITOR_HOSTS_ABSENT, registerEditorHost } from "./registry";
export { createFlyHost, FLY_API, FLY_DEFAULT_REGION, FLY_REGIONS, flyCost, volumeName } from "./fly";
export { createGcpHost, GCP_DEFAULT_REGION, GCP_DISK_GB, GCP_FOLDER, GCP_IMAGE, GCP_LABEL, GCP_SIZES, gcpCost, gcpNames, gcpRecipeFiles, gcpStartupScript, regionName } from "./gcp";
export type { GcpSize } from "./gcp";
export { GCP_APIS, GCP_PERMISSIONS, GCP_ROLES, normalizeServiceAccountKey, parseServiceAccountKey, serviceAccountKeyHint } from "./gcp-api";
export { CLOUDFLARE_COST, createCloudflareEditorHost } from "./cloudflare";
export { CLOUDFLARE_API, gapSentence } from "./cloudflare-api";
export { createOwnServerHost, OWN_SERVER_COST } from "./own-server";
export { recordComment, TAG_KEY } from "./tag";
export { recordPath, setupCodePath } from "./record";
