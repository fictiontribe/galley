import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearQueries, fetchQuery, getQueryState, invalidate, matchesPrefix, setQueryData, subscribeQuery } from "../src/lib/query";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("query cache", () => {
  beforeEach(() => clearQueries());

  it("matches key prefixes element by element", () => {
    expect(matchesPrefix(["site", "a", "history"], ["site", "a"])).toBe(true);
    expect(matchesPrefix(["site", "ab"], ["site", "a"])).toBe(false);
    expect(matchesPrefix(["site"], ["site", "a"])).toBe(false);
    expect(matchesPrefix(["x"], [])).toBe(true);
  });

  it("shares one request between callers and reuses fresh data", async () => {
    const fetcher = vi.fn(async () => 42);
    const [a, b] = await Promise.all([fetchQuery(["n"], fetcher), fetchQuery(["n"], fetcher)]);
    expect([a, b]).toEqual([42, 42]);
    await fetchQuery(["n"], fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refetches watched entries on invalidate and keeps old data meanwhile", async () => {
    let value = 1;
    await fetchQuery(["site", "a", "history"], async () => value);
    const seen: Array<number | undefined> = [];
    const stop = subscribeQuery(["site", "a", "history"], () => seen.push(getQueryState<number>(["site", "a", "history"]).data));
    value = 2;
    expect(invalidate(["site", "a"])).toBe(1);
    expect(getQueryState<number>(["site", "a", "history"]).data).toBe(1);
    await flush();
    expect(getQueryState<number>(["site", "a", "history"]).data).toBe(2);
    expect(seen.at(-1)).toBe(2);
    stop();
  });

  it("leaves unwatched entries stale until next use", async () => {
    const fetcher = vi.fn(async () => "x");
    await fetchQuery(["settings"], fetcher);
    invalidate(["settings"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await fetchQuery(["settings"], fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("ignores a slow response that a newer one superseded", async () => {
    let resolveSlow: (value: string) => void = () => undefined;
    const slow = fetchQuery(["k"], () => new Promise<string>((resolve) => (resolveSlow = resolve)));
    setQueryData(["k"], "new");
    resolveSlow("old");
    await slow;
    expect(getQueryState<string>(["k"]).data).toBe("new");
  });

  it("keeps last good data when a background refresh fails", async () => {
    let fail = false;
    await fetchQuery(["k"], async () => {
      if (fail) throw new Error("boom");
      return "good";
    });
    const stop = subscribeQuery(["k"], () => undefined);
    fail = true;
    invalidate(["k"]);
    await flush();
    expect(getQueryState(["k"])).toMatchObject({ status: "success", data: "good" });
    expect((getQueryState(["k"]).error as Error).message).toBe("boom");
    stop();
  });

  it("reports a first load that fails as an error", async () => {
    await expect(fetchQuery(["k2"], async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(getQueryState(["k2"]).status).toBe("error");
  });
});
