import { describe, expect, it } from "vitest";
import { createSessionGuard, isUnauthorized, loginUrl, safeNext } from "../src/lib/session";

describe("the lost-session guard", () => {
  it("sends the person to sign in once, keeping where they were", () => {
    const guard = createSessionGuard();
    expect(guard.lost("/sites/abc/edit?path=src%2Fcontent%2Fpages%2Findex.md")).toBe("/login?next=%2Fsites%2Fabc%2Fedit%3Fpath%3Dsrc%252Fcontent%252Fpages%252Findex.md");
    expect(guard.isLost).toBe(true);
    // Every other request that fails meanwhile is quiet.
    expect(guard.lost("/sites/abc/edit")).toBeNull();
    expect(guard.lost("/sites/abc/proof")).toBeNull();
  });

  it("re-arms once signed in again", () => {
    const guard = createSessionGuard();
    guard.lost("/sites/a");
    guard.restored();
    expect(guard.isLost).toBe(false);
    expect(guard.lost("/sites/b")).toBe("/login?next=%2Fsites%2Fb");
  });

  it("never loops on the sign-in screen itself", () => {
    const guard = createSessionGuard();
    expect(guard.lost("/login?next=%2Fsites%2Fa")).toBeNull();
    expect(guard.isLost).toBe(true);
  });

  it("only returns to addresses inside the app", () => {
    expect(safeNext("//evil.example/x")).toBe("/");
    expect(safeNext("https://evil.example/")).toBe("/");
    expect(safeNext("/login?next=/x")).toBe("/");
    expect(safeNext("/sites/a?x=1")).toBe("/sites/a?x=1");
    expect(loginUrl("/")).toBe("/login");
  });

  it("tells a lost session (401) from a refusal (403)", () => {
    expect(isUnauthorized(401, { code: "unauthorized" })).toBe(true);
    expect(isUnauthorized(401, { code: "forbidden" })).toBe(true);
    expect(isUnauthorized(403, { code: "forbidden" })).toBe(false);
    expect(isUnauthorized(500, { code: "unauthorized" })).toBe(true);
    expect(isUnauthorized(404, null)).toBe(false);
  });
});
