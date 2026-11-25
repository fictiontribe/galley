/**
 * workspace — the checkout: guarded files, git, the change set and diffs,
 * publish/history/undo, checkpoints, preview proxies, build, media, watcher,
 * and getting a site onto the machine. See docs/ARCHITECTURE.md §3.2.
 */
export { CHANGED_SINCE_OPENED, createWorkspace, NEUTRAL_AUTHOR } from "./workspace";
export { chooseAuthor, currentAccountAuthor, withAccountAuthor, withoutAccountAuthor, DEFAULT_AUTHOR, type AuthorLayers, type AuthorSource, type ChosenAuthor } from "./author";
export type { Workspace, WorkspaceOptions, WorkspaceWriteOptions } from "./workspace";
export type { ChangeEnricher, PendingStatus } from "./changes";
export { classifyKind, computeHunks, defaultSummary, parsePorcelain, MAX_DIFF_BYTES } from "./changes";
export type { WorkspaceCheckpoint } from "./checkpoint";
export { SPILL_BYTES } from "./checkpoint";

export { createPreviewController, detectPid, detectPort, expandOutputLine, HELD_DETAIL } from "./preview/controller";
export type { PreviewOptions, PreviewSettings, PreviewControllerHandle } from "./preview/controller";
export {
  injectIntoHtml,
  overlayTagWithStatus,
  stripFrameAncestors,
  rewriteLocation,
  OVERLAY_TAG,
  isAppCookie,
  viewerCookieName,
  withoutAppCookies,
  startPreviewProxy,
  startBaselineProxy,
} from "./preview/proxy";
export type { PreviewGateway, ProxyHandlers } from "./preview/proxy";
export { createPortPool, parsePortRange, freePort, portIsFree } from "./preview/ports";
export type { PortPool, PortRange } from "./preview/ports";
export { portOwnership, type Ownership } from "./preview/owner";
export { forgetPreviewSaves } from "./preview/saves";

export { runBuild, installDependencies, detectPackageManager } from "./build";
export { AGENT_ENV_NAMES, AGENT_ENV_PREFIXES, hideFromSiteCommands, limitSiteCommandMemory, isAgentMarker, parseCommand, resolveCommand, withoutAgentMarkers, withoutHiddenVariables } from "./command";
export { listMedia, saveMedia, sanitizeMediaName, isMediaFile, MAX_UPLOAD_BYTES } from "./media";
export { cloneRepository, scaffoldFromStarter, isGitRepository, parseCloneProgress, packageName } from "./scaffold";

export { git, runGit, registerGitAccess, GitCommandError } from "./git";
export type { Git, GitResult, GitRunOptions, RepoInfo } from "./git";
export { hashContent, isBinary } from "./files";
export { normalizeRepoPath } from "./paths";
export { deniedReason, isSecretsFile, writeRefusal } from "./policy";
export { compareUrl, parseRemoteUrl, redactRemoteUrl, classifyPushError } from "./remote";
export type { Identity } from "./publish";
