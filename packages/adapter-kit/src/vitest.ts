/**
 * `describeAdapter`: the conformance check as vitest tests, one `it` per
 * check, so a failing check fails the test that names it. Kept apart from
 * the main entry so the kit never needs vitest unless you use this.
 */
import { beforeAll, describe, it } from "vitest";

import type { GalleyAdapter } from "@galley/core/adapter";
import { checkAdapter, checksFor, type AdapterExpectations, type AdapterReport } from "./check";

export function describeAdapter(adapter: GalleyAdapter, fixtureDir: string, expectations?: AdapterExpectations): void {
  describe(`${adapter?.name ?? "The"} adapter on ${fixtureDir.split(/[\\/]/).filter(Boolean).pop() ?? fixtureDir}`, () => {
    let report: AdapterReport;

    beforeAll(async () => {
      report = await checkAdapter(adapter, fixtureDir, expectations);
    }, 120_000);
    for (const check of checksFor(expectations)) {
      it(check.title, () => {
        const result = report.checks.find((item) => item.id === check.id);

        if (!result) throw new Error(`The “${check.id}” check did not run.`);
        if (result.status === "fail") throw new Error(result.detail ?? `${check.title}: failed.`);
        if (result.status === "warn") console.warn(`[${adapter.id}] ${check.title}: ${result.detail ?? "warning"}`);
      });
    }
  });
}

export { checkAdapter, formatReport, type AdapterExpectations, type AdapterReport } from "./check";
