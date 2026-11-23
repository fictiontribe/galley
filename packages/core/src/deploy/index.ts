/**
 * deploy — putting a site online with a host (Cloudflare, Vercel, or one a
 * plugin registers). See docs/deploy.md.
 */
export { createDeployService, deployMessage } from "./service";
export type { DeployService, DeployServiceOptions, StartOptions } from "./service";
export { createCloudflareTarget, CLOUDFLARE_API, CLOUDFLARE_MODULE, CLOUDFLARE_MODULE_NAME, CLOUDFLARE_COMPATIBILITY_DATE } from "./cloudflare";
export { createVercelTarget, VERCEL_API, VERCEL_PERSONAL } from "./vercel";
export { builtInTargets, registerDeployTarget } from "./registry";
export { collectFiles, cloudflareHash, contentTypeFor, eachLimited, formatBytes, sha1 } from "./files";
export type { DeployFile, DeployLimits } from "./files";
export { DeployError, scrub, scrubError, shapeForHttp } from "./errors";
export type { DeployReason } from "./errors";
export { appendDeployment, readDeployments } from "./history";
export { buildForDeploy, publishedCommit, versionsBetween } from "./source";
export { defaultProjectName, projectNameProblem, VALID_PROJECT, CLOUDFLARE_INFO, CLOUDFLARE_CREDENTIALS, VERCEL_INFO, VERCEL_CREDENTIALS } from "./info";
export type { DeployContext, DeployInput, DeployOutcome, DeployProgress, DeployTarget } from "./types";
