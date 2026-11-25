/**
 * The "status" extension: the worked example of embedding, and the fixture
 * its tests run against. It says how many changes wait on a site and keeps a
 * one-line note for the team. Beside that it has small routes that exist
 * only to try what an extension is and isn't handed.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { HTTPException } from "hono/http-exception";
import { GalleyError } from "@galley/core";
import { currentAccountAuthor } from "@galley/core/workspace";
import { defineExtension, forbidden, invalid, type ExtensionHost, type ExtensionRequest, type GuardedSite, type JsonValue } from "../../src/extensions";

export interface StatusProbe {
  /** The host the extension was handed. */
  host: ExtensionHost | null;
  /** Every request a handler was handed, newest last. */
  requests: Array<ExtensionRequest<unknown>>;
  /** What later work (a timer a handler left running) found. */
  later: string[];
  /** How many times each thing ran. */
  calls: Record<string, number>;
  /** What a handler should return next, when a test wants something odd. */
  answer?: () => unknown;
  /** Holds the slow route until the test lets it go. */
  gate?: Promise<void>;
  /** A site asked for through the host by a POST, and kept. */
  kept?: GuardedSite | null;
  /** The preview's controller, taken by a POST and kept. */
  keptPreview?: ReturnType<GuardedSite["preview"]>;
}

export function newProbe(): StatusProbe {
  return { host: null, requests: [], later: [], calls: {} };
}

