/**
 * forms/ — the app's own form capture: the rules of the public capture
 * endpoint, the submission store, notifications, forwarding, and reading a
 * provider's existing form (docs/form-capture.md).
 */
export {
  CAPTURE_BODY_LIMIT,
  CAPTURE_KEY_HEADER,
  createFormCapture,
  FormCaptureService,
  INBOX_PAGE_MAX,
  type CaptureRequest,
  type CaptureResponse,
  type FormCaptureOptions,
  type InboxQuery,
} from "./capture";
export { csvCell, csvFileName, submissionsCsv, CSV_BOM } from "./csv";
export { asFormDefinition, capturesHere, listFormFiles, loadForm, FORMS_COLLECTION, type DefinitionSource, type FormFile, type LoadedForm } from "./definitions";
export {
  destinationPayload,
  forwardWithRetries,
  ForwarderRegistry,
  serverSideDestinations,
  webhookForwarder,
  withSecrets,
  DEFAULT_RETRY,
  type FormForwarder,
  type ForwardContext,
  type ForwardResult,
  type RetryPolicy,
} from "./forward";
export { createIdMinter, idTime, SUBMISSION_ID } from "./ids";
export { hubspotFields, introspectForm, marketoFields, INTROSPECTABLE_PROVIDERS } from "./introspect";
export { createSmtpTransport, labelledAnswers, mailConfigFromEnv, notificationMessage, type MailConfig, type MailMessage, type MailTransport } from "./mail";
export {
  checkTarget,
  createGuardedFetch,
  isPublicAddress,
  nodeTransport,
  OutboundRefused,
  systemResolver,
  type GuardedFetch,
  type GuardOptions,
  type OutboundRequest,
  type OutboundResponse,
  type ResolvedAddress,
  type Resolver,
  type Transport,
} from "./net";
export { campaignOf, storedPage, trimPageUrl } from "./page";
export { CaptureSettingsStore, defaultCaptureSettings, normaliseOrigin, type StoredCaptureSettings } from "./settings";
export { DEFAULT_RATE_LIMITS, DuplicateGuard, localSpamReason, RateLimiter, verifyTurnstile, TURNSTILE_VERIFY_URL, type RateLimits, type SpamReason } from "./spam";
export { checkFormId, checkSiteId, SubmissionStore } from "./store";
export { FREE_MAILBOXES, isLayoutField, ruleHolds, TICKED, validateSubmission, type Answer, type Answers, type ValidationOutcome } from "./validate";
