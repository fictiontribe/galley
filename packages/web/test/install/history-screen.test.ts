// @vitest-environment happy-dom
/**
 * Version history tells the truth about the repository: it looks when it
 * opens, says "Checking the repository…" until it knows, then one of in step
 * (with when it looked), newer versions waiting, couldn't look, or separate
 * ways — for an owner and for a contributor. A hosted editor's own round that
 * brought versions in is announced once, and the status bar says when newer
 * versions wait. Local mode only gains the look on opening.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitStatus, ServerEvent } from "@galley/core/types";
import { byText, click, renderApp, settle, startServer, until, type MockServer, type Rendered } from "./harness";

let page: Rendered | null = null;
afterEach(async () => {
  await page?.unmount();
  page = null;
  vi.unstubAllGlobals();
});

const MINUTE = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function status(overrides: Partial<GitStatus>): GitStatus {
  return { branch: "main", detached: false, hasRemote: true, remote: "origin", remoteUrl: "git@example.com:site.git", ahead: 0, behind: 0, clean: true, checkedAt: ago(0), ...overrides };
}

/** What the look and the plain status answer, set by each test; `gate` holds the look back until opened. */
interface Look {
  status: GitStatus | null;
  gate: Promise<void> | null;
  emit: ((event: ServerEvent) => void) | null;
}

async function open(mode: "local" | "hosted", look: Look, role?: "owner" | "contributor", path = "history"): Promise<{ server: MockServer; siteId: string }> {
  const server = await startServer({
    mode,
    setup: "done",
    ...(role ? { role } : {}),
    handlers: (handlers, backend) => {
      look.emit = (event) => backend.emit(event);
      return {
        ...handlers,
        "POST /api/sites/:siteId/git/check": async (request: unknown) => {
          if (look.gate) await look.gate;
          return look.status ?? handlers["POST /api/sites/:siteId/git/check"]!(request);
        },
        "GET /api/sites/:siteId/git": async (request: unknown) => look.status ?? handlers["GET /api/sites/:siteId/git"]!(request),
        // The site's own answer carries the same status (the status bar reads it there).
        "GET /api/sites/:siteId": async (request: unknown) => {
          const detail = (await handlers["GET /api/sites/:siteId"]!(request)) as { git: GitStatus };
          return look.status ? { ...detail, git: look.status } : detail;
        },
      };
    },
  });
  const siteId = mode === "hosted" ? server.install!.site.id! : [...server.backend.sites.keys()][0]!;
  page = await renderApp(server, path ? `/sites/${siteId}/${path}` : `/sites/${siteId}`);
  return { server, siteId };
}

const line = () => document.querySelector(".app-sync")?.textContent ?? "";
const button = (name: string) => byText(document.querySelector(".app-sync") ?? document, "button", name);

