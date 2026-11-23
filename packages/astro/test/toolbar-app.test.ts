// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import app, { fetchStatus, openUrl, render, startCommand } from "../src/toolbar-app.js";

const ROOT = "/Users/someone/sites/studio";
const running = { running: true, url: "http://127.0.0.1:4400", root: ROOT };
const stopped = { running: false, url: "http://127.0.0.1:4400", root: ROOT };
const actions = (pathname = "/about/") => ({ refresh: vi.fn(), pathname: () => pathname });
const q = (body: HTMLElement, name: string) => body.querySelector(`[data-galley="${name}"]`) as HTMLElement | null;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the toolbar app", () => {
  it("opens <galley>/open?root=…&url=… in a new tab when Galley is running", () => {
    const body = document.createElement("div");
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    render(body, { kind: "status", status: running }, actions("/blog/measured-survey/"));
    expect(q(body, "badge")!.textContent).toBe("Running");
    expect(q(body, "edit")!.textContent).toBe("Edit this page in Galley");
    expect(q(body, "command")).toBeNull();

    q(body, "edit")!.click();
    expect(open).toHaveBeenCalledWith(
      "http://127.0.0.1:4400/open?root=%2FUsers%2Fsomeone%2Fsites%2Fstudio&url=%2Fblog%2Fmeasured-survey%2F",
      "_blank",
      "noopener"
    );
  });

  it("shows the command that starts Galley, with a copy button, when it isn't running", async () => {
    const body = document.createElement("div");
    const writeText = vi.fn(async () => {});
    const a = actions();

    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(body, { kind: "status", status: stopped }, a);
    expect(q(body, "badge")!.textContent).toBe("Not running");
    expect(q(body, "edit")).toBeNull();
    expect(q(body, "command")!.textContent).toBe("npx galley-cms");
    expect(body.textContent).toContain("Galley isn't running. Start it in this project's folder:");

    q(body, "copy")!.click();
    expect(writeText).toHaveBeenCalledWith("npx galley-cms");
    await vi.waitFor(() => expect(q(body, "copy")!.textContent).toBe("Copied"));
    q(body, "refresh")!.click();
    expect(a.refresh).toHaveBeenCalledTimes(1);
  });

  it("says so plainly when the status can't be checked", () => {
    const body = document.createElement("div");

    render(body, { kind: "error" }, actions());
    expect(body.textContent).toContain("Couldn't check whether Galley is running");
    expect(q(body, "refresh")).not.toBeNull();
  });

  it("never renders the status values as markup", () => {
    const body = document.createElement("div");

    render(body, { kind: "status", status: { ...stopped, url: 'http://x/<img src=x onerror="alert(1)">' } }, actions());
    expect(body.querySelector("img")).toBeNull();
  });

  it("checks the status when it starts and each time it is opened", async () => {
    const replies = [stopped, running];
    const fetch = vi.fn(async () => new Response(JSON.stringify(replies.shift())));
    let toggled: (event: { state: boolean }) => void = () => {};

    vi.stubGlobal("fetch", fetch);
    const host = document.createElement("div");
    const canvas = host.attachShadow({ mode: "open" });

    app.init!(canvas, { onToggled: (callback: typeof toggled) => (toggled = callback) } as never, {} as never);
    await vi.waitFor(() => expect(canvas.querySelector('[data-galley="badge"]')!.textContent).toBe("Not running"));
    expect(fetch).toHaveBeenCalledWith("/__galley/status", expect.objectContaining({ cache: "no-store" }));

    toggled({ state: true });
    await vi.waitFor(() => expect(canvas.querySelector('[data-galley="badge"]')!.textContent).toBe("Running"));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("helpers", () => {
  it("adds --port only for a local Galley on another port", () => {
    expect(startCommand("http://127.0.0.1:4400")).toBe("npx galley-cms");
    expect(startCommand("http://localhost:4401")).toBe("npx galley-cms --port 4401");
    expect(startCommand("https://cms.example.com")).toBe("npx galley-cms");
  });

  it("builds the open address with both values encoded", () => {
    expect(openUrl("https://cms.example.com/galley", "C:\\Sites\\a b", "/a?b")).toBe("https://cms.example.com/galley/open?root=C%3A%5CSites%5Ca+b&url=%2Fa%3Fb");
  });

  it("treats a malformed or failed status answer as unknown", async () => {
    expect(await fetchStatus((async () => new Response("{}")) as never)).toBeNull();
    expect(await fetchStatus((async () => new Response("nope", { status: 404 })) as never)).toBeNull();
    expect(await fetchStatus((async () => { throw new TypeError("offline"); }) as never)).toBeNull();
    expect(await fetchStatus((async () => new Response(JSON.stringify(running))) as never)).toEqual(running);
  });
});
