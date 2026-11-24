/**
 * `galley backup create` and `galley backup restore` — a hosted install's
 * backups, made and put back directly on its data folder (GALLEY_HOME) with
 * the server stopped: for a backup larger than a proxy lets through the
 * app's upload, and for disaster recovery.
 *
 * The file is the same sealed backup the Install page downloads (core
 * install/backup.ts). The passphrase comes from GALLEY_BACKUP_PASSPHRASE, or
 * is asked on a terminal without being shown; it never comes from an
 * argument, so it never shows up in a process list or a shell's history.
 *
 * Both refuse while a server holds the folder: `<home>/server.lock`, which a
 * hosted server writes when it starts and removes when it stops, naming a
 * process that is still alive on this machine (core install/lock.ts).
 */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import {
  BackupError,
  MIN_INSTALL_PASSWORD_LENGTH,
  openInstallState,
  serverHolding,
  stageRestore,
  STATE_FILE,
  writeBackupFile,
} from "@galley/core/install";
import { runGit } from "@galley/core/workspace";
import { defaultHome } from "@galley/server";
import { parse, UsageError } from "../args";
import type { Io } from "../io";

export const BACKUP_HELP = `Usage: ${PRODUCT.slug} backup create --out <file>
       ${PRODUCT.slug} backup restore <file>

Back up a hosted ${PRODUCT.name}'s data folder (GALLEY_HOME), or put a backup
back in its place, with the server stopped. The file is the same one the app's
Install page downloads: the site with its history and unpublished changes, the
settings, the keys and the sign-in, sealed with a passphrase.

Options
      --out <file>          Where to write the backup (create). Inside the data
                            folder, use its backups/ folder: it is never part of
                            a backup and a restore leaves it alone
      --home <folder>       The data folder (default GALLEY_HOME)
      --force               Go ahead though a lock file says a server on another
                            machine uses the folder (only when you know it is stopped)
  -h, --help                Show this help

The passphrase is read from GALLEY_BACKUP_PASSPHRASE, or asked for (not shown as
you type it). It needs at least ${MIN_INSTALL_PASSWORD_LENGTH} characters. Without it the backup can't be
opened: keep it somewhere safe.

After a restore everyone is signed out; sign in with the password the backup was
made with.`;

const posix = (from: string, to: string) => relative(from, to).split(sep).join("/");

async function passphraseFor(io: Io, purpose: "create" | "restore"): Promise<string> {
  const given = io.env.GALLEY_BACKUP_PASSPHRASE;

  if (given) return given;
  const asked = io.askSecret ? await io.askSecret(purpose === "create" ? "Passphrase for the backup: " : "The backup's passphrase: ") : null;

  if (asked === null) {
    throw new UsageError(`Give the passphrase in GALLEY_BACKUP_PASSPHRASE, or run this on a terminal to be asked for it.`);
  }
  if (purpose === "create") {
    const again = io.askSecret ? await io.askSecret("The same passphrase again: ") : null;

    if (again !== asked) throw new UsageError("The two passphrases aren't the same. Run this again.");
  }
  return asked;
}

/** Refuses while a server holds `home`, saying how that was told. */
async function refuseWhileServed(home: string, force: boolean): Promise<void> {
  const holder = await serverHolding(home);

  if (!holder) return;
  const where = holder.port ? `, port ${holder.port}` : "";

  if (holder.hostname !== (await import("node:os")).hostname()) {
    if (force) return;
    throw new UsageError(
      `${join(home, "server.lock")} says a server on ${holder.hostname} (process ${holder.pid}${where}) uses this data folder. Stop it first. If it is stopped already (it didn't shut down cleanly), run this again with --force.`
    );
  }
  throw new UsageError(`A server is using this data folder right now (process ${holder.pid}${where}). Stop it first, then run this again.`);
}

