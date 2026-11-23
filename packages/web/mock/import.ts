/**
 * Bringing a WordPress site over, in the mock: a pretend WordPress site
 * answers the quick look (an address with "hidden" in it hides its content,
 * to show that answer), the plan is a fixed picture, and a run counts its
 * steps up over a few seconds as a job. The report points at the mock site's
 * own entries so its links open real pages. Types only from the engine.
 */
import { randomUUID } from "node:crypto";
import type { ImportInspection, ImportPlanView, ImportRebuildStatus, ImportReportView, ImportRunStatus, ImportStep, Job } from "@galley/core/types";
import type { Handlers, MockBackend } from "./backend.ts";
import { MockError } from "./site.ts";

type ImportKey =
  | "POST /api/sites/:siteId/import/upload"
  | "POST /api/sites/:siteId/import/inspect"
  | "POST /api/sites/:siteId/import/plan"
  | "POST /api/sites/:siteId/import/run"
  | "GET /api/sites/:siteId/import/runs/:runId"
  | "POST /api/sites/:siteId/import/runs/:runId/cancel"
  | "GET /api/sites/:siteId/import/report"
  | "POST /api/sites/:siteId/import/rebuild"
  | "GET /api/sites/:siteId/import/rebuild-all"
  | "POST /api/sites/:siteId/import/rebuild-all"
  | "GET /api/sites/:siteId/import/rebuild-all/:jobId"
  | "POST /api/sites/:siteId/import/rebuild-all/:jobId/cancel";

const TITLE = "Fernhill Garden Studio";
const TOTALS = { posts: 60, pages: 11, media: 82 };

