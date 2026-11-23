import { describe, expect, it } from "vitest";
import type { RedirectIssue } from "@galley/core/redirects-info";
import { issuesByRow, kindWord, matchesSearch, newAddressParts, oldAddressParts, problemFilters, share, sourceLabel, visibleWindow } from "@/features/redirects/words";

describe("redirect words", () => {
  it("say a wildcard as “everything under”, never as a splat", () => {
    expect(oldAddressParts("/blog/*")).toEqual({ lead: "Everything under", path: "/blog/" });
    expect(oldAddressParts("/about/")).toEqual({ lead: null, path: "/about/" });
    expect(newAddressParts("/journal/:splat")).toEqual({ path: "/journal/", tail: "+ the rest of the address" });
  });

  it("permanent and temporary", () => {
    expect([301, 308, 302, 307].map((status) => kindWord(status as 301))).toEqual(["Permanent", "Permanent", "Temporary", "Temporary"]);
  });

  it("where a redirect came from", () => {
    expect(sourceLabel("import:wordpress")).toBe("WordPress import");
    expect(sourceLabel(undefined)).toBe("Added here");
    expect(sourceLabel("import:list")).toBe("Pasted list");
  });

  it("problem filters count rows, loops and conflicts mark every member", () => {
    const issues: RedirectIssue[] = [
      { code: "loop", severity: "error", indices: [0, 1], message: "loop" },
      { code: "chain", severity: "warning", indices: [2, 3], message: "chain" },
      { code: "shadowed", severity: "info", indices: [4, 5], message: "order" },
    ];

    expect([...issuesByRow(issues).keys()].sort()).toEqual([0, 1, 2]);
    expect(problemFilters(issues)).toEqual([
      { code: "loop", label: "Go round in a circle", count: 2 },
      { code: "chain", label: "Take more than one step", count: 1 },
    ]);
  });

  it("search, virtual window, meters", () => {
    expect(matchesSearch({ from: "/Old/", to: "/new/", note: "Team page" }, "team")).toBe(true);
    expect(matchesSearch({ from: "/a/", to: "/b/" }, "zzz")).toBe(false);
    expect(visibleWindow(5200, 520, 52, 10_000)).toEqual({ start: 92, end: 118 });
    expect(visibleWindow(0, 520, 52, 3)).toEqual({ start: 0, end: 3 });
    expect(share(3000, 2000)).toBe(1);
    expect(share(5, null)).toBeNull();
  });
});
