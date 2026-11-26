/**
 * `galley accounts` — who signs in as whom on a hosted install, changed on
 * the server with the server stopped:
 *
 * - `list`: every account, with its id, role, and how it signs in;
 * - `link`: binds accounts to their subjects at the identity provider
 *   (GALLEY_OIDC_ISSUER), one pair or a file of them. Each account loses its
 *   password and open password links, and every session of it ends; from
 *   then on it signs in through the provider. `--replace` puts a wrong link
 *   right. Two accounts are never merged.
 * - `rekey`: moves every identity and removed account from one issuer to
 *   another, in one write, when the provider's issuer changes.
 *
 * Each refuses while a server holds the data folder: a second writer of the
 * install's state while the server runs would race its own writes. Whoever
 * can run this has a shell on the server, which can read the session key
 * already: it adds nothing such a person lacks.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import { createPeople, openInstallState, ROLE_NAMES, STATE_FILE, type InstallStore, type PeopleService } from "@galley/core/install";
import { isGalleyError } from "@galley/core";
import { defaultHome } from "@galley/server";
import { parse, UsageError } from "../args";
import type { Io } from "../io";
import { refuseWhileServed } from "./backup";

export const ACCOUNTS_HELP = `Usage: ${PRODUCT.slug} accounts list
       ${PRODUCT.slug} accounts link <account id> <subject> [--replace]
       ${PRODUCT.slug} accounts link --file <pairs>
       ${PRODUCT.slug} accounts rekey --from <issuer> --to <issuer>
       ${PRODUCT.slug} accounts removed
       ${PRODUCT.slug} accounts unremove <subject>

Change who signs in as whom on a hosted ${PRODUCT.name}, on the server, with the
server stopped.

  list      Every account: its id, role, whether it is switched off, and how it
            signs in (its subject at the identity provider, or its e-mail).
  link      Bind an account to its subject at the identity provider that
            GALLEY_OIDC_ISSUER names. The account loses its password and any
            open new-password link, every session of it ends, and from then on
            it signs in through the provider. A subject that has an account of
            its own here, or was removed, is refused: two accounts are never
            merged. A file of pairs has one "<account id> <subject>" a line.
  rekey     The provider's issuer changed: move every account and removed
            account from the old issuer to the new one, in one write, or none
            if one would meet the same subject under the new issuer.
  removed   The removed accounts that signed in through the provider, which
            can't sign in or be linked again: subject, issuer, when, by whom.
  unremove  Take a subject at GALLEY_OIDC_ISSUER off that list: it may sign
            in again (as a new account) or be linked. What the removal ended
            stays ended.

An account id or a subject that starts with "-" goes after --, so it isn't
read as an option: ${PRODUCT.slug} accounts link -- <account id> <subject>.

Options
      --replace             With link: bind this subject in place of the one the
                            account has (to put a wrong link right)
      --file <pairs>        With link: a file of "<account id> <subject>" lines
      --from <issuer>       With rekey: the old issuer, exactly as it was set
      --to <issuer>         With rekey: the new issuer, exactly as GALLEY_OIDC_ISSUER
      --home <folder>       The data folder (default GALLEY_HOME)
      --force               Go ahead though a lock file says a server on another
                            machine uses the folder (only when you know it is stopped)
  -h, --help                Show this help`;

async function openPeople(home: string): Promise<{ store: InstallStore; people: PeopleService }> {
  if (!existsSync(join(home, STATE_FILE))) throw new UsageError(`There is no install in ${home}. Give its data folder with --home, or set GALLEY_HOME.`);
  const store = await openInstallState(home);

  return { store, people: createPeople(store, { providerConfigured: true }) };
}

/** One "<account id> <subject>" a line; blank lines and lines starting with # are skipped. */
function pairsIn(path: string): Array<{ accountId: string; subject: string; line: number }> {
  const pairs: Array<{ accountId: string; subject: string; line: number }> = [];

  readFileSync(path, "utf8")
    .split(/\r?\n/)
    .forEach((text, index) => {
      if (text.trim() === "" || text.trimStart().startsWith("#")) return;
      const match = /^\s*(\S+)\s+(.*\S)\s*$/.exec(text);

      if (!match) throw new UsageError(`${path}, line ${index + 1}: write "<account id> <subject>".`);
      pairs.push({ accountId: match[1]!, subject: match[2]!, line: index + 1 });
    });
  return pairs;
}