/** The site's folders as the install's state records them: the checkout, and the folder in it that holds the site. */
function siteFolders(home: string): { checkout: string; siteFolder: string } {
  try {
    const state = JSON.parse(readFileSync(join(home, STATE_FILE), "utf8")) as { site?: { root?: string; folder?: string | null } | null };
    const checkout = typeof state.site?.root === "string" ? state.site.root : "site";
    const siteFolder = state.site?.folder ? `${checkout}/${state.site.folder}` : checkout;

    return { checkout, siteFolder };
  } catch {
    return { checkout: "site", siteFolder: "site" };
  }
}

async function create(io: Io, home: string, out: string | undefined, force: boolean): Promise<number> {
  if (!out) throw new UsageError(`Say where to write the backup: \`${PRODUCT.slug} backup create --out <file>\`.`);
  if (!existsSync(join(home, STATE_FILE))) throw new UsageError(`${home} isn't a hosted ${PRODUCT.name}'s data folder (it has no ${STATE_FILE}). Set GALLEY_HOME, or give --home.`);
  const file = resolve(io.cwd, out);

  if (existsSync(file)) throw new UsageError(`${file} exists already. Choose another file name.`);
  // The first backup into the data folder's own backups/ folder (a container whose only writable place is the data folder) makes it.
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await refuseWhileServed(home, force);
  const passphrase = await passphraseFor(io, "create");

  if ([...passphrase].length < MIN_INSTALL_PASSWORD_LENGTH) throw new UsageError(`The passphrase needs at least ${MIN_INSTALL_PASSWORD_LENGTH} characters.`);
  const { checkout, siteFolder } = siteFolders(home);
  const root = join(home, ...checkout.split("/"));

  await writeBackupFile({
    home,
    passphrase,
    file,
    checkout,
    siteFolder,
    tracked: async (dir) => {
      const result = await runGit(root, ["ls-files", "-z", "--", posix(root, join(home, ...dir.split("/")))], { allowFailure: true, readOnly: true });

      return result.code === 0 && result.text.length > 0;
    },
  });
  const megabytes = statSync(file).size / (1024 * 1024);

  io.out(`Backup written to ${file} (${megabytes < 0.1 ? "under 0.1" : megabytes.toFixed(1)} MB).`);
  io.out("Keep the passphrase somewhere safe: without it the backup can't be opened.");
  return 0;
}

async function restore(io: Io, home: string, input: string | undefined, force: boolean): Promise<number> {
  if (!input) throw new UsageError(`Say which backup to put back: \`${PRODUCT.slug} backup restore <file>\`.`);
  const file = resolve(io.cwd, input);

  if (!existsSync(file)) throw new UsageError(`There's no file at ${file}.`);
  await refuseWhileServed(home, force);
  const passphrase = await passphraseFor(io, "restore");
  let staged;

  try {
    staged = await stageRestore({ home, source: createReadStream(file), passphrase });
  } catch (error) {
    if (error instanceof BackupError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
  try {
    const applied = await staged.apply();

    try {
      // The state as the restored install left it, migrated like a start would, with everyone signed out.
      const store = await openInstallState(home);

      await store.signOutEverywhere();
      await applied.commit();
    } catch (error) {
      await applied.rollback();
      throw error;
    }
  } finally {
    await staged.discard();
  }
  io.out(`Restored the backup made ${staged.manifest.createdAt} (by version ${staged.manifest.version}) into ${home}.`);
  io.out("Everyone is signed out: sign in with the password the backup was made with.");
  return 0;
}

export async function backupCommand(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parse("backup", argv, { out: { type: "string", short: "o" }, home: { type: "string" }, force: { type: "boolean" } }, 2);
  const [action, target] = positionals;

  if (values.help || !action) {
    io.out(BACKUP_HELP);
    return values.help ? 0 : 2;
  }
  const home = resolve(io.cwd, values.home ?? defaultHome(io.env));

  if (action === "create") {
    if (target !== undefined) throw new UsageError(`\`${PRODUCT.slug} backup create\` takes no file name of its own: use --out <file>.`);
    return create(io, home, values.out, values.force === true);
  }
  if (action === "restore") return restore(io, home, target, values.force === true);
  throw new UsageError(`“${action}” isn't something backup does. Use \`${PRODUCT.slug} backup create\` or \`${PRODUCT.slug} backup restore\`.`);
}
