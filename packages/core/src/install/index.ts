/**
 * install — the hosted install: one server, one site, one data folder.
 * See docs/cloud-install.md.
 *
 *   accounts.ts / route-access.ts   the people who may sign in, and which role may call which route
 *   openInstallState   the versioned state file (migrations, accounts, sessions, setup code)
 *   createPeople       the people on it: sign-in, invitations, roles, one-time links (people.ts)
 *   createInstall      first run and the one site, as one engine object
 *   createInstallRegistry / createSingleSiteRegistry   the registry narrowed to one site
 *   readStartingValues the unattended starting values (environment, GALLEY_INSTALL_CONFIG)
 *   createBackupStream / stageRestore   sealed backups of the data folder, and putting one back
 *   createStorageMeter "what is stored where", measured in the background
 */
export * from "./types";
export * from "./accounts";
export { BUILD_MODE_LEVEL, PREVIEW_INITIATED_HEADER, SITE_SETTINGS_LEVEL, SITE_METHOD_ACCESS, SITE_SETTINGS_RECORDS, ROUTE_ACCESS, ROLE_REFUSAL, levelFor, roleMayCall, siteMethodLevel, type GuardedSiteMethod, type RouteAccess } from "./route-access";
export { BUILD_MODE_REFUSAL, NAME_NEEDED, NAME_NEEDED_REFUSAL, NO_CALLER_REFUSAL, OUTLIVED_REFUSAL, SIGN_IN_ENDED_REFUSAL, SITE_SETTINGS_REFUSAL, asEngine, asOperator, callerMay, callerRefusal, callerViaPreview, currentCaller, guardedWorkNeedsCaller, isSiteSettingsPath, outsideAnyPerson, requireBuildMode, requireName, requireCallerForGuardedWork, requireLevel, requireSiteSettings, withCaller, type Caller } from "./caller";
export { saveFailure, type StateFiles } from "./state";
export { openInstallState, mintSetupCode, sha256Hex, hasOwner, spendSetupCode, signsInWithPassword, SITE_FOLDER, STATE_FILE, SESSION_LIFETIME_MS, REVOKED_SESSIONS_KEPT, TOMBSTONES_KEPT, PROVIDER_LOGOUTS_KEPT, PROVIDER_LOGOUT_KEPT_MS, type InstallSiteRecord, type InstallStateFile, type InstallStore, type OpenInstallStateOptions, type SessionStamp, type StoredAccount, type StoredLink, type StoredProviderLogout, type StoredTombstone } from "./state";
export { createPeople, publicAccount, normalizeEmail, cleanName, ASK_ANOTHER_OWNER, LAST_OWNER, LINK_REFUSED, EMAIL_LIMIT, NAME_LIMIT, OWN_EMAIL_REFUSAL, WRONG_CURRENT_PASSWORD, NO_PASSWORD_TO_CHANGE, NO_PASSWORD_FOR_EMAIL, ACCOUNTS_KEPT, NO_PASSWORD_FOR_PROVIDER_ACCOUNT, PASSWORDS_OFF, type RescueTarget, TOKEN_ONLY_SWITCHES_OFF, TOKEN_DELETES_ONLY_SWITCHED_OFF, REMOVED_LIST_FULL, type ProviderSignIn, type ProviderSignInRefusal, type ProviderSignInResult, type MadeLink, type PeopleService, type PeopleOptions, type SignInResult } from "./people";
export { invitationEmail, passwordLinkEmail } from "./account-mail";
export { MIGRATIONS, migrate, type Migration, type MigrationContext } from "./migrate";
export { hashPassword, verifyPassword, passwordProblem, SCRYPT_PARAMS, MAX_INSTALL_PASSWORD_LENGTH } from "./password";
export { normalizeRepository, redactAddress, deployKeyPage, tokenUserName, type RepositoryAddress } from "./address";
export { accessEnv, ensureDeployKey, readDeployKey, fingerprintOf, sshCommand, storeAccessToken, keysDir, KEYS_DIR } from "./access";
export { createSingleSiteRegistry, isSingleSiteRegistry, oneSiteOnly, ONE_SITE_MESSAGE, type SingleSiteRegistry } from "./single-site";
export { readStartingValues, APP_SECRET_ENV_NAMES, MIN_SETUP_TOKEN_LENGTH, type StartingSite, type StartingValues, type StartingValuesResult } from "./starting";
export { createInstall, createInstallRegistry, validFolder, type Install, type InstallOptions, type StartOptions, type StartResult } from "./install";
export { BACKUP_CHUNK_BYTES, BACKUP_FORMAT_VERSION, BACKUP_MAGIC, BACKUP_SCRYPT, BackupError, RESTORE_STAGING_PREFIX, RESTORE_UPLOADS, SERVER_LOCK_FILE, backupEntries, backupFileStream, checkEntries, createBackupStream, sealArchive, listArchive, openBackup, safeArchivePath, stageRestore, tarFlavour, writeBackupFile, type AppliedRestore, type ArchiveEntry, type BackupManifest, type BackupProblem, type BackupStream, type CreateBackupOptions, type OpenedBackup, type StagedRestore } from "./backup";
export { HOLD_BEAT_MS, holdDataFolder, lockFile, serverHolding, type DataFolderHold, type HoldOptions, type ServerLock } from "./lock";
export { createStorageMeter, STORAGE_MAX_AGE_MS, type StorageMeter } from "./storage";
export { rememberSecret, scrubLine, MIN_SCRUBBED_LENGTH } from "./secrets";
/** The install's own jobs (a restore) are tracked like every other job. */
export { createJobTracker } from "../site/jobs";
