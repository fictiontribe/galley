/**
 * The hosted install over HTTP: first run (/api/setup/*) and the Install
 * page (/api/install/*, "sign out everywhere"). Hosted mode only — in local
 * mode every route here answers 404, because a local app has no install.
 *
 * Who may call the setup routes is decided before they run (app.ts): the
 * one-time setup code until an owner exists, a signed-in owner after.
 * Nothing secret ever comes back: a key is only ever its public half, the
 * access key and the assistant's key go in and stay in.
 */
import { z } from "zod";
import { GalleyError } from "@galley/core";
import { SECRET_NAMES, type ApiRouteKey } from "@galley/core/api";
import { MAX_INSTALL_PASSWORD_LENGTH, type Install } from "@galley/core/install";
import type { SecretName } from "@galley/core/types";
import { bearerToken, clientAddress, requestSession } from "./auth";
import { changeOwnPassword, signInAs, signOutEverywhere } from "./accounts-routes";
import { restoreCredentials } from "./app";
import { errorBody, notFound } from "./errors";
import { TooLargeError, type InstallOps } from "./ops";
import type { RouteContext, RouteTable } from "./routes";
import * as v from "./validate";
import { audit, callerOf, named } from "./who";

type InstallRouteKey = Extract<
  ApiRouteKey,
  | "GET /api/setup"
  | "POST /api/setup/password"
  | "POST /api/setup/deploy-key"
  | "POST /api/setup/site/check"
  | "POST /api/setup/site"
  | "PUT /api/setup/details"
  | "POST /api/setup/handover"
  | "POST /api/setup/finish"
  | "GET /api/install"
  | "POST /api/install/password"
  | "POST /api/auth/logout-all"
  | "POST /api/install/backup"
  | "POST /api/install/restore/upload"
  | "POST /api/install/restore"
>;

function notHere(): never {
  throw notFound("This app isn't a hosted install, so there's nothing to set up here.");
}

/** The install's operations (health, backups, the Install page), in hosted mode; 404 everywhere else. */
function opsOf(ctx: RouteContext): InstallOps {
  installOf(ctx);
  if (!ctx.options.ops) notHere();
  return ctx.options.ops;
}

/** The install, in hosted mode; 404 everywhere else. */
export function installOf(ctx: RouteContext): Install {
  if (ctx.options.mode !== "hosted" || !ctx.options.install) notHere();
  return ctx.options.install;
}

const text = (max: number) => z.string().trim().min(1, "it can't be empty").max(max);
const password = z.string().min(1, "it can't be empty").max(MAX_INSTALL_PASSWORD_LENGTH);
const author = z.object({ name: text(200), email: text(320) }).strict();
const starter = z.object({ id: text(100), look: text(100).optional(), name: text(100).optional() }).strict();
const connectBody = z
  .object({
    repository: text(2048),
    branch: text(255).optional(),
    // Empty is allowed and means the top of the repository, said on purpose; leaving it out means "as already known".
    folder: z.string().trim().max(1024).optional(),
    access: z.enum(["deploy-key", "token"]),
    token: text(4096).optional(),
    starter: starter.optional(),
  })
  .strict();
const keysBody = z.partialRecord(z.enum(SECRET_NAMES as [SecretName, ...SecretName[]]), text(4096));
const handoverBody = z
  .object({
    site: z
      .object({ repository: text(2048), branch: text(255).optional(), folder: text(1024).optional(), access: z.enum(["deploy-key", "token"]).optional(), token: text(4096).optional() })
      .strict()
      .optional(),
    author: author.optional(),
    liveUrl: text(2048).optional(),
    keys: keysBody.optional(),
  })
  .strict();
const detailsBody = z.object({ author: author.optional(), liveUrl: z.string().trim().max(2048).nullable().optional() }).strict();
const setPasswordBody = z.object({ password, name: z.string().max(400).optional(), email: z.string().max(320).optional() }).strict();
const deployKeyBody = z.object({ rotate: z.boolean().optional() }).strict().optional().transform((value) => value ?? {});
const backupBody = z.object({ passphrase: z.string().max(MAX_INSTALL_PASSWORD_LENGTH) }).strict();
const restoreBody = z.object({ upload: z.string().max(100), passphrase: z.string().min(1, "it can't be empty").max(MAX_INSTALL_PASSWORD_LENGTH) }).strict();

/** An error with the given secrets cut out of everything that could be shown or logged. */
function scrubbed(error: unknown, secrets: Array<string | undefined>): unknown {
  const values = secrets.filter((secret): secret is string => typeof secret === "string" && secret.length >= 4);

  if (values.length === 0) return error;
  const scrub = (value: string | undefined) => values.reduce((out, secret) => out?.split(secret).join("[redacted]"), value);

  if (error instanceof GalleyError) return new GalleyError(error.code, scrub(error.message)!, scrub(error.detail));
  const clean = new Error(scrub(error instanceof Error ? error.message : String(error)));

  clean.stack = scrub(error instanceof Error ? error.stack : undefined) ?? clean.stack;
  return clean;
}

