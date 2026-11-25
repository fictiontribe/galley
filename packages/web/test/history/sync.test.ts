import { describe, expect, it } from "vitest";
import type { GitStatus } from "@galley/core/types";
import { syncLine } from "@/screens/history/sync";

const NOW = Date.parse("2026-11-24T12:00:00Z");
const base: GitStatus = { branch: "main", detached: false, hasRemote: true, ahead: 0, behind: 0, clean: true, checkedAt: new Date(NOW - 20_000).toISOString() };
const options = { checking: false, mayGetLatest: true, maySend: true, recorded: "in this editor", hosted: true, now: NOW };
const IN_THE_WAY = "The newer versions change about.md, which has unpublished changes here. Discard the change to that file (Proof shows it, so what you wrote can be copied first), then the newer versions can come in.";

describe("what Version history says about newer versions", () => {
  it("offers Get latest when nothing here is in their way", () => {
    const line = syncLine({ ...base, behind: 2 }, options);

    expect(line).toMatchObject({ tone: "warning", action: "get-latest" });
    expect(line.text).toMatch(/^2 newer versions are waiting in the repository \(checked .+\)\.$/);
  });

  it("offers Proof, not a Get latest that would be refused, when a change here is in their way", () => {
    const line = syncLine({ ...base, behind: 1, clean: false, inTheWay: { kind: "changes", message: IN_THE_WAY, paths: ["src/content/pages/about.md"] } }, options);

    expect(line).toMatchObject({ tone: "warning", action: "review" });
    expect(line.text).toMatch(/^1 newer version is waiting in the repository \(checked .+\)\. The newer versions change about\.md, which has unpublished changes here\. Discard the change to that file \(Proof shows it/);
    expect(line.text).not.toMatch(/Publish or/);
    // Whoever may not bring versions in can still see the change in Proof.
    expect(syncLine({ ...base, behind: 1, clean: false, inTheWay: { kind: "changes", message: IN_THE_WAY, paths: ["src/content/pages/about.md"] } }, { ...options, mayGetLatest: false }).action).toBe("review");
  });

  it("says who can bring them in when this account can't, and offers nothing", () => {
    const line = syncLine({ ...base, behind: 1 }, { ...options, mayGetLatest: false });

    expect(line.action).toBeNull();
    expect(line.text).toMatch(/An editor or owner can bring them in\.$/);
  });

  it("offers nothing when the two have gone separate ways", () => {
    const message = "This copy and the repository have gone separate ways: each has published versions the other doesn't, so newer versions can't come in by themselves. Your edits are safe. Someone who knows the repository needs to bring the two together.";

    expect(syncLine({ ...base, ahead: 1, behind: 1, inTheWay: { kind: "separate-ways", message, paths: [] } }, options)).toMatchObject({ text: message, action: null });
  });
});
