/**
 * Assistant-written fixes against the real SDK with a scripted fetch: one
 * request per page, a purpose-written instruction, structured answers turned
 * into ordinary edits that wait in Proof — and answers that state a figure
 * the page doesn't are dropped with the reason.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createEventBus } from "../../src/site/index";
import { auditSite } from "../../src/seo/audit";
import { createWriteBatches, planWrite, WRITE_INSTRUCTIONS, type WriterDeps } from "../../src/seo/write";
import type { WriteBatchStatus } from "../../src/seo/types";
import { jsonResponse, scriptedFetch, testClient, type RecordedRequest } from "../ai/helpers/scripted-fetch";
import { disposeAll, openSite, sh } from "../site/helpers";
import { cleanFiles, makeFixture } from "./fixture";

afterAll(() => disposeAll());

function reply(value: unknown, stop = "end_turn") {
  return () =>
    jsonResponse(200, {
      id: `msg_${Math.random().toString(36).slice(2)}`,
      type: "message",
      role: "assistant",
      model: "claude-haiku-5-5",
      content: [{ type: "text", text: JSON.stringify(value) }],
      stop_reason: stop,
      stop_sequence: null,
      usage: { input_tokens: 900, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
}

/** Three pages without a description, one post with alt text that is a file name. */
function siteFiles() {
  const files = cleanFiles();
  const blank = (path: string, line: string) => {
    files[path] = String(files[path]).replace(line, 'description: ""');
  };

  blank("src/content/pages/about.md", "description: How a converted net loft with one oven became the bakery four of us run today, and where our flour and butter come from.");
  blank("src/content/pages/contact.md", "description: Where to find the bakery on the harbour front, and how to order cakes for birthdays and weddings.");
  blank("src/content/events/sourdough-afternoon.md", "description: Mix, fold and shape a loaf with our bakers after closing, then bake it at home the next morning. Eight places.");
  files["src/content/blog/overnight-dough.md"] = String(files["src/content/blog/overnight-dough.md"]).replace("imageAlt: Three sourdough loaves cooling on a wire rack", "imageAlt: loaves.png");
  return files;
}

function deps(fetchImpl: typeof fetch | null, usage: unknown[] = []): WriterDeps {
  return {
    client: async () => (fetchImpl ? testClient(fetchImpl) : null),
    model: async () => "claude-haiku-5-5",
    record: async (line) => void usage.push(line),
    events: createEventBus(),
    log: () => {},
  };
}

async function finished(batches: ReturnType<typeof createWriteBatches>, started: WriteBatchStatus): Promise<WriteBatchStatus> {
  for (let i = 0; i < 200; i += 1) {
    const status = batches.status(started.job.id)!;

    if (status.job.state !== "running") return status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("batch didn't finish");
}

describe("writing missing descriptions", () => {
  it("states the request count up front, writes from the page, and refuses invented figures", async () => {
    const root = makeFixture(siteFiles());
    const { site } = await openSite(root);

    await auditSite(site);
    const plan = await planWrite(site, "description", deps(null));

    expect(plan).toMatchObject({ kind: "description", requests: 3, connected: false, model: "claude-haiku-5-5" });
    expect(plan.items.map((item) => item.path).sort()).toEqual(["src/content/events/sourdough-afternoon.md", "src/content/pages/about.md", "src/content/pages/contact.md"]);
    const script = scriptedFetch([
      reply({ value: "How a converted net loft with one oven became the bakery four of us run, with flour from a mill up the valley.", reason: "" }),
      reply({ value: "Find the bakery on the harbour front by the blue door. Open 24 hours, with 10% off cakes on Fridays.", reason: "" }),
      reply({ value: null, reason: "The page doesn't say enough." }),
    ]);
    const usage: unknown[] = [];
    const batches = createWriteBatches(deps(script.fetch, usage));
    const done = await finished(batches, await batches.start(site, "description", { paths: plan.items.map((item) => item.path) }));

    expect(script.requests).toHaveLength(3);
    expect(usage).toHaveLength(3);
    const first: RecordedRequest = script.requests[0]!;

    expect(first.body.system).toBe(WRITE_INSTRUCTIONS.description);
    expect(first.body.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(first.body.messages[0].content[0].text).toMatch(/converted net loft/);
    expect(done.job.state).toBe("done");
    expect(done.job.detail).toBe("1 of 3 written. They're waiting in Proof.");
    const byPath = Object.fromEntries(done.items.map((item) => [item.path.split("/").pop(), item]));

    expect(byPath["about.md"]).toMatchObject({ state: "written" });
    expect(byPath["contact.md"]).toMatchObject({ state: "skipped", reason: "It included 24, 10%, which the page doesn't state." });
    expect(byPath["sourdough-afternoon.md"]).toMatchObject({ state: "skipped", reason: "The page doesn't say enough." });
    // The written one is an ordinary one-line change, waiting in Proof; nothing was published.
    expect(sh(root, "status", "--porcelain")).toBe("M src/content/pages/about.md");
    expect(sh(root, "diff", "--unified=0").split("\n").filter((line) => /^[-+][^-+]/.test(line))).toEqual([
      'description: ""'.replace(/^/, "-"),
      "+description: How a converted net loft with one oven became the bakery four of us run, with flour from a mill up the valley.",
    ]);
    expect(sh(root, "log", "--oneline")).toMatch(/^[0-9a-f]+ First version$/);
    batches.dispose();
  });

  it("can be capped, and says plainly when the assistant isn't connected", async () => {
    const { site } = await openSite(makeFixture(siteFiles()));
    const script = scriptedFetch([reply({ value: "Where to find the bakery on the harbour front, by the chandlery and the lifeboat station.", reason: "" })]);
    const batches = createWriteBatches(deps(script.fetch));
    const done = await finished(batches, await batches.start(site, "description", { limit: 1 }));

    expect(done.requests).toBe(1);
    expect(script.requests).toHaveLength(1);
    await expect(createWriteBatches(deps(null)).start(site, "description")).rejects.toMatchObject({ code: "unconfigured" });
    batches.dispose();
  });
});

describe("writing alt text", () => {
  it("looks at the image itself and sets the alt field", async () => {
    const root = makeFixture(siteFiles());
    const { site } = await openSite(root);

    await auditSite(site);
    const plan = await planWrite(site, "alt", deps(null));

    expect(plan.items).toEqual([expect.objectContaining({ path: "src/content/blog/overnight-dough.md", field: ["imageAlt"], image: "/images/loaves.png", current: "loaves.png" })]);
    const script = scriptedFetch([reply({ value: "Three sourdough loaves cooling on a wire rack", reason: "" })]);
    const batches = createWriteBatches(deps(script.fetch));
    const done = await finished(batches, await batches.start(site, "alt"));
    const content = script.requests[0]!.body.messages[0].content;

    expect(content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png" } });
    expect(done.items[0]).toMatchObject({ state: "written", value: "Three sourdough loaves cooling on a wire rack" });
    expect(sh(root, "diff", "--unified=0")).toContain("+imageAlt: Three sourdough loaves cooling on a wire rack");
    batches.dispose();
  });

  it("reports a refusal instead of applying anything", async () => {
    const root = makeFixture(siteFiles());
    const { site } = await openSite(root);
    const script = scriptedFetch([reply({ value: "x", reason: "" }, "refusal")]);
    const batches = createWriteBatches(deps(script.fetch));
    const done = await finished(batches, await batches.start(site, "alt"));

    expect(done.items[0]).toMatchObject({ state: "failed", reason: "The assistant declined to write this one." });
    expect(sh(root, "status", "--porcelain")).toBe("");
    batches.dispose();
  });
});
