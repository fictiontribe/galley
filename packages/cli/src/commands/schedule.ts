/**
 * `galley schedule` — list scheduled releases or publish any that are due.
 */
import { resolve } from "node:path";
import { PRODUCT } from "@galley/core/brand";
import { createScheduleService } from "@galley/core/schedules";
import { defaultHome, openSingleSite } from "@galley/server";
import { parse, plural } from "../args";
import type { Io } from "../io";

export const SCHEDULE_HELP = `Usage: ${PRODUCT.slug} schedule [path] [options]

List scheduled releases for the site in [path] (default: this folder), or
publish any scheduled releases whose time has arrived.

Options
      --list     List scheduled releases (default when no action is given)
      --run-due  Publish every scheduled release whose time has passed
      --json     Print the result as JSON
  -h, --help     Show this help

Examples
  ${PRODUCT.slug} schedule --list
  ${PRODUCT.slug} schedule --run-due
  ${PRODUCT.slug} schedule ./site --run-due --json`;

export async function scheduleCommand(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parse("schedule", argv, {
    list: { type: "boolean" },
    "run-due": { type: "boolean" },
    json: { type: "boolean" },
  });

  if (values.help) {
    io.out(SCHEDULE_HELP);
    return 0;
  }

  const root = resolve(io.cwd, positionals[0] ?? ".");
  const home = defaultHome(io.env);
  const runDue = Boolean(values["run-due"]);
  const engine = await openSingleSite({ root, home, env: io.env, watch: false });

  try {
    const schedules = createScheduleService({
      home,
      settings: engine.settings,
      events: engine.events,
    });

    if (runDue) {
      const ran = await schedules.runDueForSite(engine.site);

      if (values.json) {
        io.out(JSON.stringify({ path: root, siteId: engine.site.id, ran }, null, 2));
      } else if (ran.length === 0) {
        io.out("No scheduled releases are due right now.");
      } else {
        for (const item of ran) {
          if (item.state === "published") {
            io.out(`Published ${item.id}: ${item.message} (${plural(item.files.length, "file")}${item.commit ? `, ${item.commit.slice(0, 7)}` : ""})`);
          } else {
            io.err(`Failed ${item.id}: ${item.error ?? "unknown error"}`);
          }
        }
      }
      return ran.some((item) => item.state === "failed") ? 1 : 0;
    }

    const items = await schedules.list(engine.site);

    if (values.json) {
      io.out(JSON.stringify({ path: root, siteId: engine.site.id, items }, null, 2));
    } else if (items.length === 0) {
      io.out("No scheduled releases.");
    } else {
      for (const item of items) {
        io.out(`${item.id}  [${item.state}]  ${item.scheduledAt}  ${item.message} (${plural(item.files.length, "file")})`);
      }
    }
    return 0;
  } finally {
    await engine.dispose();
  }
}
