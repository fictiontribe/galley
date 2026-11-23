/**
 * Why a fast deploy used to lose its progress steps: job updates within
 * JOB_EMIT_INTERVAL_MS are coalesced into one trailing event, so on a quick
 * machine "Building the site…" was replaced by a later step before it was
 * ever sent — and finishing cancels the trailing event altogether. A deploy's
 * steps are sent as `immediate` updates; counts in between may still coalesce.
 */
import { describe, expect, it } from "vitest";
import { createEventBus } from "../../src/site/index";
import { createJobTracker } from "../../src/site/jobs";
import type { ServerEvent } from "../../src/types";

function tracker() {
  const bus = createEventBus();
  const details: Array<string | undefined> = [];

  bus.subscribe((event: ServerEvent) => {
    if (event.type === "job") details.push(event.job.detail);
  });
  return { jobs: createJobTracker(bus), details };
}

describe("job steps", () => {
  it("coalesces quick ordinary updates (the cause), but never drops an immediate step", () => {
    const plain = tracker();
    const job = plain.jobs.start("deploy", "Putting the site online");

    job.update({ detail: "Getting ready…" });
    job.update({ detail: "Building the site…" });
    job.update({ detail: "Checking the files…" });
    job.finish("done", { detail: "Live" });
    // Exactly what CI recorded: the start, then the finish — every step in between swallowed.
    expect(plain.details).toEqual([undefined, "Live"]);

    const steps = tracker();
    const stepped = steps.jobs.start("deploy", "Putting the site online");

    stepped.update({ detail: "Getting ready…" }, { immediate: true });
    stepped.update({ detail: "Building the site…" }, { immediate: true });
    stepped.update({ detail: "Uploading 1 of 9 files…" });
    stepped.update({ detail: "Uploading 2 of 9 files…" });
    stepped.update({ detail: "Checking the files…" }, { immediate: true });
    stepped.finish("done", { detail: "Live" });
    expect(steps.details).toEqual([undefined, "Getting ready…", "Building the site…", "Checking the files…", "Live"]);
    plain.jobs.dispose();
    steps.jobs.dispose();
  });
});