export function createMockImport(mock: MockBackend) {
  const runs = new Map<string, ImportRunStatus & { siteId: string; stop?: boolean }>();
  const reports = new Map<string, ImportReportView>();
  const queues = new Map<string, ImportRebuildStatus>();

  const paths = (siteId: string) => {
    const site = mock.site(siteId);
    return site.model().collections.flatMap((collection) => site.listEntries(collection.id).items.map((item) => ({ path: item.path, title: item.title })));
  };

  const reportFor = (siteId: string, runId: string, stopped: boolean, done: { posts: number; pages: number; media: number }): ImportReportView => {
    const entries = paths(siteId);
    const at = (index: number) => entries[index % Math.max(1, entries.length)];
    return {
      runId,
      finishedAt: Date.now(),
      stopped,
      source: { title: TITLE, siteUrl: "https://fernhill.example", kind: "address" },
      arrived: { posts: done.posts, pages: done.pages, images: done.media, updated: 0, unchanged: 0, embeds: 3 },
      entries: entries.slice(0, 6).map((entry) => ({ title: entry.title, kind: "post", path: entry.path, newUrl: null, oldUrl: "https://fernhill.example/", action: "created" })),
      needsLook: [
        { id: "feature:forms", title: "Forms", advice: "A static site can't receive form entries by itself. Connect a form service or use an email link; the form's place is marked in the page.", items: [{ title: at(1)?.title ?? "Contact", ...(at(1) ? { path: at(1)!.path } : {}), note: "Contact" }] },
        { id: "note:desc", title: "Description was written from the opening paragraph", items: entries.slice(0, 4).map((entry) => ({ title: entry.title, path: entry.path, note: "Description was written from the opening paragraph — check it reads well in search results" })) },
      ],
      notImported: [{ title: "Services", note: "A page already lives at /services/. It was kept; rename or delete it and run the import again to bring this one in." }],
      leftBehind: [
        { what: "Comments", why: "A static site has no comment system; the comments stay in WordPress and its export." },
        { what: "The theme, menus and widgets", why: "The new site has its own design and navigation." },
      ],
      rebuilds: ["Garden design", "Planting plans", "Workshops", "Our approach"].map((title, index) => ({ title, path: at(index)?.path ?? `src/content/pages/${index}.md`, url: `/${title.toLowerCase().replace(/\s+/g, "-")}/`, originalUrl: `https://fernhill.example/${title.toLowerCase().replace(/\s+/g, "-")}/`, builder: "Elementor", sections: 4, matched: 3 })),
      redirects: { count: done.posts, file: "wordpress-import/_redirects", list: Array.from({ length: done.posts }, (_, i) => ({ from: `/2025/${String(12 - (i % 12)).padStart(2, "0")}/post-${i + 1}/`, to: `/blog/post-${i + 1}/`, title: `Post ${i + 1}` })) },
      seo: { descriptions: done.posts + done.pages, descriptionsWritten: 0, titlesKept: 0, titlesNotKept: 4, canonicals: 0 },
      files: ["wordpress-import/manifest.json", "wordpress-import/redirects.mjs", "wordpress-import/_redirects"],
    };
  };

  const handlers: Pick<Handlers, ImportKey> = {
    "POST /api/sites/:siteId/import/upload": ({ body }) => {
      if (body.offset === 0 && !Buffer.from(body.chunk, "base64").toString("utf8").includes("wordpress.org/export")) {
        throw new MockError("invalid", "That file isn't a WordPress export. In WordPress, open Tools › Export, choose “All content”, and upload the file it downloads (it ends in .xml).");
      }
      const id = body.uploadId ?? randomUUID();
      const received = body.offset + Math.floor((body.chunk.length * 3) / 4);
      return { uploadId: id, received: Math.min(received, body.total), upload: received >= body.total ? { id, name: body.name, size: body.total } : null };
    },
    "POST /api/sites/:siteId/import/inspect": ({ body }): ImportInspection => {
      const counts = { posts: TOTALS.posts, pages: TOTALS.pages + 1, media: TOTALS.media, comments: 37 };
      if (body.source.kind === "address" && /hidden/.test(body.source.address) && !body.source.password) {
        return { ok: false, kind: "address", title: "", siteUrl: "", counts: { posts: null, pages: null, media: null, comments: null }, signedIn: false, notes: [], problem: { reason: "blocked", message: `https://${body.source.address.replace(/^https?:\/\//, "")} is a WordPress site, but it hides its content from visitors. Add an application password, or upload an export file instead.`, offer: ["password", "file"] } };
      }
      return { ok: true, kind: body.source.kind, title: TITLE, siteUrl: "https://fernhill.example", counts, ...(body.source.kind === "file" ? { builderPages: 4 } : {}), signedIn: body.source.kind === "address" && Boolean(body.source.password), notes: [] };
    },
    "POST /api/sites/:siteId/import/plan": ({ body }): ImportPlanView => {
      const author = body.answers?.["default:blog.author"];
      return {
        source: { title: TITLE, siteUrl: "https://fernhill.example", kind: body.source.kind },
        siteName: "Lowfield Studio",
        counts: { posts: TOTALS.posts, pages: TOTALS.pages, images: TOTALS.media, authors: 3, categories: 4, tags: 10 },
        destinations: [
          { kind: "posts", collection: "blog", label: "Journal", count: TOTALS.posts, fields: [{ label: "Title", from: "the title" }, { label: "Date", from: "the publication date" }, { label: "Author", from: "the author" }, { label: "Tags", from: "the tags" }, { label: "Image", from: "the featured image" }], unmapped: ["SEO titles (the page title is used instead)"] },
          { kind: "pages", collection: "pages", label: "Pages", count: TOTALS.pages, fields: [{ label: "Title", from: "the title" }, { label: "Description", from: "the SEO description" }], unmapped: [] },
        ],
        builders: [{ name: "Elementor", count: 4, titles: ["Garden design", "Planting plans", "Workshops", "Our approach"] }],
        skipped: [{ title: "Services", kind: "page", reason: "A page already lives at /services/." }],
        notComing: [
          { what: "Comments", why: "A static site has no comment system; the comments stay in WordPress and its export." },
          { what: "The theme, menus and widgets", why: "The new site has its own design and navigation; set up the menu in the site's navigation settings." },
        ],
        features: [{ title: "Forms", advice: "A static site can't receive form entries by itself. Connect a form service or use an email link.", where: ["Contact"] }],
        questions: [
          {
            id: "default:blog.author",
            question: "WordPress names Ines Calder, Rowan Pike and Mae Tulloch as authors, but Author in Journal has to be someone already on this site. Who should Journal entries be credited to?",
            options: [{ value: "nell-okafor", label: "Nell Okafor" }, { value: "tomas-reyes", label: "Tomas Reyes" }],
            default: "nell-okafor",
            answer: author ?? "nell-okafor",
          },
        ],
        redirects: TOTALS.posts,
        seo: { descriptions: TOTALS.posts + TOTALS.pages, titles: 0, canonicals: 0 },
        notes: [],
      };
    },
    "POST /api/sites/:siteId/import/run": ({ params }) => {
      const id = randomUUID();
      const job: Job = { id, kind: "import", label: "Bringing your WordPress site over", state: "running", startedAt: Date.now(), siteId: params.siteId, progress: 0 };
      const steps: ImportStep[] = [
        { id: "read", label: "Reading the old site", state: "running" },
        { id: "media", label: "Downloading images", state: "waiting", done: 0, total: TOTALS.media },
        { id: "posts", label: "Bringing over posts", state: "waiting", done: 0, total: TOTALS.posts },
        { id: "pages", label: "Bringing over pages", state: "waiting", done: 0, total: TOTALS.pages },
        { id: "finish", label: "Writing the report", state: "waiting" },
      ];
      const run: ImportRunStatus & { siteId: string; stop?: boolean } = { id, job, state: "running", steps, message: "Reading the old site…", siteId: params.siteId };
      runs.set(id, run);
      mock.jobs.set(id, job);
      let tick = 0;
      const timer = setInterval(() => {
        tick += 1;
        const current = steps.find((step) => step.state === "running");
        if (run.stop || !current) {
          clearInterval(timer);
          for (const step of steps) if (step.state === "running" || step.state === "waiting") step.state = run.stop ? "stopped" : "done";
          const done = { posts: steps[2]!.done ?? 0, pages: steps[3]!.done ?? 0, media: steps[1]!.done ?? 0 };
          run.report = reportFor(params.siteId, id, Boolean(run.stop), done);
          reports.set(params.siteId, run.report);
          run.state = run.stop ? "stopped" : "done";
          run.message = run.stop ? `Stopped. ${done.posts + done.pages} entries and ${done.media} images had arrived; they're kept as pending changes. Start again to bring the rest — nothing is duplicated.` : `Done. ${done.posts} posts, ${done.pages} pages and ${done.media} images are waiting in Proof.`;
          Object.assign(job, { state: "done", finishedAt: Date.now(), progress: 1, label: run.stop ? "Import stopped — what arrived is kept" : "WordPress import finished" });
          mock.emit({ type: "job", job: { ...job } });
          return;
        }
        if (current.total) current.done = Math.min(current.total, (current.done ?? 0) + Math.ceil(current.total / 12));
        if (!current.total || current.done === current.total || (current.id === "read" && tick > 3)) {
          current.state = "done";
          const following = steps[steps.indexOf(current) + 1];
          if (following) following.state = "running";
        }
        const running = steps.find((step) => step.state === "running");
        job.label = running ? (running.total ? `${running.label} — ${running.done} of ${running.total}` : running.label) : job.label;
        job.progress = Math.min(0.99, steps.filter((step) => step.state === "done").length / steps.length);
        run.message = `${job.label}…`;
        run.job = { ...job };
        mock.emit({ type: "job", job: { ...job } });
      }, 350);
      return run;
    },
    "GET /api/sites/:siteId/import/runs/:runId": ({ params }) => {
      const run = runs.get(params.runId);
      if (!run) throw new MockError("not-found", "That import isn't known here.");
      return { ...run, job: { ...run.job } };
    },
    "POST /api/sites/:siteId/import/runs/:runId/cancel": ({ params }) => {
      const run = runs.get(params.runId);
      if (!run) throw new MockError("not-found", "That import isn't known here.");
      run.stop = true;
      return run;
    },
    "GET /api/sites/:siteId/import/report": ({ params }) => ({ report: reports.get(params.siteId) ?? null }),
    "POST /api/sites/:siteId/import/rebuild": () => {
      throw new MockError("unconfigured", "The pretend backend has no assistant to rebuild pages with. Try it against a real server.");
    },
    "GET /api/sites/:siteId/import/rebuild-all": ({ params }) => {
      const report = reports.get(params.siteId);
      return { pages: (report?.rebuilds ?? []).map((rebuild) => ({ path: rebuild.path, title: rebuild.title, rebuilt: false })), model: "claude-opus-5-5", estimate: { low: 0.9, high: 3.6 }, connected: true, note: "An estimate at list prices." };
    },
    "POST /api/sites/:siteId/import/rebuild-all": ({ params }) => {
      const report = reports.get(params.siteId);
      if (!report?.rebuilds.length) throw new MockError("invalid", "There are no page-builder pages to rebuild.");
      const job: Job = { id: randomUUID(), kind: "import", label: `Rebuilding ${report.rebuilds.length} pages with sections`, state: "running", startedAt: Date.now(), siteId: params.siteId };
      const status: ImportRebuildStatus = { job, pages: report.rebuilds.map((rebuild) => ({ path: rebuild.path, title: rebuild.title, state: "waiting" })) };
      queues.set(job.id, status);
      let at = 0;
      const timer = setInterval(() => {
        const page = status.pages[at];
        if (!page) {
          clearInterval(timer);
          Object.assign(job, { state: "done", finishedAt: Date.now(), progress: 1 });
          mock.emit({ type: "job", job: { ...job } });
          return;
        }
        if (page.state === "working") {
          page.state = "done";
          at += 1;
        } else page.state = "working";
      }, 900);
      return status;
    },
    "GET /api/sites/:siteId/import/rebuild-all/:jobId": ({ params }) => {
      const status = queues.get(params.jobId);
      if (!status) throw new MockError("not-found", "That rebuild isn't known here.");
      return status;
    },
    "POST /api/sites/:siteId/import/rebuild-all/:jobId/cancel": ({ params }) => {
      const status = queues.get(params.jobId);
      if (!status) throw new MockError("not-found", "That rebuild isn't known here.");
      for (const page of status.pages) if (page.state === "waiting") page.state = "stopped";
      return status;
    },
  };
  return { handlers };
}