/** Tries a guarded piece of work and says how it went, in a word. */
async function attempt(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "done";
  } catch (error) {
    return `refused: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function statusExtension(probe: StatusProbe, options: { setup?: (host: ExtensionHost, signal: AbortSignal) => void | Promise<void>; stop?: () => void | Promise<void> } = {}) {
  return defineExtension({
    id: "status",
    secrets: ["STATUS_API_KEY"],
    async setup(host, { signal }) {
      const notes = new Map<string, { text: string; by: string }>();
      const count = (name: string) => (probe.calls[name] = (probe.calls[name] ?? 0) + 1);
      const seen = <B>(request: ExtensionRequest<B>) => void probe.requests.push(request as ExtensionRequest<unknown>);

      probe.host = host;
      await options.setup?.(host, signal);
      return {
        ...(options.stop ? { stop: options.stop } : {}),
        routes: {
          "GET /sites/:siteId": {
            access: "edit",
            async handle(request) {
              seen(request);
              count("status");
              const changes = await request.site!.changes();

              return { waiting: changes.files.length, note: notes.get(request.site!.id)?.text ?? null };
            },
          },
          "POST /sites/:siteId/note": {
            access: "publish",
            bodyLimit: 4096,
            body(input) {
              const text = (input as { text?: unknown } | null)?.text;

              if (typeof text !== "string" || !text.trim() || text.length > 200) throw invalid("A note is 1 to 200 characters.");
              return { text: text.trim() };
            },
            async handle(request) {
              seen(request);
              count("note");
              notes.set(request.site!.id, { text: request.body.text, by: request.caller.kind === "person" ? request.caller.name : "The operator" });
              return { ok: true };
            },
          },
          // Needs a person: the operator's token is refused.
          "POST /sites/:siteId/sign-off": { access: "publish", person: true, body: () => undefined, handle: (request) => (seen(request), count("sign-off"), { ok: true }) },
          // An owner's route, and one with no site in its address.
          "GET /about": { access: "manage", handle: (request) => (seen(request), count("about"), { mode: host.mode }) },
          // Reads a file of the site by a path the caller chose.
          "GET /sites/:siteId/file": { access: "edit", handle: async (request) => ({ content: (await request.site!.readFile(request.query.path ?? "")).content.slice(0, 40) }) },
          // Tries to change the site from a GET.
          "GET /sites/:siteId/write": { access: "edit", handle: async (request) => ({ tried: await attempt(() => request.site!.writeFile("src/content/pages/about.md", "x", { origin: "user", mode: "content" })) }) },
          // Asks the site to save where it may not, as whoever is calling.
          "POST /sites/:siteId/save": {
            access: "edit",
            body: (input) => input as { path: string; mode: "content" | "build" },
            handle: async (request) => ({ tried: await attempt(() => request.site!.writeFile(request.body.path, "changed by the status extension\n", { origin: "user", mode: request.body.mode })) }),
          },
          // Leaves work running after it has answered: a publish, and a content save. Says whose publishing name the work still carries.
          "POST /sites/:siteId/later": {
            access: "publish",
            body: (input) => input as { wait?: number } | undefined,
            handle(request) {
              const site = request.site!;

              setTimeout(() => {
                void (async () => {
                  probe.later.push(`publish ${await attempt(() => site.publish({ message: "Later" }))}`);
                  probe.later.push(`save ${await attempt(() => site.writeFile("src/content/pages/later.md", "---\ntitle: Later\n---\n", { origin: "user", mode: "content" }))}`);
                  probe.later.push(`name ${currentAccountAuthor()?.name ?? "nobody's"}`);
                  probe.later.push(`outside ${host.outside(() => currentAccountAuthor()?.name ?? "nobody's")}`);
                })();
              }, request.body?.wait ?? 20);
              return { started: true };
            },
          },
          // The same publish while the handler is still answering: the control for the route above.
          "POST /sites/:siteId/inside": { access: "publish", body: () => undefined, handle: async (request) => ({ tried: await attempt(() => request.site!.publish({ message: "Inside" })) }) },
          // An async body reader that refuses, and a handler that refuses before it would have looked at the body.
          "POST /request": {
            access: "edit",
            body: async (input) => {
              await Promise.resolve();
              if (!input) throw invalid(`Say what you need. (${process.env.STATUS_API_KEY ?? ""})`);
              return input as { need: string };
            },
            handle: ({ caller, body }) => {
              if (caller.kind !== "person") throw forbidden("People only.");
              return { need: body.need };
            },
          },
          // Three ways a handler might say "not signed in", and a failure that isn't one of the editor's errors.
          "GET /refuse/:how": {
            access: "edit",
            handle({ params }) {
              if (params.how === "code") throw new GalleyError("unauthorized", "Not signed in to the status service.");
              if (params.how === "status") throw new GalleyError("invalid", "Not signed in to the status service.", undefined, 401);
              if (params.how === "http") throw new HTTPException(401, { message: "Not signed in to the status service." });
              throw new Error(`the status service refused https://status.example/?key=${process.env.STATUS_API_KEY ?? ""}`);
            },
          },
          // "Tidies" the site's model before answering, as careless code might.
          "GET /sites/:siteId/tidy": {
            access: "edit",
            async handle(request) {
              const model = (await request.site!.model()) as unknown as { writable: { content: string[]; build: string[] } };

              model.writable.content.push("src/**", "**/*");
              model.writable.build.length = 0;
              return { content: model.writable.content.length };
            },
          },
          // The same tidying of what a change answers with: `refresh` hands back the model too.
          "POST /sites/:siteId/tidy": {
            access: "edit",
            body: () => undefined,
            async handle(request) {
              const model = (await request.site!.refresh()) as unknown as { writable: { content: string[]; build: string[] } };

              model.writable.content.push("src/**", "**/*");
              model.writable.build.length = 0;
              return { content: model.writable.content.length, preview: typeof request.site!.preview };
            },
          },
          // Asks the host for a site outside any GET and keeps it; then a GET uses the kept one.
          "POST /sites/:siteId/keep": { access: "edit", body: () => undefined, handle: async (request) => ((probe.kept = await host.sites.get(request.params.siteId!)), { kept: probe.kept !== null }) },
          "GET /kept-write": { access: "edit", handle: async () => ({ tried: await attempt(() => probe.kept!.writeFile("src/content/pages/by-a-kept-site.md", "x", { origin: "user", mode: "content" })) }) },
          // Takes the preview's controller in a POST and keeps it; then a GET reads its status and tries to start it.
          "POST /sites/:siteId/keep-preview": { access: "edit", body: () => undefined, handle: (request) => ((probe.keptPreview = request.site!.preview()), { state: probe.keptPreview.status().state }) },
          "GET /kept-preview": { access: "edit", handle: async () => ({ state: probe.keptPreview!.status().state, started: await attempt(() => probe.keptPreview!.start()), stopped: await attempt(() => probe.keptPreview!.stop()), restarted: await attempt(() => probe.keptPreview!.restart()) }) },
          // Reaches a site through the host instead of the request, from a GET.
          "GET /any-site": { access: "edit", handle: async (request) => ({ tried: await attempt(async () => (await host.sites.get(request.query.site ?? ""))!.writeFile("src/content/pages/by-a-get.md", "x", { origin: "user", mode: "content" })) }) },
          // An address that ends like one the editor treats specially.
          "POST /sites/:siteId/preview/start": { access: "edit", body: () => undefined, handle: () => ({ mine: true }) },
          // Waits until the test says, then tries to publish while still inside the handler.
          "POST /sites/:siteId/slow": {
            access: "publish",
            body: () => undefined,
            async handle(request) {
              await probe.gate;
              return { tried: await attempt(() => request.site!.publish({ message: "Slow" })) };
            },
          },
          // Joins a part of its address onto its own folder, as a careless extension would.
          "GET /notes/:name": { access: "edit", handle: async (request) => ({ read: await readFile(join(host.stateDir, request.params.name!), "utf8").then((text) => text.length, () => -1) }) },
          // Answers with whatever the test asks for, and fails with a message that holds a secret.
          "GET /odd": { access: "edit", handle: () => (probe.answer ? probe.answer() : { ok: true }) as JsonValue },
          "GET /leak": {
            access: "edit",
            handle() {
              host.log(`asked with ${process.env.STATUS_API_KEY ?? "no key"}\nGET /api/people 200 forged`);
              throw invalid(`The service refused the key ${process.env.STATUS_API_KEY ?? ""}.`);
            },
          },
        },
      };
    },
  });
}
