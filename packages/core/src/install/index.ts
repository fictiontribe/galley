/**
 * install — the hosted install: one server, one site, one data folder.
 * See docs/cloud-install.md.
 *
 *   openInstallState   the versioned state file (migrations, password, sessions, setup code)
 *   createInstall      first run and the one site, as one engine object
 *   createInstallRegistry / createSingleSiteRegistry   the registry narrowed to one site
 *   readStartingValues the unattended starting values (environment, GALLEY_INSTALL_CONFIG)
 *   createBackupStream / stageRestore   sealed backups of the data folder, and putting one back
 *   createStorageMeter "what is stored where", measured in the background
 */
export * from "./types";
export { openInstallState, mintSetupCode, sha256Hex, SITE_FOLDER, STATE_FILE, SESSION_LIFETIME_MS, type InstallSiteRecord, type InstallStateFile, type InstallStore, type OpenInstallStateOptions, type SessionStamp } from "./state";
export { MIGRATIONS, migrate, type Migration, type MigrationContext } from "./migrate";
export { hashPassword, verifyPassword, passwordProblem, SCRYPT_PARAMS, MAX_INSTALL_PASSWORD_LENGTH } from "./password";
export { normalizeRepository, redactAddress, deployKeyPage, tokenUserName, type RepositoryAddress } from "./address";
export { accessEnv, ensureDeployKey, readDeployKey, fingerprintOf, sshCommand, storeAccessToken, keysDir, KEYS_DIR } from "./access";
export { createSingleSiteRegistry, isSingleSiteRegistry, oneSiteOnly, ONE_SITE_MESSAGE, type SingleSiteRegistry } from "./single-site";
export { readStartingValues, APP_SECRET_ENV_NAMES, MIN_SETUP_TOKEN_LENGTH, type StartingSite, type StartingValues, type StartingValuesResult } from "./starting";
export { createInstall, createInstallRegistry, validFolder, type Install, type InstallOptions, type StartOptions, type StartResult } from "./install";
export { BACKUP_CHUNK_BYTES, BACKUP_FORMAT_VERSION, BACKUP_MAGIC, BACKUP_SCRYPT, BackupError, RESTORE_STAGING_PREFIX, RESTORE_UPLOADS, SERVER_LOCK_FILE, backupEntries, backupFileStream, checkEntries, createBackupStream, sealArchive, listArchive, openBackup, safeArchivePath, stageRestore, tarFlavour, writeBackupFile, type AppliedRestore, type ArchiveEntry, type BackupManifest, type BackupProblem, type BackupStream, type CreateBackupOptions, type OpenedBackup, type StagedRestore } from "./backup";
export { holdDataFolder, lockFile, serverHolding, type ServerLock } from "./lock";
export { createStorageMeter, STORAGE_MAX_AGE_MS, type StorageMeter } from "./storage";
export { rememberSecret, scrubLine, MIN_SCRUBBED_LENGTH } from "./secrets";
/** The install's own jobs (a restore) are tracked like every other job. */
export { createJobTracker } from "../site/jobs";
