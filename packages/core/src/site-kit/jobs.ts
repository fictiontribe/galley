/**
 * "Set it up for me" as a job: returned at once, its steps reported as
 * `job` events in plain words, its end kept for a while so a reload can
 * still ask how it went.
 */
import { createJobTracker } from "../site/jobs";
import type { SiteKitStep } from "../api";
import type { EventBus, Job, SiteService } from "../types";
import { runSiteKitSetup } from "./setup";

export interface SiteKitJobs {
  /** `only`: just these steps (and the kit files they need) — "Also publish a version AI assistants can read". */
  start(site: SiteService, options?: { captureAddress?: string | null; captureReachable?: boolean; build?: boolean; only?: Array<SiteKitStep["id"]> }): Job;
  get(id: string): Job | null;
  dispose(): void;
}

/** The last lines of a build's output: enough to see what failed. */
const tail = (text: string) => text.split("\n").slice(-40).join("\n");

export function createSiteKitJobs(events: EventBus): SiteKitJobs {
  const jobs = createJobTracker(events);
  const running = new Map<string, string>();

  return {
    start(site, options = {}) {
      const already = running.get(site.id);
      const current = already ? jobs.get(already) : null;

      // One set-up per site at a time: pressing again follows the one under way.
      if (current && current.state === "running") return current;
      const job = jobs.start("kit-setup", options.only ? "Publishing a version AI assistants can read" : "Setting up forms and scripts");

      job.update({ siteId: site.id, progress: 0, detail: "Reading the site" });
      running.set(site.id, job.id);
      void (async () => {
        try {
          const outcome = await runSiteKitSetup(site, {
            ...options,
            progress: { step: (label, progress) => job.update({ detail: label, progress }) },
          });
          const left = outcome.status.steps.filter((step) => step.state === "left").length;
          const changed = outcome.written.length;
          const done =
            changed === 0
              ? "Nothing needed changing."
              : `${changed} ${changed === 1 ? "file is" : "files are"} waiting in Proof.${left ? ` ${left === 1 ? "One step is" : `${left} steps are`} left to finish.` : ""}`;

          if (outcome.build && !outcome.build.ok) {
            job.finish("done", { progress: 1, detail: `${done} The site’s build reports a problem now; Discard in Proof takes the changes back.`, output: tail(outcome.build.output) });
          } else {
            job.finish("done", { progress: 1, detail: `${done}${outcome.build?.ok ? " The site still builds." : ""}` });
          }
        } catch (error) {
          job.finish("error", { detail: error instanceof Error ? error.message : String(error) });
        } finally {
          if (running.get(site.id) === job.id) running.delete(site.id);
        }
      })();
      return job.snapshot();
    },
    get: (id) => jobs.get(id),
    dispose: () => jobs.dispose(),
  };
}
