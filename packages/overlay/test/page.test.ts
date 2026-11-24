// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { firstMeaningfulLine, readArrival, watchPage } from "../src/page";

afterEach(() => vi.useRealTimers());

describe("whether the page was drawn", () => {
  it("takes the first line that says something: no blanks, punctuation or stack frames", () => {
    expect(firstMeaningfulLine("\n  \n---\nENOENT: no such file\n    at open (node:fs)")).toBe("ENOENT: no such file");
    expect(firstMeaningfulLine("Error:\n    at x (y.js:1:2)\nThe real reason")).toBe("The real reason");
    expect(firstMeaningfulLine("x".repeat(400))?.length).toBe(300);
    expect(firstMeaningfulLine("")).toBeNull();
  });

  it("reads the status the proxy put on the overlay's own script tag", () => {
    const script = document.createElement("script");
    expect(readArrival(script)).toEqual({ status: null, unavailable: false });
    script.setAttribute("data-galley-status", "500");
    expect(readArrival(script)).toEqual({ status: 500, unavailable: false });
    script.setAttribute("data-galley-unavailable", "");
    expect(readArrival(script)).toEqual({ status: 500, unavailable: true });
    script.setAttribute("data-galley-status", "5000");
    expect(readArrival(script).status).toBeNull();
  });

  it("an error page with nothing more to say is described by its own words after a moment", () => {
    vi.useFakeTimers();
    document.title = "Error";
    document.body.innerHTML = "<script>1</script><p>Cannot find module './Film.astro'</p>";
    const changes: unknown[] = [];
    const watch = watchPage(window, { status: 500, unavailable: false }, (state) => changes.push(state));
    expect(watch.current()).toEqual({ state: "failed", status: 500, message: null });
    vi.advanceTimersByTime(3100);
    expect(watch.current()).toEqual({ state: "failed", status: 500, message: "Cannot find module './Film.astro'" });
    expect(changes).toHaveLength(1);
    watch.dispose();
  });

  it("a page with no such address is missing, not failed", () => {
    const watch = watchPage(window, { status: 404, unavailable: false }, () => undefined);
    expect(watch.current().state).toBe("missing");
    watch.dispose();
  });
});
