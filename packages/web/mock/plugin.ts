/**
 * `pnpm --filter @galley/web dev:mock` — answers every /api route from
 * in-memory fixtures so the UI can be built before the real server exists.
 *
 *   GALLEY_MOCK=1             enable (set by the dev:mock script)
 *   GALLEY_MOCK_MODE=hosted   a hosted install: one site, and people who sign in
 *                             with their e-mail and the password "proof"
 *                             (sam@example.com Owner, robin@example.com Editor,
 *                             jo@example.com Contributor; see accounts.ts)
 *   GALLEY_MOCK_SETUP=step    hosted only — start first run at a step:
 *                               password  open the setup link printed below
 *                               site      owner made, no site yet: sign in as sam@example.com / "proof" and first run carries on
 *                               details   site connected; sign in as sam@example.com / "proof"
 *                               done      first run over (the default)
 *   GALLEY_MOCK_ROLE=role     hosted only — start signed in as the Owner, the
 *                             Editor or the Contributor (owner, editor, contributor)
 *   GALLEY_MOCK_EMAIL=1       hosted only — the server has outgoing e-mail:
 *                             links are "e-mailed" too (printed here), and
 *                             "Forgot your password?" sends one
 *   GALLEY_MOCK_ACCOUNTS=legacy
 *                             hosted only — an install from before accounts: one
 *                             owner with no name or e-mail, who signs in with
 *                             the password "proof" alone and is asked for them
 *   GALLEY_MOCK_FIXED=a,b     hosted only — what "the operator" set up front
 *                             (address, password, site, author, liveUrl, assistantKey)
 *   GALLEY_MOCK_LOCAL_REPOSITORIES=1
 *                             hosted only — allow connecting a folder on the
 *                             server's disk (/repos/site.git), as a trial does
 *   GALLEY_MOCK_ADDRESS=url    hosted only — the editor's own address (default
 *                             https://cms.example.com); a private name such as
 *                             https://cms.localhost is one visitors can't reach
 *   GALLEY_MOCK_LATENCY=ms    add latency to every response (default 120)
 *   GALLEY_MOCK_PUSH=fail     sending to the host always fails ("flaky": only
 *                             the send that publishing does fails; Send now works)
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import type { ServerEvent } from "@galley/core/types";
import type { InstallFixed } from "@galley/core/install/types";
import { ACCOUNT_ROLES, type AccountRole } from "@galley/core/install/accounts";
import { MOCK_SETUP_CODE, type MockSetupStep } from "./install.ts";
import { createMockServer, type MockAccessTable } from "./server.ts";

const SETUP_STEPS: readonly MockSetupStep[] = ["password", "site", "details", "done"];
const FIXED: readonly InstallFixed[] = ["address", "password", "site", "author", "liveUrl", "assistantKey"];

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function headersOf(req: IncomingMessage): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(req.headers)) headers[name] = Array.isArray(value) ? value.join(", ") : value;
  return headers;
}

export function galleyMock(): Plugin {
  return {
    name: "galley-mock",
    apply: "serve",
    configureServer(server) {
      const clients = new Set<ServerResponse>();
      const mode = process.env.GALLEY_MOCK_MODE === "hosted" ? "hosted" : "local";
      const setup = SETUP_STEPS.find((step) => step === process.env.GALLEY_MOCK_SETUP) ?? "done";
      const fixed = (process.env.GALLEY_MOCK_FIXED ?? "").split(",").filter((item): item is InstallFixed => FIXED.includes(item as InstallFixed));
      const role = ACCOUNT_ROLES.find((candidate): candidate is AccountRole => candidate === process.env.GALLEY_MOCK_ROLE);
      const mock = createMockServer({
        mode,
        setup,
        fixed,
        allowLocalRepositories: process.env.GALLEY_MOCK_LOCAL_REPOSITORIES === "1",
        address: process.env.GALLEY_MOCK_ADDRESS || undefined,
        latency: Number(process.env.GALLEY_MOCK_LATENCY ?? 120),
        role,
        email: process.env.GALLEY_MOCK_EMAIL === "1",
        legacy: process.env.GALLEY_MOCK_ACCOUNTS === "legacy",
        // Through Vite, which follows core's extension-less imports; Node's own loader (this file's) can't.
        access: mode === "hosted" ? (server.ssrLoadModule("@galley/core/install/route-access") as Promise<MockAccessTable>) : undefined,
      });
      mock.onEvent((event: ServerEvent) => {
        const line = `data: ${JSON.stringify(event)}\n\n`;
        for (const client of clients) client.write(line);
      });
      const heartbeat = setInterval(() => {
        for (const client of clients) client.write(": keep-alive\n\n");
      }, 15_000);
      server.httpServer?.on("close", () => clearInterval(heartbeat));

      server.config.logger.info(`  galley mock: fixtures (${mode} mode${mode === "hosted" ? `, first run at “${setup}”` : ""})`);
      if (mode === "hosted" && setup === "password") server.config.logger.info(`  galley mock: setup link /setup?token=${MOCK_SETUP_CODE}`);
      if (mode === "hosted" && role) server.config.logger.info(`  galley mock: signed in as the ${role}`);
      // What a real server would e-mail, so a link can be opened from here (the path and its #code, on this dev server).
      let mailed = 0;
      const printMail = () => {
        const outbox = mock.accounts?.outbox ?? [];
        for (; mailed < outbox.length; mailed++) {
          const mail = outbox[mailed];
          if (mail) server.config.logger.info(`  galley mock: e-mailed ${mail.to} ${mail.kind === "invitation" ? "an invitation" : "a new-password link"}: ${new URL(mail.url).pathname}${new URL(mail.url).hash}`);
        }
      };

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "/";
        if (!url.startsWith("/api/")) return next();
        try {
          const method = (req.method ?? "GET").toUpperCase();
          const body = method === "GET" ? undefined : await readBody(req);
          const answer = await mock.handle({ method, url, headers: headersOf(req), body });
          if (answer.sse) {
            res.writeHead(200, answer.headers);
            res.write(`data: ${JSON.stringify({ type: "hello", version: "mock" } satisfies ServerEvent)}\n\n`);
            clients.add(res);
            req.on("close", () => clients.delete(res));
            return;
          }
          res.writeHead(answer.status, answer.headers);
          res.end(answer.body ?? undefined);
          printMail();
          if (answer.status === 500) server.config.logger.error(`galley mock: ${method} ${url} failed: ${String(answer.body)}`);
        } catch (error) {
          server.config.logger.error(`galley mock: ${req.method} ${url} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
          res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: { code: "internal", message: "The mock server ran into a problem.", status: 500 } }));
        }
      });
    },
  };
}
