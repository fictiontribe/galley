/**
 * The site kit's routes, answered from memory for `dev:mock`: the forms list
 * in one answer, what the site has of the kit, and "Set it up for me" as a
 * short job that adds a first form and the scripts setup. Engine types and
 * the engine's dependency-free shared form rules only.
 */
import { randomUUID } from "node:crypto";
import type { FormListItem, SiteKitStatus, SiteKitStep } from "@galley/core/api";
import type { FormDefinition } from "@galley/core/kit";
import type { Job } from "@galley/core/types";
import { CONTACT_FORM, pagesUsing } from "@galley/core/forms/shared";
import type { Handlers, MockBackend } from "./backend.ts";
import { MockError } from "./site.ts";

type SiteKitKey = "GET /api/sites/:siteId/forms" | "GET /api/sites/:siteId/kit" | "POST /api/sites/:siteId/kit/setup" | "POST /api/sites/:siteId/kit/endpoint" | "POST /api/sites/:siteId/kit/visibility";

const CONTACT = "src/content/forms/contact.json";
const SCRIPTS = "src/data/scripts.json";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function siteKitHandlers(mock: MockBackend): Pick<Handlers, SiteKitKey> {
  const status = (siteId: string): SiteKitStatus => {
    const site = mock.site(siteId);
    const has = (path: string) => site.read(path) !== null;
    const done = has(CONTACT) || site.listEntries("forms").items.length > 0;
    const step = (id: SiteKitStep["id"], label: string, present: boolean): SiteKitStep => ({ id, label, state: present ? "done" : "ready" });
    const steps = [
      step("files", "Add the site kit’s files", done),
      step("forms", "Add a forms folder and a first form, “Contact”", done),
      step("scripts", "Add the scripts setup", has(SCRIPTS)),
      step("collection", "Connect forms to the site’s content", done),
      step("layout", "Add the scripts to the page layout (Base.astro)", done),
      step("visibility", "Publish a version AI assistants can read", done),
    ];
    const model = site.model();
    return {
      framework: { id: model.framework.id, name: model.framework.name },
      supported: model.framework.id === "astro",
      ...(model.framework.id === "astro" ? {} : { reason: `The site kit works with Astro sites today, and this site is built with ${model.framework.name}.` }),
      buildAllowed: model.ai.allowBuild,
      kit: done ? { source: "vendored", version: "0.1.0", allowFormScripts: false } : null,
      available: "0.1.0",
      steps,
      ready: steps.every((item) => item.state === "done"),
      // As on a computer of one's own: the inbox works for the preview, visitors can't reach it.
      inbox: { used: true, endpoint: null, settable: true, address: `http://127.0.0.1:4400/f/${siteId}`, reachable: false },
    };
  };
  return {
    "GET /api/sites/:siteId/forms": ({ params }) => {
      const site = mock.site(params.siteId);
      const forms: FormListItem[] = site.listEntries("forms", { limit: 500, sort: "title", order: "asc" }).items.map((summary) => {
        const id = summary.path.split("/").pop()!.replace(/\.json$/, "");
        let definition: FormDefinition | null = null;
        try {
          definition = JSON.parse(site.read(summary.path)?.toString("utf8") ?? "null") as FormDefinition | null;
        } catch {
          definition = null;
        }
        const pages = pagesUsing(site.search(id, undefined, 50), id).map((hit) => ({ path: hit.path, title: hit.title }));
        return { id, path: summary.path, title: summary.title, status: summary.status, definition, ...(definition ? {} : { problem: "This form's file can't be read." }), pages };
      });
      return { forms };
    },
    "GET /api/sites/:siteId/kit": ({ params }) => status(params.siteId),
    "POST /api/sites/:siteId/kit/visibility": ({ params }) => {
      const job: Job = { id: randomUUID(), kind: "kit-setup", label: "Publishing a version AI assistants can read", state: "done", progress: 1, detail: "Nothing needed changing.", startedAt: Date.now(), finishedAt: Date.now(), siteId: params.siteId };
      mock.jobs.set(job.id, job);
      mock.emit({ type: "job", job: { ...job } });
      return { ...job };
    },
    "POST /api/sites/:siteId/kit/endpoint": () => {
      throw new MockError("invalid", "Visitors’ browsers can’t reach this app’s inbox, so the live site can’t send submissions to it. Run the app on a server with a public address, or send the form to another destination.");
    },
    "POST /api/sites/:siteId/kit/setup": ({ params }) => {
      const site = mock.site(params.siteId);
      const job: Job = { id: randomUUID(), kind: "kit-setup", label: "Setting up forms and scripts", state: "running", progress: 0, detail: "Reading the site", startedAt: Date.now(), siteId: params.siteId };
      mock.jobs.set(job.id, job);
      void (async () => {
        for (const [detail, progress] of [["Adding the site kit’s files", 0.3], ["Adding a first form and the scripts setup", 0.6], ["Connecting them to the site’s code", 0.9]] as const) {
          await sleep(500);
          Object.assign(job, { detail, progress });
          mock.emit({ type: "job", job: { ...job } });
        }
        const written: string[] = [];
        if (site.read(CONTACT) === null) {
          site.write(CONTACT, Buffer.from(`${JSON.stringify(CONTACT_FORM, null, 2)}\n`));
          written.push(CONTACT);
        }
        if (site.read(SCRIPTS) === null) {
          site.write(SCRIPTS, Buffer.from(`${JSON.stringify({ consent: { mode: "banner", googleConsentMode: true }, scripts: [] }, null, 2)}\n`));
          written.push(SCRIPTS);
        }
        mock.emit({ type: "changes.updated", siteId: params.siteId, paths: written, origin: "user" });
        mock.emit({ type: "site.updated", siteId: params.siteId });
        Object.assign(job, { state: "done", progress: 1, finishedAt: Date.now(), detail: written.length ? `${written.length} files are waiting in Proof.` : "Nothing needed changing." });
        mock.emit({ type: "job", job: { ...job } });
      })();
      return { ...job };
    },
  };
}