export async function accountsCommand(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(
    "accounts",
    argv,
    { replace: { type: "boolean" }, file: { type: "string" }, from: { type: "string" }, to: { type: "string" }, home: { type: "string" }, force: { type: "boolean" } },
    3
  );
  const [action, ...rest] = positionals;

  if (values.help || !action) {
    io.out(ACCOUNTS_HELP);
    return values.help ? 0 : 2;
  }
  const home = resolve(io.cwd, values.home ?? defaultHome(io.env));

  if (action === "list") {
    if (rest.length > 0) throw new UsageError(`\`${PRODUCT.slug} accounts list\` takes no arguments.`);
    const { store } = await openPeople(home);

    // Printed on the server's console, which only someone with a shell there sees.
    for (const account of store.read().accounts) {
      const how = account.identity ? `subject ${account.identity.subject} at ${account.identity.issuer}` : account.email || "no e-mail";

      io.out(`${account.id}  ${ROLE_NAMES[account.role]}${account.disabled ? " (switched off)" : ""}  ${how}  ${account.name || "no name yet"}`);
    }
    return 0;
  }
  if (action === "link") {
    const issuer = io.env.GALLEY_OIDC_ISSUER?.trim();

    if (!issuer) throw new UsageError("Set GALLEY_OIDC_ISSUER to the provider's issuer, as the server is started with: a link binds to it.");
    if (values.file !== undefined && rest.length > 0) throw new UsageError("Give one pair, or --file with many, not both.");
    const pairs = values.file !== undefined ? pairsIn(resolve(io.cwd, values.file)) : rest.length === 2 ? [{ accountId: rest[0]!, subject: rest[1]!, line: 0 }] : null;

    if (!pairs) throw new UsageError(`Write \`${PRODUCT.slug} accounts link <account id> <subject>\`, or --file <pairs>.`);
    await refuseWhileServed(home, values.force === true);
    const { people } = await openPeople(home);
    let failed = 0;

    for (const pair of pairs) {
      const where = pair.line ? `line ${pair.line}: ` : "";

      try {
        const { account, replaced } = await people.linkIdentity(pair.accountId, { issuer, subject: pair.subject }, { replace: values.replace === true });

        io.out(
          `${where}Linked ${account.id} (${account.name || "no name yet"}, ${ROLE_NAMES[account.role]}) to subject ${pair.subject} at ${issuer}${replaced ? `, in place of subject ${replaced.subject}` : ""}. Its password and open new-password links are gone, and every session of it ended.`
        );
      } catch (error) {
        if (!isGalleyError(error)) throw error;
        failed += 1;
        io.err(`${where}${pair.accountId}: ${error.message}`);
      }
    }
    return failed > 0 ? 1 : 0;
  }
  if (action === "rekey") {
    const from = values.from?.trim();
    const to = values.to?.trim();

    if (!from || !to || rest.length > 0) throw new UsageError(`Write \`${PRODUCT.slug} accounts rekey --from <old issuer> --to <new issuer>\`.`);
    await refuseWhileServed(home, values.force === true);
    const { people } = await openPeople(home);

    try {
      const moved = await people.rekeyIssuer(from, to);

      io.out(`Moved ${moved.accounts} ${moved.accounts === 1 ? "account" : "accounts"} and ${moved.removed} removed ${moved.removed === 1 ? "account" : "accounts"} from ${from} to ${to}. Start the server with GALLEY_OIDC_ISSUER=${to}.`);
      return 0;
    } catch (error) {
      if (!isGalleyError(error)) throw error;
      io.err(error.message);
      return 1;
    }
  }
  if (action === "removed") {
    if (rest.length > 0) throw new UsageError(`\`${PRODUCT.slug} accounts removed\` takes no arguments.`);
    const { store, people } = await openPeople(home);
    const names = new Map(store.read().accounts.map((account) => [account.id, account.name || account.id]));
    const list = people.removed();

    if (list.length === 0) io.out("No removed account is on the list.");
    for (const removed of list) {
      const by = removed.removedBy === null ? "the server's access token or the server" : (names.get(removed.removedBy) ?? `${removed.removedBy} (removed since)`);

      io.out(`subject ${removed.subject} at ${removed.issuer}  removed ${removed.removedAt} by ${by}`);
    }
    return 0;
  }
  if (action === "unremove") {
    const issuer = io.env.GALLEY_OIDC_ISSUER?.trim();

    if (!issuer) throw new UsageError("Set GALLEY_OIDC_ISSUER to the provider's issuer, as the server is started with: the subject is taken off the list under it.");
    if (rest.length !== 1) throw new UsageError(`Write \`${PRODUCT.slug} accounts unremove <subject>\`.`);
    const subject = rest[0]!;

    await refuseWhileServed(home, values.force === true);
    const { people } = await openPeople(home);
    // The command line names the subject; the list's own entry (by its id) is what is taken off.
    const entry = people.removed().find((removed) => removed.issuer === issuer && removed.subject === subject);

    if (!entry) {
      io.err(`No removed account has subject ${subject} at ${issuer}. \`${PRODUCT.slug} accounts removed\` lists them.`);
      return 1;
    }
    const taken = await people.unremove(entry.id);

    io.out(`Took subject ${taken.subject} at ${taken.issuer} off the list of removed accounts (removed ${taken.removedAt}): it may sign in again, as a new account, or be linked.`);
    return 0;
  }
  throw new UsageError(`“${action}” isn't something accounts does. Use \`${PRODUCT.slug} accounts list\`, \`link\`, \`rekey\`, \`removed\` or \`unremove\`.`);
}
