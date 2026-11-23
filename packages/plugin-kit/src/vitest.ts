/**
 * `describePlugin`: the plugin checks as a vitest test. Which checks run
 * depends on what the plugin contributes, so they are known only once it
 * has been looked at: the test fails with every failing check's title and
 * what to change. Kept apart from the main entry so the kit never needs
 * vitest unless you use this.
 */
import { beforeAll, describe, expect, it } from "vitest";

import type { GalleyPlugin } from "@galley/core/plugins";
import { checkPlugin, type PluginCheckOptions, type PluginReport } from "./check";

/** Runs `checkPlugin` once, then reports each check as its own test. Warnings are printed, not failed. */
export function describePlugin(plugin: GalleyPlugin, options?: PluginCheckOptions): void {
  describe(`the ${plugin?.displayName ?? plugin?.name ?? "unnamed"} plugin`, () => {
    let report: PluginReport;

    beforeAll(async () => {
      report = await checkPlugin(plugin, options);
    }, 120_000);
    it("passes every check", () => {
      for (const check of report.checks) {
        if (check.status === "warn") console.warn(`[${plugin.name}] ${check.title}: ${check.detail ?? "warning"}`);
      }
      const failed = report.checks.filter((check) => check.status === "fail");

      expect(failed.map((check) => `${check.title}: ${check.detail ?? "failed"}`)).toEqual([]);
    });
  });
}

export { checkPlugin, formatPluginReport, type PluginCheckOptions, type PluginReport } from "./check";
