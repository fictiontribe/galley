/**
 * A hosted install's operations, as the routes use them (install-routes.ts):
 * readiness, the Install page, backups, uploads and restores.
 *
 * A restore runs as a job (kind "restore"): the uploaded file is opened and
 * checked into a staging folder first — a wrong passphrase or a damaged file
 * changes nothing and says which it was — then readiness says "restoring",
 * the preview stops, the site closes, the current state moves aside and the
 * restored state moves in, the state is read (and migrated) again and the
 * site reopened. Any failure puts the previous state back. Afterwards every
 * session is signed out (the restored install's password rules), so the
 * browser that started it is let ask how the job ended for a while by what
 * it presented when it started it (app.ts).
 */
import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GalleyError } from "@galley/core";
import { PRODUCT } from "@galley/core/brand";
import {
  BackupError,
  createBackupStream,
  createJobTracker,
  createStorageMeter,
  MIN_INSTALL_PASSWORD_LENGTH,
  RESTORE_UPLOADS,
  stageRestore,
  type Install,
  type InstallInfo,
  type ReadyStatus,
  type RestoreUpload,
} from "@galley/core/install";
import { runGit } from "@galley/core/workspace";
import type { EventBus, Job } from "@galley/core/types";
import type { ServerLog } from "./log";

/** How long the browser (or setup code) that started a restore may still ask about it after it ended. */
export const RESTORE_GRANT_MS = 10 * 60_000;
/** An upload not restored within this long is removed. */
const UPLOAD_MAX_AGE_MS = 60 * 60_000;
/** Uploads kept at once: the newest; the rest are removed. */
const UPLOADS_KEPT = 2;

export type ServerPhase = "starting" | "running" | "restoring";

/** Thrown for an upload over the cap: answered 413 with the sentence. */
export class TooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TooLargeError";
  }
}

export interface InstallOps {
  readiness(): ReadyStatus;
  restoring(): boolean;
  /** The Install page, for this person (`passwordChangedAt` is theirs). */
  info(accountId?: string): Promise<InstallInfo>;
  /** A sealed backup, streamed: the one answer that carries the install's secrets, and it carries them sealed. */
  backup(passphrase: string): Promise<{ body: ReadableStream<Uint8Array>; filename: string }>;
  upload(body: ReadableStream<Uint8Array> | null, declaredBytes: number | null): Promise<RestoreUpload>;
  restore(input: { upload: string; passphrase: string }, credentials: string[]): Promise<Job>;
  /** A restore job, to whoever presented one of the credentials that started it (for a while after it ended). */
  grantedJob(id: string, credentials: string[]): Job | null;
  job(id: string): Job | null;
  readonly restoreMaxBytes: number;
  /** Stops measuring the data folder (the server is closing): a walk in progress lets go at once. */
  stopMeasuring(): Promise<void>;
  dispose(): void;
}

export interface InstallOpsOptions {
  install: Install;
  events: EventBus;
  version: string;
  /** The address people use. */
  address: string;
  previews: { preview: string; live: string } | null;
  /** The cookie key in use: its bytes are replaced in place by a restore, so every signature made with the old one stops counting at once. */
  cookieKey: Uint8Array;
  /** Reads the session key from the data folder (after a restore put another there). */
  readCookieKey: () => Promise<Uint8Array>;
  log: ServerLog;
  restoreMaxBytes: number;
  phase: { get(): ServerPhase; set(phase: ServerPhase): void };
}

function slugOf(name: string | null | undefined): string {
  const slug = (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "");

  return slug || PRODUCT.slug;
}

const posixRelative = (from: string, to: string) => relative(from, to).split(sep).join("/");

