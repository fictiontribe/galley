/**
 * The import report — data for the app and `--json`, and the same thing in
 * plain words for a site owner. It says what came across, what needs a
 * person, what was deliberately left behind and why, the redirects, and what
 * to do next. Every number in it comes from what the run actually did.
 */
import { astroSnippet, netlifySnippet } from "./redirects";
import type { ImportPlan, ImportReport, ItemAction, PlannedItem, ReportItem } from "./types";

export interface Outcome {
  item: PlannedItem;
  action: ItemAction;
  path?: string;
  reason?: string;
  notes: string[];
}

export interface MediaTally {
  saved: number;
  reused: number;
  failed: Array<{ url: string; reason: string }>;
  skipped: Array<{ url: string; reason: string }>;
  planned: number;
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function buildReport(plan: ImportPlan, outcomes: Outcome[], media: MediaTally, options: { dryRun: boolean; files: string[]; mediaUsers: Map<string, string[]>; stopped?: boolean }): ImportReport {
  const tally = () => ({ created: 0, updated: 0, unchanged: 0, skipped: 0 });
  const counts: ImportReport["counts"] = { posts: tally(), pages: tally(), media: { saved: media.saved, reused: media.reused, failed: media.failed.length, skipped: media.skipped.length, planned: media.planned }, embeds: 0 };
  const items: ReportItem[] = [];

  for (const outcome of outcomes) {
    const bucket = outcome.item.kind === "page" ? counts.pages : counts.posts;
    const action = outcome.action;

    if (action === "created" || action === "would-create") bucket.created += 1;
    else if (action === "updated" || action === "would-update") bucket.updated += 1;
    else if (action === "unchanged") bucket.unchanged += 1;
    else bucket.skipped += 1;
    if (action !== "skipped" && action !== "held-back") counts.embeds += outcome.item.embeds;
    items.push({
      title: outcome.item.title,
      kind: outcome.item.kind,
      action,
      oldUrl: outcome.item.oldUrl,
      newUrl: outcome.item.newUrl,
      ...(outcome.path ? { path: outcome.path } : {}),
      ...(outcome.reason ? { reason: outcome.reason } : {}),
      notes: outcome.notes,
    });
  }
  for (const skipped of plan.skipped) {
    const bucket = skipped.kind === "page" ? counts.pages : counts.posts;

    bucket.skipped += 1;
    items.push({ title: skipped.title, kind: skipped.kind, action: "skipped", oldUrl: skipped.oldUrl, newUrl: null, reason: skipped.reason, notes: [] });
  }
  const imported = outcomes.filter((outcome) => outcome.action !== "skipped" && outcome.action !== "held-back");
  const shortcodes = new Map<string, { count: number; items: Set<string> }>();
  const links = new Map<string, Set<string>>();

  for (const outcome of imported) {
    for (const name of outcome.item.shortcodes) {
      const entry = shortcodes.get(name) ?? { count: 0, items: new Set<string>() };

      entry.count += 1;
      entry.items.add(outcome.item.title);
      shortcodes.set(name, entry);
    }
    for (const url of outcome.item.externalLinks) links.set(url, (links.get(url) ?? new Set()).add(outcome.item.title));
  }
  const notes = imported.flatMap((outcome) => [...outcome.item.derived, ...outcome.notes].map((note) => ({ title: outcome.item.title, note })));
  const seo = {
    titlesKept: imported.filter((outcome) => outcome.item.seo.title === "kept").length,
    titlesNotKept: imported.filter((outcome) => outcome.item.seo.title === "not-kept").length,
    descriptions: imported.filter((outcome) => outcome.item.seo.description === "seo").length,
    descriptionsWritten: imported.filter((outcome) => outcome.item.seo.description === "written").length,
    canonicals: imported.filter((outcome) => outcome.item.seo.canonical).length,
  };
  const importedPaths = new Set(imported.map((outcome) => outcome.item.path));
  const redirects = plan.redirects.filter((redirect) => imported.some((outcome) => outcome.item.newUrl === redirect.to && importedPaths.has(outcome.item.path)));
  const rebuilds = plan.rebuilds.filter((rebuild) => imported.some((outcome) => outcome.path === rebuild.path || outcome.item.path === rebuild.path));
  const changed = counts.posts.created + counts.posts.updated + counts.pages.created + counts.pages.updated;
  const nextSteps: string[] = [];

  if (options.stopped) nextSteps.push("The import was stopped. What arrived is kept as pending changes; start it again to bring the rest — nothing is duplicated.");
  if (plan.questions.length) nextSteps.push("Answer the questions above, then run the import again.");
  if (changed > 0 || media.saved > 0) {
    nextSteps.push(options.dryRun ? "Run the import without --plan to bring this across. Nothing goes live until you publish." : "Open Proof and check the imported posts and pages. Nothing is live until you publish.");
  } else if (!plan.questions.length) {
    nextSteps.push("Nothing changed at the source since the last import, so there's nothing new to proof.");
  }
  if (rebuilds.length) nextSteps.push(`Rebuild ${count(rebuilds.length, "page")} with sections — each was imported as text and has a brief ready for the assistant.`);
  if (seo.descriptionsWritten) nextSteps.push(`Check the ${count(seo.descriptionsWritten, "description")} written from opening paragraphs; search engines show them.`);
  if (redirects.length) nextSteps.push(`Add the ${count(redirects.length, "redirect")} below to the site so old links keep working.`);
  if (media.failed.length) nextSteps.push(`Replace the ${count(media.failed.length, "file")} that couldn't be downloaded.`);
  if (changed > 0 || media.saved > 0) nextSteps.push("Publish when you're happy. Keep the WordPress site running until the new one is live and redirects are in place.");

  return {
    dryRun: options.dryRun,
    ...(options.stopped ? { stopped: true } : {}),
    source: plan.source,
    siteName: plan.siteName,
    counts,
    items,
    needsAttention: {
      shortcodes: [...shortcodes.entries()].map(([name, entry]) => ({ name, count: entry.count, items: [...entry.items] })).sort((a, b) => b.count - a.count),
      rebuilds: rebuilds.length,
      media: [...media.failed, ...media.skipped].map((entry) => ({ ...entry, items: options.mediaUsers.get(entry.url) ?? [] })),
      links: [...links.entries()].map(([url, users]) => ({ url, items: [...users] })),
      features: plan.features,
      notes,
      questions: plan.questions,
    },
    notImported: plan.notImported,
    offeredTypes: plan.offeredTypes,
    seo,
    redirects,
    snippets: { astro: astroSnippet(redirects), netlify: netlifySnippet(redirects) },
    rebuilds,
    files: options.files,
    nextSteps,
  };
}

/** The command-line option that gives this answer. */
export function answerFlag(id: string, value: string): string {
  if (id === "posts-collection") return `--posts-into ${value}`;
  if (id === "pages-collection") return `--pages-into ${value}`;
  if (id.startsWith("default:")) return `--default ${id.slice("default:".length)}=${value}`;
  return `--type ${id.slice("type:".length)}:${value}`;
}

/** The report in plain words, for the terminal and for people. */
export function renderReport(report: ImportReport): string {
  const out: string[] = [];
  const { posts, pages, media } = report.counts;
  const line = (text = "") => out.push(text);
  const section = (title: string) => {
    line();
    line(title);
  };
  const summary = (label: string, tally: typeof posts) => {
    const parts = [
      tally.created ? `${tally.created} ${report.dryRun ? "to add" : "added"}` : "",
      tally.updated ? `${tally.updated} ${report.dryRun ? "to update" : "updated"}` : "",
      tally.unchanged ? `${tally.unchanged} unchanged` : "",
      tally.skipped ? `${tally.skipped} not imported` : "",
    ].filter(Boolean);

    return `  ${label}: ${parts.length ? parts.join(", ") : "none"}`;
  };

  line(`${report.dryRun ? "Import plan (nothing was written)" : report.stopped ? "Import stopped part-way — what arrived is kept" : "Import finished"} — ${report.source.title || report.source.siteUrl} → ${report.siteName}`);
  section("What came across");
  line(summary("Posts", posts));
  line(summary("Pages", pages));
  line(`  Images and files: ${report.dryRun ? `${media.planned} to download` : `${media.saved} saved${media.reused ? `, ${media.reused} already here` : ""}${media.failed ? `, ${media.failed} couldn't be downloaded` : ""}${media.skipped ? `, ${media.skipped} skipped` : ""}`}`);
  if (report.counts.embeds) line(`  Videos, maps and other embeds kept: ${report.counts.embeds}`);
  const seo = report.seo;

  if (seo.titlesKept || seo.titlesNotKept || seo.descriptions || seo.canonicals) {
    line(
      `  SEO: ${[
        seo.descriptions ? `${seo.descriptions} descriptions from the SEO plugin` : "",
        seo.titlesKept ? `${seo.titlesKept} SEO titles kept` : "",
        seo.titlesNotKept ? `${seo.titlesNotKept} SEO titles not kept (this site has no field for them; the page title is used)` : "",
        seo.canonicals ? `${seo.canonicals} canonical addresses kept` : "",
      ]
        .filter(Boolean)
        .join("; ")}`
    );
  }

  const attention = report.needsAttention;

  if (attention.questions.length) {
    section("Questions to answer first");
    for (const question of attention.questions) {
      line(`  ${question.question}`);
      for (const option of question.options) line(`    · ${option.label}${option.value === question.default ? " — the likely answer" : ""}  (${answerFlag(question.id, option.value)})`);
    }
  }
  const hasAttention = attention.shortcodes.length || attention.rebuilds || attention.media.length || attention.links.length || attention.features.length || attention.notes.length;

  if (hasAttention) section("What needs a person");
  if (attention.rebuilds) {
    line(`  ${count(attention.rebuilds, "page")} ${attention.rebuilds === 1 ? "was" : "were"} built with a page builder. ${attention.rebuilds === 1 ? "It" : "Each"} ${report.dryRun ? "would be" : "was"} imported as text, with a brief to rebuild it from this site's sections:`);
    for (const rebuild of report.rebuilds) {
      const matched = rebuild.suggestions.filter((s) => s.blockType).length;

      line(`    · ${rebuild.title}${rebuild.url ? ` (${rebuild.url})` : ""} — ${count(rebuild.outline.sections.length, "section")}, ${matched} with a matching section type`);
    }
  }
  if (attention.shortcodes.length) {
    line("  Shortcodes left in place (they show as text until replaced):");
    for (const shortcode of attention.shortcodes) line(`    · [${shortcode.name}] — used ${count(shortcode.count, "time")} in ${shortcode.items.slice(0, 4).join(", ")}${shortcode.items.length > 4 ? ` and ${shortcode.items.length - 4} more` : ""}`);
  }
  if (attention.media.length) {
    line("  Files that didn't come across:");
    for (const entry of attention.media.slice(0, 20)) line(`    · ${entry.url} — ${entry.reason}${entry.items.length ? ` (in ${entry.items.slice(0, 3).join(", ")})` : ""}`);
    if (attention.media.length > 20) line(`    … and ${attention.media.length - 20} more (see --json)`);
  }
  if (attention.links.length) {
    line("  Links to pages of the old site that weren't imported (left pointing at the old site):");
    for (const entry of attention.links.slice(0, 15)) line(`    · ${entry.url} (in ${entry.items.slice(0, 3).join(", ")})`);
    if (attention.links.length > 15) line(`    … and ${attention.links.length - 15} more (see --json)`);
  }
  for (const feature of attention.features) {
    line(`  ${feature.title}: ${feature.advice}${feature.where.length ? ` Used in ${feature.where.slice(0, 4).join(", ")}${feature.where.length > 4 ? ` and ${feature.where.length - 4} more` : ""}.` : ""}`);
  }
  if (attention.notes.length) {
    line("  Notes on single items:");
    for (const note of attention.notes.slice(0, 30)) line(`    · ${note.title}: ${note.note}`);
    if (attention.notes.length > 30) line(`    … and ${attention.notes.length - 30} more (see --json)`);
  }
  const skipped = report.items.filter((item) => item.action === "skipped" || item.action === "held-back");

  if (skipped.length) {
    section("Not imported");
    for (const item of skipped.slice(0, 30)) line(`  · ${item.title} — ${item.reason ?? "skipped"}`);
    if (skipped.length > 30) line(`  … and ${skipped.length - 30} more (see --json)`);
  }
  section("Left behind on purpose");
  for (const entry of report.notImported) line(`  · ${entry.what}: ${entry.why}`);
  if (report.redirects.length) {
    section(`Redirects (${report.redirects.length}) — old addresses that change`);
    for (const redirect of report.redirects.slice(0, 15)) line(`  ${redirect.from} → ${redirect.to}`);
    if (report.redirects.length > 15) line(`  … and ${report.redirects.length - 15} more`);
    line(report.files.some((file) => /redirects/.test(file)) ? `  Written to: ${report.files.filter((file) => /redirects/.test(file)).join(", ")}` : "  Add --write-redirects to write them as files, or copy them from --json.");
  }
  if (report.files.length) {
    section("Files written besides content");
    for (const file of report.files) line(`  · ${file}`);
  }
  section("What to do next");
  report.nextSteps.forEach((step, i) => line(`  ${i + 1}. ${step}`));
  return out.join("\n");
}