describe.each(["owner", "contributor"] as const)("Version history, signed in as the %s", (role) => {
  const mayGetLatest = role === "owner";

  it("says it is checking until the look answers, then in step with when it looked", async () => {
    let letGo = () => undefined as void;
    const look: Look = { status: status({ checkedAt: ago(4 * MINUTE) }), gate: new Promise<void>((resolve) => (letGo = resolve)), emit: null };
    const { server } = await open("hosted", look, role);

    await until(() => expect(line()).toBe("Checking the repository…"));
    expect(document.querySelector(".app-sync")?.getAttribute("aria-busy")).toBe("true");
    expect(server.log.some((entry) => entry.method === "POST" && entry.path.endsWith("/git/check"))).toBe(true);
    letGo();
    await until(() => expect(line()).toBe("In step with the repository, checked 4 min ago. Everything published is here."));
    look.status = status({ checkedAt: ago(0) });
    await page!.unmount();
    page = null;
    await open("hosted", look, role);
    await until(() => expect(line()).toBe("In step with the repository, checked just now. Everything published is here."));
    // Nothing needs a person: the status bar gains nothing.
    await settle(200);
    expect(document.querySelector("footer")?.textContent).not.toContain("Newer versions are waiting");
  });

  it("says newer versions are waiting, and who can bring them in", async () => {
    const look: Look = { status: status({ behind: 3 }), gate: null, emit: null };

    await open("hosted", look, role);
    await until(() => expect(line()).toContain("3 newer versions are waiting in the repository (checked just now)."));
    expect(Boolean(button("Get latest"))).toBe(mayGetLatest);
    if (!mayGetLatest) expect(line()).toContain("An editor or owner can bring them in.");
    else expect(line()).not.toContain("An editor or owner");
    // Something needs a person: the status bar says so, and leads here.
    const waiting = [...document.querySelectorAll<HTMLAnchorElement>("footer a")].find((link) => link.textContent?.includes("Newer versions are waiting"));
    expect(waiting?.getAttribute("href")).toMatch(/\/history$/);
  });

  it("says it couldn't look, why, and when it last knew — never in step on the strength of an old look", async () => {
    const problem = "Couldn't reach the code host. Check your connection and try again.";
    const look: Look = { status: status({ checkedAt: ago(3 * 60 * MINUTE), checkProblem: problem }), gate: null, emit: null };
    const { server } = await open("hosted", look, role);

    await until(() => expect(line()).toContain("Couldn’t check the repository."));
    expect(line()).toContain(problem);
    expect(line()).toContain("It was last checked 3 h ago.");
    expect(line()).not.toContain("In step");
    // Trying again asks again.
    const before = server.log.filter((entry) => entry.path.endsWith("/git/check")).length;
    look.status = status({});
    await click(button("Try again"));
    await until(() => expect(line()).toContain("In step with the repository, checked just now."));
    expect(server.log.filter((entry) => entry.path.endsWith("/git/check")).length).toBeGreaterThan(before);
  });

  it("says the two have gone separate ways, with no Get latest that would fail", async () => {
    const message = "This copy and the repository have gone separate ways: each has published versions the other doesn't, so newer versions can't come in by themselves. Your edits are safe. Someone who knows the repository needs to bring the two together.";
    const look: Look = { status: status({ ahead: 1, behind: 2, inTheWay: { kind: "separate-ways", message, paths: [] } }), gate: null, emit: null };

    await open("hosted", look, role);
    await until(() => expect(line()).toBe(message));
    expect(button("Get latest")).toBeNull();
  });
});

describe("while the app is open on a hosted editor", () => {
  it("says once, calmly, that newer versions were brought in, and refreshes what it shows", async () => {
    const look: Look = { status: status({}), gate: null, emit: null };
    const { server, siteId } = await open("hosted", look, "owner", "");

    await until(() => expect(page?.text()).toContain("Site home"));
    await settle(300);
    const asked = server.log.length;
    const { act } = await import("react");

    await act(async () => look.emit!({ type: "repository.checked", siteId, brought: 3 }));
    await until(() => expect(page?.text()).toContain("3 newer versions from the repository were brought in."));
    await until(() => expect(server.log.slice(asked).some((entry) => entry.method === "GET" && entry.path === `/api/sites/${siteId}`)).toBe(true));
    expect(page?.text().split("were brought in.").length).toBe(2);
    // A look that found something different but brought nothing in says nothing.
    await act(async () => look.emit!({ type: "repository.checked", siteId, brought: 0 }));
    await settle(200);
    expect(page?.text().split("were brought in.").length).toBe(2);
  });
});

describe("local mode", () => {
  it("looks when Version history opens and fails quietly; nothing else changes", async () => {
    const look: Look = { status: status({ checkedAt: null, checkProblem: "Couldn't reach the code host. Check your connection and try again.", behind: 2 }), gate: null, emit: null };
    const { server } = await open("local", look);

    await until(() => expect(line()).toContain("Couldn’t check the repository."));
    expect(server.log.filter((entry) => entry.method === "POST" && entry.path.endsWith("/git/check"))).toHaveLength(1);
    expect(document.querySelector(".app-sync__mark--neutral")).not.toBeNull();
    expect(page?.text()).not.toContain("Couldn’t get the latest");
    // The status bar of a person's own computer gains nothing.
    expect(page?.text()).not.toContain("Newer versions are waiting");
  });
});