export function createInstallOps(options: InstallOpsOptions): InstallOps {
  const { install, log } = options;
  const home = install.home;
  const store = install.store;
  const uploads = join(home, RESTORE_UPLOADS);
  const jobs = createJobTracker(options.events);
  const grants = new Map<string, { credentials: Set<string>; until: number | null }>();
  const meter = createStorageMeter(home);
  let restoring = false;

  function siteRoot(): string {
    return store.read().site?.root ?? "site";
  }

  async function pruneUploads(keep: number): Promise<void> {
    const names = await readdir(uploads).catch(() => [] as string[]);
    const files = await Promise.all(names.map(async (name) => ({ name, at: (await stat(join(uploads, name)).catch(() => null))?.mtimeMs ?? 0 })));
    const sorted = files.sort((a, b) => b.at - a.at);

    for (const [index, file] of sorted.entries()) {
      if (index >= keep || Date.now() - file.at > UPLOAD_MAX_AGE_MS) await rm(join(uploads, file.name), { force: true });
    }
  }

  async function runRestore(job: ReturnType<typeof jobs.start>, file: string, passphrase: string): Promise<void> {
    let staged: Awaited<ReturnType<typeof stageRestore>> | null = null;

    try {
      job.update({ detail: "Opening and checking the backup", progress: 0.05 });
      staged = await stageRestore({ home, source: createReadStream(file), passphrase });
      job.update({ detail: "Stopping the preview and closing the site", progress: 0.6 });
      restoring = true;
      options.phase.set("restoring");
      await install.idle();
      await install.closeSite();
      job.update({ detail: "Putting the backup in place", progress: 0.75 });
      const applied = await staged.apply();
      const previousKey = Buffer.from(options.cookieKey);

      try {
        await install.reload();
        // The restored install's own key from here on: no cookie this server signed before the restore counts.
        options.cookieKey.set(await options.readCookieKey());
        await store.signOutEverywhere();
        await applied.commit();
      } catch (error) {
        await applied.rollback();
        options.cookieKey.set(previousKey);
        await install.reload().catch((reloadError: unknown) => log.log(`After a failed restore, the previous state couldn't be read again: ${reloadError instanceof Error ? reloadError.message : String(reloadError)}`));
        throw error;
      }
      await rm(file, { force: true });
      log.event(`A backup was restored (it was made ${staged.manifest.createdAt}, by version ${staged.manifest.version}). Everyone was signed out.`);
      job.finish("done", { progress: 1, detail: "The backup is back in place. Everyone signs in again, with the accounts and passwords the backup was made with." });
    } catch (error) {
      const message =
        error instanceof BackupError || (error instanceof GalleyError && error.code !== "internal")
          ? error.message
          : "The backup couldn't be put back because of an unexpected problem, so the editor was left as it was. Try again.";

      if (!(error instanceof BackupError)) log.log(`A restore failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      else log.event(`A restore was refused: ${error.problem}.`);
      job.finish("error", { detail: message });
    } finally {
      await staged?.discard().catch(() => undefined);
      restoring = false;
      options.phase.set("running");
      const grant = grants.get(job.id);

      if (grant) grant.until = Date.now() + RESTORE_GRANT_MS;
    }
  }

  return {
    readiness() {
      const phase = options.phase.get();

      if (phase === "starting") return { ready: false, state: "starting" };
      if (phase === "restoring" || restoring) return { ready: false, state: "restoring" };
      return install.setupNeeded() ? { ready: true, state: "setup" } : { ready: true, state: "ready" };
    },

    restoring: () => restoring,

    async info(accountId) {
      const state = store.read();
      const account = accountId === undefined ? undefined : state.accounts.find((candidate) => candidate.id === accountId);
      const status = await install.status();

      return {
        version: options.version,
        schema: state.schema,
        createdAt: state.createdAt,
        address: options.address,
        previewAddress: options.previews?.preview ?? null,
        liveAddress: options.previews?.live ?? null,
        site: status.site,
        author: status.author,
        dataFolder: home,
        storage: meter.lines(siteRoot(), install.siteId()),
        passwordChangedAt: account?.passwordChangedAt ?? null,
        lastBackupAt: state.lastBackupAt,
        fixed: status.fixed,
      };
    },

    async backup(passphrase) {
      if ([...passphrase].length < MIN_INSTALL_PASSWORD_LENGTH) {
        throw new GalleyError("invalid", `The passphrase needs at least ${MIN_INSTALL_PASSWORD_LENGTH} characters. Keep it somewhere safe: without it the backup can't be opened.`);
      }
      if (restoring) throw new GalleyError("busy", "A backup is being put back right now. Wait for that to finish.");
      const checkout = siteRoot();
      const site = await install.site().catch(() => null);
      const backup = await createBackupStream({
        home,
        passphrase,
        checkout,
        siteFolder: posixRelative(home, store.siteFolder()),
        // Build output the repository tracks is part of the site, so it is kept.
        tracked: async (dir) => {
          const result = await runGit(join(home, ...checkout.split("/")), ["ls-files", "-z", "--", posixRelative(join(home, ...checkout.split("/")), join(home, ...dir.split("/")))], { allowFailure: true, readOnly: true });

          return result.code === 0 && result.text.length > 0;
        },
      });

      backup.done.then(
        async () => {
          await store.setLastBackupAt(new Date());
          log.event("A backup was made and downloaded.");
        },
        (error: unknown) => log.event(`A backup didn't finish: ${error instanceof Error ? error.message : String(error)}`)
      );
      const day = new Date().toISOString().slice(0, 10);

      return { body: Readable.toWeb(backup.stream) as ReadableStream<Uint8Array>, filename: `${slugOf(site?.name)}-backup-${day}.bak` };
    },

    async upload(body, declaredBytes) {
      const max = options.restoreMaxBytes;
      const tooLarge = `That backup is larger than this editor accepts (${Math.round(max / (1024 * 1024))} MB). Restore it with \`${PRODUCT.slug} backup restore\` on the server instead, or ask whoever runs it to raise GALLEY_RESTORE_MAX_MB.`;

      if (declaredBytes !== null && declaredBytes > max) throw new TooLargeError(tooLarge);
      if (!body) throw new GalleyError("invalid", "Send the backup file as the request's body.");
      if (restoring) throw new GalleyError("busy", "A backup is being put back right now. Wait for that to finish.");
      await mkdir(uploads, { recursive: true, mode: 0o700 });
      await pruneUploads(UPLOADS_KEPT - 1);
      const id = randomBytes(12).toString("hex");
      const file = join(uploads, `${id}.bak`);
      let bytes = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          callback(bytes > max ? new TooLargeError(tooLarge) : null, chunk);
        },
      });

      try {
        await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>), counter, createWriteStream(file, { mode: 0o600 }));
      } catch (error) {
        await rm(file, { force: true });
        if (error instanceof TooLargeError) throw error;
        throw new GalleyError("invalid", "The backup didn't arrive whole. Try the upload again.");
      }
      if (bytes === 0) {
        await rm(file, { force: true });
        throw new GalleyError("invalid", "That file is empty. Choose the backup file and try again.");
      }
      return { id, bytes };
    },

    async restore(input, credentials) {
      if (!/^[0-9a-f]{24}$/.test(input.upload)) throw new GalleyError("not-found", "That upload isn't here any more. Upload the backup again.");
      const file = join(uploads, `${input.upload}.bak`);

      if (!(await stat(file).then((info) => info.isFile(), () => false))) throw new GalleyError("not-found", "That upload isn't here any more. Upload the backup again.");
      if (restoring || [...grants.keys()].some((id) => jobs.get(id)?.state === "running")) throw new GalleyError("busy", "A backup is being put back right now. Wait for that to finish.");
      if ((await install.site()).state === "connecting") throw new GalleyError("busy", "The site is being connected right now. Wait for that to finish, then restore the backup.");
      const job = jobs.start("restore", "Putting a backup back");

      grants.set(job.id, { credentials: new Set(credentials), until: null });
      void runRestore(job, file, input.passphrase);
      return job.snapshot();
    },

    grantedJob(id, credentials) {
      const grant = grants.get(id);

      if (!grant) return null;
      if (grant.until !== null && grant.until < Date.now()) {
        grants.delete(id);
        return null;
      }
      return credentials.some((credential) => grant.credentials.has(credential)) ? jobs.get(id) : null;
    },

    job: (id) => jobs.get(id),
    restoreMaxBytes: options.restoreMaxBytes,
    stopMeasuring: () => meter.close(),
    dispose() {
      void meter.close();
      jobs.dispose();
      grants.clear();
    },
  };
}