export const installRoutes: Pick<RouteTable, InstallRouteKey> = {
  // ── first run ──────────────────────────────────────────────────────────
  "GET /api/setup": async (_c, ctx) => installOf(ctx).status(),

  "POST /api/setup/password": async (c, ctx) => {
    const install = installOf(ctx);
    const body = await v.body(c, setPasswordBody);

    if (install.store.hasOwner()) throw new GalleyError("conflict", "The password has been chosen already. Sign in with it.");
    // Without a name or an e-mail (an older setup page) the owner is incomplete: the app asks for them after signing in.
    const owner = await install.people.createOwner({ password: body.password, ...(body.name !== undefined ? { name: body.name } : {}), ...(body.email !== undefined ? { email: body.email } : {}) });

    signInAs(c, ctx, owner.id);
    await install.people.noteSignIn(owner.id).catch(() => undefined);
    audit(ctx, `The owner's account was made through the setup link: ${named(owner)}, from ${clientAddress(c, Boolean(ctx.options.trustProxy))}.`);
    return install.status();
  },

  "POST /api/setup/deploy-key": async (c, ctx) => {
    const install = installOf(ctx);

    return install.deployKey(await v.body(c, deployKeyBody));
  },

  "POST /api/setup/site/check": async (c, ctx) => {
    const install = installOf(ctx);
    const body = await v.body(c, connectBody);

    try {
      return await install.check(body);
    } catch (error) {
      throw scrubbed(error, [body.token]);
    }
  },

  "POST /api/setup/site": async (c, ctx) => {
    const install = installOf(ctx);
    const body = await v.body(c, connectBody);

    try {
      return await install.connect(body);
    } catch (error) {
      throw scrubbed(error, [body.token]);
    }
  },

  "PUT /api/setup/details": async (c, ctx) => {
    const install = installOf(ctx);
    const body = await v.body(c, detailsBody);

    return install.setDetails({ ...(body.author ? { author: body.author } : {}), ...(body.liveUrl !== undefined ? { liveUrl: body.liveUrl } : {}) });
  },

  "POST /api/setup/handover": async (c, ctx) => {
    const install = installOf(ctx);
    const body = await v.body(c, handoverBody);

    try {
      return await install.handover(body);
    } catch (error) {
      throw scrubbed(error, [body.site?.token, ...Object.values(body.keys ?? {})]);
    }
  },

  "POST /api/setup/finish": async (_c, ctx) => installOf(ctx).finish(),

  // ── the Install page ───────────────────────────────────────────────────
  /** The older name for POST /api/account/password: your own password. */
  "POST /api/install/password": async (c, ctx) => {
    installOf(ctx);
    return changeOwnPassword(c, ctx);
  },

  "POST /api/auth/logout-all": async (c, ctx) => {
    installOf(ctx);
    return signOutEverywhere(c, ctx);
  },

  "GET /api/install": async (c, ctx) => {
    const ops = opsOf(ctx);
    const caller = callerOf(c, ctx);

    return ops.info(caller?.kind === "person" ? caller.account.id : undefined);
  },

  /**
   * The ONLY route whose answer carries the install's secrets — the password's
   * hash, the keys, the session key, the deploy key's private half — and it
   * carries them sealed with the person's passphrase (core install/backup.ts).
   * A signed-in browser only: a script's token can't take the keys away.
   */
  "POST /api/install/backup": async (c, ctx) => {
    const ops = opsOf(ctx);

    if (bearerToken(c) !== null || !requestSession(c, ctx.session)) {
      return c.json(errorBody("forbidden", "A backup can only be made from a signed-in browser."), 403);
    }
    const { passphrase } = await v.body(c, backupBody);
    const backup = await ops.backup(passphrase);

    return new Response(backup.body, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${backup.filename}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  },

  "POST /api/install/restore/upload": async (c, ctx) => {
    const ops = opsOf(ctx);
    const declared = Number(c.req.header("content-length"));

    try {
      return await ops.upload(c.req.raw.body, Number.isFinite(declared) && declared >= 0 && c.req.header("content-length") ? declared : null);
    } catch (error) {
      if (error instanceof TooLargeError) return c.json(errorBody("invalid", error.message), 413);
      throw error;
    }
  },

  "POST /api/install/restore": async (c, ctx) => {
    const ops = opsOf(ctx);
    const body = await v.body(c, restoreBody);

    return ops.restore(body, restoreCredentials(c, ctx.session));
  },
};
